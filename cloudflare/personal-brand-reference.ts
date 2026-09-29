import { neon } from "@neondatabase/serverless";
import { ActivityBudgetEngine } from "../api/_lib/activity-budget.js";
import { EntitlementUsageService } from "../api/_lib/entitlement-usage.js";
import { higgsfieldConfigured } from "../api/_lib/higgsfield.js";
import {
  evaluateReferenceImage,
  MAX_REFERENCE_COUNT,
  MIN_REFERENCE_COUNT,
  referenceFingerprint,
  sha256Hex,
  signReferencePath,
} from "../api/_lib/personal-brand-reference.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = {
  DATABASE_URL?: string;
  HF_CREDENTIALS?: string;
  SOCIAL_TOKEN_KEY?: string;
  APP_BASE_URL?: string;
};

type ReferenceRow = {
  id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  quality_score: number | string | null;
  quality_status: "PASS" | "REJECTED" | "PENDING";
  quality_reasons: unknown;
  created_at: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function uuid(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }

async function authContext(request: Request, env: Env) {
  if (!env.DATABASE_URL) return { error: json({ error: "DATABASE_NOT_CONFIGURED" }, 503) } as const;
  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return { error: json({ error: "UNAUTHENTICATED" }, 401) } as const;
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return { error: json({ error: "UNAUTHENTICATED" }, 401) } as const;
  return { sql: neon(env.DATABASE_URL), authUserId, databaseUrl: env.DATABASE_URL } as const;
}

async function ownedPersonalBrand(sql: ReturnType<typeof neon>, profileId: string, authUserId: string) {
  const rows = await sql`
    select id::text,name
    from public.profiles
    where id=${profileId}::uuid
      and owner_auth_user_id=${authUserId}
      and archived_at is null
      and profile_type='PERSONAL_BRAND'
    limit 1
  ` as unknown as Array<{id:string;name:string}>;
  return rows[0] ?? null;
}

async function referenceRows(sql: ReturnType<typeof neon>, profileId: string) {
  return sql`
    select id::text,filename,mime_type,byte_size,sha256,width,height,
           quality_score,quality_status,quality_reasons,created_at::text
    from public.personal_brand_reference_images
    where profile_id=${profileId}::uuid
    order by created_at asc
  ` as unknown as ReferenceRow[];
}

async function syncIdentityState(sql: ReturnType<typeof neon>, profileId: string) {
  const rows = await referenceRows(sql, profileId);
  const passed = rows.filter((row) => row.quality_status === "PASS");
  const fingerprint = passed.length ? await referenceFingerprint(passed.map((row) => row.sha256)) : null;
  const avg = passed.length ? passed.reduce((total,row) => total + Number(row.quality_score ?? 0), 0) / passed.length : null;
  const status = passed.length >= MIN_REFERENCE_COUNT ? "READY_TO_CREATE" : rows.length ? "REFERENCES_PENDING" : "NOT_CONFIGURED";
  await sql`
    insert into public.personal_brand_visual_identities(
      profile_id,provider,status,reference_quality,reference_fingerprint,updated_at
    ) values (
      ${profileId}::uuid,'HIGGSFIELD',${status},${avg},${fingerprint},now()
    )
    on conflict(profile_id) do update set
      status=case when public.personal_brand_visual_identities.soul_id is null then excluded.status else public.personal_brand_visual_identities.status end,
      reference_quality=excluded.reference_quality,
      reference_fingerprint=excluded.reference_fingerprint,
      updated_at=now()
  `;
  return { rows, passed, fingerprint, averageQuality: avg, status };
}

async function signedPreviewUrl(env: Env, referenceId: string) {
  if (!env.SOCIAL_TOKEN_KEY) return null;
  const exp = Math.floor(Date.now() / 1000) + 300;
  const sig = await signReferencePath(env.SOCIAL_TOKEN_KEY, referenceId, exp);
  const base = (env.APP_BASE_URL || "https://autoposter.02alessandrocaruso.workers.dev").replace(/\/$/,"");
  return `${base}/api/personal-brand/reference-image/${referenceId}?exp=${exp}&sig=${sig}`;
}

export async function handleReferenceImages(request: Request, env: Env) {
  const ctx = await authContext(request, env);
  if ("error" in ctx) return ctx.error;
  const { sql, authUserId } = ctx;

  if (request.method === "GET") {
    const profileId = new URL(request.url).searchParams.get("profileId") || "";
    if (!uuid(profileId)) return json({ error: "PROFILE_REQUIRED" }, 400);
    if (!await ownedPersonalBrand(sql, profileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const state = await syncIdentityState(sql, profileId);
    const references = await Promise.all(state.rows.map(async (row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      qualityScore: row.quality_score == null ? null : Number(row.quality_score),
      qualityStatus: row.quality_status,
      qualityReasons: Array.isArray(row.quality_reasons) ? row.quality_reasons : [],
      createdAt: row.created_at,
      previewUrl: await signedPreviewUrl(env, row.id),
    })));
    return json({
      profileId,
      references,
      minimumRequired: MIN_REFERENCE_COUNT,
      maximumAllowed: MAX_REFERENCE_COUNT,
      passed: state.passed.length,
      identityStatus: state.status,
    });
  }

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "INVALID_MULTIPART_BODY" }, 400);
    const profileId = String(form.get("profileId") || "");
    if (!uuid(profileId)) return json({ error: "PROFILE_REQUIRED" }, 400);
    if (!await ownedPersonalBrand(sql, profileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const existing = await referenceRows(sql, profileId);
    const files = form.getAll("images").filter((item): item is File => item instanceof File);
    if (!files.length) return json({ error: "REFERENCE_IMAGES_REQUIRED" }, 400);
    if (existing.length + files.length > MAX_REFERENCE_COUNT) return json({ error: "REFERENCE_IMAGE_LIMIT", maximumAllowed: MAX_REFERENCE_COUNT }, 409);

    const saved: string[] = [];
    for (const file of files) {
      if (file.size <= 0 || file.size > 5 * 1024 * 1024) return json({ error: "REFERENCE_FILE_SIZE_INVALID", filename: file.name }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const technical = evaluateReferenceImage(bytes, file.type);
      const hash = await sha256Hex(bytes);
      const base64 = btoa(String.fromCharCode(...bytes));
      try {
        const inserted = await sql`
          insert into public.personal_brand_reference_images(
            profile_id,filename,mime_type,image_bytes,byte_size,sha256,width,height,
            quality_score,quality_status,quality_reasons
          ) values (
            ${profileId}::uuid,${file.name.slice(0,240)},${file.type},
            decode(${base64},'base64'),${file.size},${hash},
            ${technical.width},${technical.height},${technical.score},
            ${technical.status},${JSON.stringify(technical.reasons)}::jsonb
          )
          on conflict(profile_id,sha256) do nothing
          returning id::text as id
        ` as unknown as Array<{id:string}>;
        if (inserted[0]?.id) saved.push(inserted[0].id);
      } catch (reason) {
        console.error("personal-brand-reference-upload", { profileId, code: reason instanceof Error ? reason.message.split(":")[0] : "REFERENCE_SAVE_FAILED" });
        return json({ error: "REFERENCE_SAVE_FAILED" }, 500);
      }
    }
    const state = await syncIdentityState(sql, profileId);
    return json({ saved: saved.length, total: state.rows.length, passed: state.passed.length, identityStatus: state.status }, 201);
  }

  if (request.method === "DELETE") {
    const body = await request.json().catch(() => ({})) as { profileId?: unknown; referenceId?: unknown };
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const referenceId = typeof body.referenceId === "string" ? body.referenceId : "";
    if (!uuid(profileId) || !uuid(referenceId)) return json({ error: "REFERENCE_REQUIRED" }, 400);
    if (!await ownedPersonalBrand(sql, profileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    await sql`
      delete from public.personal_brand_reference_images
      where id=${referenceId}::uuid and profile_id=${profileId}::uuid
    `;
    const state = await syncIdentityState(sql, profileId);
    return json({ deleted: true, total: state.rows.length, passed: state.passed.length, identityStatus: state.status });
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

export async function handleSignedReferenceImage(request: Request, env: Env, referenceId: string) {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY || !uuid(referenceId)) return json({ error: "NOT_FOUND" }, 404);
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") || "";
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(exp) || exp < now || exp > now + 600 || !/^[0-9a-f]{64}$/.test(sig)) return json({ error: "SIGNED_URL_EXPIRED" }, 403);
  const expected = await signReferencePath(env.SOCIAL_TOKEN_KEY, referenceId, exp);
  if (expected !== sig) return json({ error: "SIGNED_URL_INVALID" }, 403);

  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select mime_type,encode(image_bytes,'base64') as body
    from public.personal_brand_reference_images
    where id=${referenceId}::uuid
    limit 1
  ` as unknown as Array<{mime_type:string;body:string}>;
  if (!rows[0]) return json({ error: "NOT_FOUND" }, 404);
  const binary = atob(rows[0].body);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      "content-type": rows[0].mime_type,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleSoulIdPreflight(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const ctx = await authContext(request, env);
  if ("error" in ctx) return ctx.error;
  const body = await request.json().catch(() => ({})) as { profileId?: unknown };
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  if (!uuid(profileId)) return json({ error: "PROFILE_REQUIRED" }, 400);
  if (!await ownedPersonalBrand(ctx.sql, profileId, ctx.authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);

  const state = await syncIdentityState(ctx.sql, profileId);
  const blockers: string[] = [];
  if (!higgsfieldConfigured(env.HF_CREDENTIALS)) blockers.push("HIGGSFIELD_NOT_CONFIGURED");
  if (state.passed.length < MIN_REFERENCE_COUNT) blockers.push("REFERENCE_IMAGES_INSUFFICIENT");

  const usage = new EntitlementUsageService(ctx.databaseUrl);
  const capability = await usage.canUseCapability(profileId, "visual.higgsfield.soul_id");
  if (!capability.allowed) blockers.push(capability.reason || "SOUL_ID_CAPABILITY_BLOCKED");

  const budget = await new ActivityBudgetEngine(ctx.databaseUrl).preflight({
    profileId,
    task: "IMAGE_PREMIUM",
    importance: "PREMIUM",
    projectedOperationCostUsd: 2.5,
    costBucket: "HIGGSFIELD",
  });
  if (!budget.allowed) blockers.push(budget.reason || "HIGGSFIELD_BUDGET_BLOCKED");

  return json({
    operation: "CREATE_SOUL_ID",
    provider: "HIGGSFIELD",
    billable: true,
    providerCallExecuted: false,
    requiresExplicitConfirmation: true,
    canProceed: blockers.length === 0,
    blockers,
    references: {
      passed: state.passed.length,
      required: MIN_REFERENCE_COUNT,
      fingerprint: state.fingerprint,
      averageTechnicalQuality: state.averageQuality,
    },
    estimatedCost: {
      usd: 2.5,
      eur: budget.projectedOperationCostEur,
    },
    budget: {
      higgsfieldCapEur: budget.higgsfieldCapEur,
      higgsfieldSpendEur: budget.higgsfieldSpendEur,
      higgsfieldRemainingEur: budget.higgsfieldRemainingEur,
      projectedRemainingAfterEur: Math.max(0, budget.higgsfieldRemainingEur - budget.projectedOperationCostEur),
    },
  });
}
