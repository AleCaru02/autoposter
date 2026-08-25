import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

export type ApiPlatform = 'facebook' | 'instagram' | 'linkedin' | 'google_business_profile';
export type ApprovalMode = 'auto' | 'manual';
export type LocalRequestInit = Omit<RequestInit, 'body'> & { body?: BodyInit | null | undefined };

export interface TenantSummary {
  id: string;
  name: string;
  slug?: string;
  onboarding_status?: string;
  created_at?: string;
}

export interface LocalWorkspace {
  tenant: Record<string, unknown> | null;
  onboarding: Record<string, any> | null;
  brand: Record<string, any> | null;
  brandVersions: Array<Record<string, any>>;
  locks: Array<Record<string, any>>;
  strategy: Record<string, any> | null;
  pillars: Array<Record<string, any>>;
  posts: Array<Record<string, any> & { variants: Array<Record<string, any>> }>;
  connections: Array<Record<string, any>>;
  jobs: Array<Record<string, any>>;
  published: Array<Record<string, any>>;
  analytics: Array<Record<string, any>>;
  insights: Array<Record<string, any>>;
  usage: Array<Record<string, any>>;
  aiUsage: Array<Record<string, any>>;
  members: Array<Record<string, any>>;
}

interface LocalE2EContextValue {
  enabled: boolean;
  token: string | null;
  tenantId: string | null;
  tenants: TenantSummary[];
  workspace: LocalWorkspace | null;
  loading: boolean;
  error: string | null;
  register(input: { name: string; email: string; password: string }): Promise<void>;
  login(input: { email: string; password: string }): Promise<void>;
  logout(): void;
  createTenant(input: { name: string; slug: string }): Promise<string>;
  selectTenant(tenantId: string): Promise<void>;
  refresh(tenantOverride?: string): Promise<void>;
  refreshTenants(): Promise<void>;
  api<T>(path: string, init?: LocalRequestInit): Promise<T>;
}

const Context = createContext<LocalE2EContextValue | null>(null);
const baseUrl = (import.meta.env.VITE_LOCAL_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'socialpilot.local.token';
const TENANT_KEY = 'socialpilot.local.tenant';

const request = async <T,>(path: string, init: LocalRequestInit = {}, token?: string | null): Promise<T> => {
  if (!baseUrl) throw new Error('Local E2E API non configurata');
  const { body: requestBody, ...rest } = init;
  const headers = new Headers(init.headers);
  if (requestBody && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const fetchInit: RequestInit = requestBody === undefined ? { ...rest, headers } : { ...rest, headers, body: requestBody };
  const response = await fetch(`${baseUrl}${path}`, fetchInit);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
  return body as T;
};

export function LocalE2EProvider({ children }: PropsWithChildren) {
  const enabled = Boolean(baseUrl);
  const [token, setToken] = useState<string | null>(() => enabled ? localStorage.getItem(TOKEN_KEY) : null);
  const [tenantId, setTenantId] = useState<string | null>(() => enabled ? localStorage.getItem(TENANT_KEY) : null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [workspace, setWorkspace] = useState<LocalWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const authedApi = useCallback(async <T,>(path: string, init: LocalRequestInit = {}): Promise<T> => request<T>(path, init, token), [token]);

  const refreshTenants = useCallback(async () => {
    if (!enabled || !token) {
      setTenants([]);
      return;
    }
    try {
      const rows = await request<TenantSummary[]>('/tenants', {}, token);
      setTenants(rows);
      setError(null);
      const selectedExists = tenantId ? rows.some((tenant) => tenant.id === tenantId) : false;
      if (!selectedExists && rows[0]) {
        localStorage.setItem(TENANT_KEY, rows[0].id);
        setTenantId(rows[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [enabled, token, tenantId]);

  const refresh = useCallback(async (tenantOverride?: string) => {
    const sequence = ++refreshSequence.current;
    const targetTenantId = tenantOverride ?? tenantId;
    if (!enabled || !token || !targetTenantId) {
      if (sequence === refreshSequence.current) setWorkspace(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextWorkspace = await request<LocalWorkspace>(`/tenants/${targetTenantId}/workspace`, {}, token);
      if (sequence === refreshSequence.current) setWorkspace(nextWorkspace);
    } catch (err) {
      if (sequence === refreshSequence.current) setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [enabled, token, tenantId]);

  useEffect(() => { void refreshTenants().catch(() => undefined); }, [refreshTenants]);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  const storeSession = (accessToken: string) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    setToken(accessToken);
  };

  const register = async (input: { name: string; email: string; password: string }) => {
    setLoading(true); setError(null);
    try {
      const session = await request<{ access_token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(input) });
      storeSession(session.access_token);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); throw err; }
    finally { setLoading(false); }
  };

  const login = async (input: { email: string; password: string }) => {
    setLoading(true); setError(null);
    try {
      const session = await request<{ access_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(input) });
      storeSession(session.access_token);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); throw err; }
    finally { setLoading(false); }
  };

  const logout = () => {
    refreshSequence.current += 1;
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TENANT_KEY);
    setToken(null); setTenantId(null); setTenants([]); setWorkspace(null); setError(null);
  };

  const createTenant = async (input: { name: string; slug: string }) => {
    if (!token) throw new Error('Accedi prima di creare il workspace');
    const result = await request<{ tenantId: string }>('/tenants', { method: 'POST', body: JSON.stringify(input) }, token);
    localStorage.setItem(TENANT_KEY, result.tenantId);
    setTenantId(result.tenantId);
    const rows = await request<TenantSummary[]>('/tenants', {}, token);
    setTenants(rows);
    await refresh(result.tenantId);
    return result.tenantId;
  };

  const selectTenant = async (id: string) => {
    refreshSequence.current += 1;
    localStorage.setItem(TENANT_KEY, id);
    setTenantId(id);
    await refresh(id);
  };

  const value = useMemo<LocalE2EContextValue>(() => ({ enabled, token, tenantId, tenants, workspace, loading, error, register, login, logout, createTenant, selectTenant, refresh, refreshTenants, api: authedApi }), [enabled, token, tenantId, tenants, workspace, loading, error, refresh, refreshTenants, authedApi]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLocalE2E(): LocalE2EContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('LocalE2EProvider richiesto');
  return value;
}

export const localE2EEnabled = Boolean(baseUrl);