import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

export type ApiPlatform = 'facebook' | 'instagram' | 'linkedin' | 'google_business_profile';
export type ApprovalMode = 'auto' | 'manual';

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
  workspace: LocalWorkspace | null;
  loading: boolean;
  error: string | null;
  register(input: { name: string; email: string; password: string }): Promise<void>;
  login(input: { email: string; password: string }): Promise<void>;
  logout(): void;
  createTenant(input: { name: string; slug: string }): Promise<string>;
  selectTenant(tenantId: string): Promise<void>;
  refresh(): Promise<void>;
  api<T>(path: string, init?: RequestInit): Promise<T>;
}

const Context = createContext<LocalE2EContextValue | null>(null);
const baseUrl = (import.meta.env.VITE_LOCAL_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'socialpilot.local.token';
const TENANT_KEY = 'socialpilot.local.tenant';

const request = async <T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> => {
  if (!baseUrl) throw new Error('Local E2E API non configurata');
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
  return body as T;
};

export function LocalE2EProvider({ children }: PropsWithChildren) {
  const enabled = Boolean(baseUrl);
  const [token, setToken] = useState<string | null>(() => enabled ? localStorage.getItem(TOKEN_KEY) : null);
  const [tenantId, setTenantId] = useState<string | null>(() => enabled ? localStorage.getItem(TENANT_KEY) : null);
  const [workspace, setWorkspace] = useState<LocalWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authedApi = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => request<T>(path, init, token), [token]);

  const refresh = useCallback(async () => {
    if (!enabled || !token || !tenantId) { setWorkspace(null); return; }
    setLoading(true);
    setError(null);
    try { setWorkspace(await request<LocalWorkspace>(`/tenants/${tenantId}/workspace`, {}, token)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); throw err; }
    finally { setLoading(false); }
  }, [enabled, token, tenantId]);

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
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TENANT_KEY);
    setToken(null); setTenantId(null); setWorkspace(null); setError(null);
  };

  const createTenant = async (input: { name: string; slug: string }) => {
    if (!token) throw new Error('Accedi prima di creare il workspace');
    const result = await request<{ tenantId: string }>('/tenants', { method: 'POST', body: JSON.stringify(input) }, token);
    localStorage.setItem(TENANT_KEY, result.tenantId);
    setTenantId(result.tenantId);
    return result.tenantId;
  };

  const selectTenant = async (id: string) => {
    localStorage.setItem(TENANT_KEY, id);
    setTenantId(id);
  };

  const value = useMemo<LocalE2EContextValue>(() => ({ enabled, token, tenantId, workspace, loading, error, register, login, logout, createTenant, selectTenant, refresh, api: authedApi }), [enabled, token, tenantId, workspace, loading, error, refresh, authedApi]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLocalE2E(): LocalE2EContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('LocalE2EProvider richiesto');
  return value;
}

export const localE2EEnabled = Boolean(baseUrl);
