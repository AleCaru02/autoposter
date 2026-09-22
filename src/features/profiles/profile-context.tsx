import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { neonClient } from "../../lib/neon-client";
import { authenticatedApiToken } from "../../lib/auth-token";

export type Profile = {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  industry: string | null;
  timezone: string;
  locale: string;
  onboarding_completed: boolean;
  created_at: string;
  tenant_type: "CUSTOMER_REAL" | "QA_EPHEMERAL" | "DEMO_PERSISTENT";
  external_publishing_enabled: boolean;
};

type CreateProfileInput = {
  name: string;
  websiteUrl?: string;
  industry?: string;
};

export type UpdateProfileInput = {
  name?: string;
  website_url?: string | null;
  industry?: string | null;
  timezone?: string;
  locale?: string;
};

type ProfileContextValue = {
  profiles: Profile[];
  selectedProfile: Profile | null;
  selectedProfileId: string | null;
  setSelectedProfileId: (id: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createProfile: (input: CreateProfileInput) => Promise<Profile>;
  updateProfile: (id: string, input: UpdateProfileInput) => Promise<Profile>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);
const ACTIVE_PROFILE_KEY = "post-automatici.active-profile";
const ONBOARDING_OPERATION_KEY = "post-automatici.onboarding-operation";
const PROFILE_COLUMNS = "id,name,slug,website_url,industry,timezone,locale,onboarding_completed,created_at";

type PendingOnboardingOperation = { operationId: string; fingerprint: string };

function provisioningOperation(fingerprint: string) {
  try {
    const existing = JSON.parse(sessionStorage.getItem(ONBOARDING_OPERATION_KEY) || "null") as PendingOnboardingOperation | null;
    if (existing?.fingerprint === fingerprint && /^[0-9a-f-]{36}$/i.test(existing.operationId)) return existing.operationId;
  } catch { /* replace invalid local state below */ }
  const operationId = crypto.randomUUID();
  sessionStorage.setItem(ONBOARDING_OPERATION_KEY, JSON.stringify({ operationId, fingerprint } satisfies PendingOnboardingOperation));
  return operationId;
}

function profileIdFromUrl() {
  try {
    const value = new URLSearchParams(window.location.search).get("profileId");
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileIdState] = useState<string | null>(() => profileIdFromUrl() || localStorage.getItem(ACTIVE_PROFILE_KEY));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [result, modes] = await Promise.all([
      neonClient.from("profiles").select(PROFILE_COLUMNS).is("archived_at", null).order("created_at", { ascending: true }),
      neonClient.from("profile_tenant_modes").select("profile_id,tenant_type,external_publishing_enabled"),
    ]);
    setLoading(false);
    if (result.error || modes.error) {
      setError("Impossibile caricare le attività. Riprova.");
      return;
    }
    const modeByProfile = new Map((modes.data ?? []).map((mode) => [mode.profile_id, mode]));
    const next = (result.data ?? []).map((row) => {
      const mode = modeByProfile.get(row.id);
      return {
        ...row,
        tenant_type: mode?.tenant_type ?? "CUSTOMER_REAL",
        external_publishing_enabled: mode?.external_publishing_enabled ?? true,
      };
    }) as Profile[];
    setProfiles(next);
    setSelectedProfileIdState((current) => {
      const urlProfileId = profileIdFromUrl();
      const preferred = urlProfileId && next.some((profile) => profile.id === urlProfileId) ? urlProfileId : current;
      const resolved = preferred && next.some((profile) => profile.id === preferred) ? preferred : next[0]?.id ?? null;
      if (resolved) localStorage.setItem(ACTIVE_PROFILE_KEY, resolved);
      else localStorage.removeItem(ACTIVE_PROFILE_KEY);
      return resolved;
    });
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const setSelectedProfileId = useCallback((id: string) => {
    setSelectedProfileIdState(id);
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  }, []);

  const createProfile = useCallback(async (input: CreateProfileInput) => {
    const name = input.name.trim();
    if (!name) throw new Error("Il nome dell’attività è obbligatorio.");
    const normalized = { name, websiteUrl: input.websiteUrl?.trim() || null, industry: input.industry?.trim() || null };
    const fingerprint = JSON.stringify(normalized);
    const operationId = provisioningOperation(fingerprint);
    const token = await authenticatedApiToken();
    const response = await fetch("/api/onboarding-provision", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ operationId, ...normalized }),
    });
    const result = await response.json() as { profile?: Profile; error?: string };
    if (!response.ok || !result.profile) {
      if (result.error === "ONBOARDING_IDEMPOTENCY_CONFLICT") sessionStorage.removeItem(ONBOARDING_OPERATION_KEY);
      throw new Error(result.error === "ONBOARDING_WEBSITE_INVALID" ? "Inserisci un indirizzo web valido." : "Impossibile creare il profilo.");
    }
    sessionStorage.removeItem(ONBOARDING_OPERATION_KEY);
    const created = { ...result.profile, tenant_type: "CUSTOMER_REAL", external_publishing_enabled: true } as Profile;
    setProfiles((rows) => [...rows, created]);
    setSelectedProfileId(created.id);
    return created;
  }, [setSelectedProfileId]);

  const updateProfile = useCallback(async (id: string, input: UpdateProfileInput) => {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("Il nome dell’attività non può essere vuoto.");
      payload.name = name;
    }
    if (input.website_url !== undefined) payload.website_url = input.website_url?.trim() || null;
    if (input.industry !== undefined) payload.industry = input.industry?.trim() || null;
    if (input.timezone !== undefined) payload.timezone = input.timezone.trim() || "Europe/Rome";
    if (input.locale !== undefined) payload.locale = input.locale.trim() || "it-IT";

    const result = await neonClient.from("profiles").update(payload).eq("id", id).select(PROFILE_COLUMNS).single();
    if (result.error || !result.data) throw new Error("Salvataggio attività non riuscito. Riprova.");
    const current = profiles.find((profile) => profile.id === id);
    const updated = {
      ...result.data,
      tenant_type: current?.tenant_type ?? "CUSTOMER_REAL",
      external_publishing_enabled: current?.external_publishing_enabled ?? true,
    } as Profile;
    setProfiles((rows) => rows.map((profile) => profile.id === id ? updated : profile));
    return updated;
  }, [profiles]);

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedProfileId) ?? null, [profiles, selectedProfileId]);

  const value = useMemo<ProfileContextValue>(() => ({ profiles, selectedProfile, selectedProfileId, setSelectedProfileId, loading, error, reload, createProfile, updateProfile }), [profiles, selectedProfile, selectedProfileId, setSelectedProfileId, loading, error, reload, createProfile, updateProfile]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfiles() {
  const context = useContext(ProfileContext);
  if (!context) throw new Error("useProfiles deve essere usato dentro ProfileProvider");
  return context;
}
