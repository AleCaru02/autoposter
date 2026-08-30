import { neon } from "@neondatabase/serverless";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";

type AuthColumnRow = { table_name: string; column_name: string };

type ProbeState = "PROTECTED" | "ABSENT" | "UNSAFE" | "PRESENT_OTHER" | "NETWORK_ERROR";

type EndpointProbe = {
  status: number | null;
  state: ProbeState;
};

export type ManagedAuthVerification = {
  ready: boolean;
  coreAuthReachable: boolean;
  adminPluginActive: boolean;
  adminSchemaPresent: boolean;
  userRoleField: boolean;
  userBannedField: boolean;
  userBanReasonField: boolean;
  userBanExpiresField: boolean;
  sessionImpersonatedByField: boolean;
  endpoints: {
    listUsers: EndpointProbe;
    setRole: EndpointProbe;
    banUser: EndpointProbe;
    listUserSessions: EndpointProbe;
    impersonateUser: EndpointProbe;
    stopImpersonating: EndpointProbe;
  };
};

export function classifyAuthEndpoint(status: number | null): ProbeState {
  if (status === null) return "NETWORK_ERROR";
  if (status === 404) return "ABSENT";
  if (status === 401 || status === 403) return "PROTECTED";
  if (status >= 200 && status < 300) return "UNSAFE";
  return "PRESENT_OTHER";
}

function normalizedColumn(tableName: string, columnName: string) {
  return `${tableName}.${columnName}`.toLowerCase().replace(/_/g, "");
}

export function evaluateManagedAuthVerification(rows: AuthColumnRow[], statuses: Record<keyof ManagedAuthVerification["endpoints"], number | null>, coreStatus: number | null): ManagedAuthVerification {
  const columns = new Set(rows.map((row) => normalizedColumn(row.table_name, row.column_name)));
  const userRoleField = columns.has("user.role");
  const userBannedField = columns.has("user.banned");
  const userBanReasonField = columns.has("user.banreason");
  const userBanExpiresField = columns.has("user.banexpires");
  const sessionImpersonatedByField = columns.has("session.impersonatedby");
  const endpoints = {
    listUsers: { status: statuses.listUsers, state: classifyAuthEndpoint(statuses.listUsers) },
    setRole: { status: statuses.setRole, state: classifyAuthEndpoint(statuses.setRole) },
    banUser: { status: statuses.banUser, state: classifyAuthEndpoint(statuses.banUser) },
    listUserSessions: { status: statuses.listUserSessions, state: classifyAuthEndpoint(statuses.listUserSessions) },
    impersonateUser: { status: statuses.impersonateUser, state: classifyAuthEndpoint(statuses.impersonateUser) },
    stopImpersonating: { status: statuses.stopImpersonating, state: classifyAuthEndpoint(statuses.stopImpersonating) },
  };
  const adminSchemaPresent = userRoleField && userBannedField && userBanReasonField && userBanExpiresField && sessionImpersonatedByField;
  const requiredStates = [endpoints.listUsers.state, endpoints.setRole.state, endpoints.banUser.state, endpoints.listUserSessions.state, endpoints.impersonateUser.state, endpoints.stopImpersonating.state];
  const noUnsafeEndpoint = requiredStates.every((state) => state !== "UNSAFE");
  const allAdminEndpointsPresent = requiredStates.every((state) => state === "PROTECTED" || state === "PRESENT_OTHER");
  const adminPluginActive = adminSchemaPresent && allAdminEndpointsPresent && noUnsafeEndpoint;
  const coreAuthReachable = coreStatus !== null && coreStatus !== 404;
  return {
    ready: coreAuthReachable && noUnsafeEndpoint,
    coreAuthReachable,
    adminPluginActive,
    adminSchemaPresent,
    userRoleField,
    userBannedField,
    userBanReasonField,
    userBanExpiresField,
    sessionImpersonatedByField,
    endpoints,
  };
}

async function probe(path: string, init?: RequestInit): Promise<number | null> {
  try {
    const response = await fetch(`${AUTH_URL}${path}`, {
      redirect: "manual",
      ...init,
      headers: { accept: "application/json", ...(init?.headers || {}) },
    });
    return response.status;
  } catch {
    return null;
  }
}

export async function handleManagedAuthCapabilities(request: Request, env: { DATABASE_URL?: string }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  if (!env.DATABASE_URL) {
    return new Response(JSON.stringify({ ready: false, database: "not_configured" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }

  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'neon_auth'
        and table_name in ('user', 'session')
      order by table_name, ordinal_position
    ` as AuthColumnRow[];

    const jsonHeaders = { "content-type": "application/json" };
    const [coreStatus, listUsers, setRole, banUser, listUserSessions, impersonateUser, stopImpersonating] = await Promise.all([
      probe("/get-session"),
      probe("/admin/list-users?limit=1"),
      probe("/admin/set-role", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ userId: "fase3-probe-no-user", role: "admin" }) }),
      probe("/admin/ban-user", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ userId: "fase3-probe-no-user" }) }),
      probe("/admin/list-user-sessions", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ userId: "fase3-probe-no-user" }) }),
      probe("/admin/impersonate-user", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ userId: "fase3-probe-no-user" }) }),
      probe("/admin/stop-impersonating", { method: "POST", headers: jsonHeaders, body: "{}" }),
    ]);

    const verification = evaluateManagedAuthVerification(rows, { listUsers, setRole, banUser, listUserSessions, impersonateUser, stopImpersonating }, coreStatus);
    return new Response(JSON.stringify({ service: "post-automatici", database: "reachable", managedAuth: verification }), {
      status: verification.ready ? 200 : 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (reason) {
    console.error("managed-auth-capabilities", reason instanceof Error ? reason.message : "unknown");
    return new Response(JSON.stringify({ service: "post-automatici", database: "unreachable", managedAuth: { ready: false, adminPluginActive: false } }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
