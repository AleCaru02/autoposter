import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { neonClient } from "../../lib/neon-client";

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
  deleteProfile: (id: string) => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);
const ACTIVE_PROFILE_KEY = "post-automatici.active-profile";
const PROFILE_COLUMNS = "id,name,slug,website_url,industry,timezone,locale,onboarding_completed,created_at";

function slugify(value: string) {
  const base = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "attivita";
  return `${base}-${crypto.randomUUID().slice(0, 7)}`;
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileIdState] = useState<string | null>(() => localStorage.getItem(ACTIVE_PROFILE_KEY));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await neonClient.from("profiles").select(PROFILE_COLUMNS).is("archived_at", null).order("created_at", { ascending: true });
    setLoading(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const next = (result.data ?? []) as Profile[];
    setProfiles(next);
    setSelectedProfileIdState((current) => {
      const resolved = current && next.some((profile) => profile.id === current) ? current : next[0]?.id ?? null;
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
    const result = await neonClient.from("profiles").insert({
      name,
      slug: slugify(name),
      website_url: input.websiteUrl?.trim() || null,
      industry: input.industry?.trim() || null,
    }).select(PROFILE_COLUMNS).single();
    if (result.error || !result.data) throw new Error(result.error?.message ?? "Impossibile creare il profilo.");
    const created = result.data as Profile;
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
    if (result.error || !result.data) throw new Error(result.error?.message ?? "Salvataggio attività non riuscito.");
    const updated = result.data as Profile;
    setProfiles((rows) => rows.map((profile) => profile.id === id ? updated : profile));
    return updated;
  }, []);

  const deleteProfile = useCallback(async (id: string) => {
    const result = await neonClient.from("profiles").delete().eq("id", id).select("id");
    if (result.error) throw new Error(result.error.message);
    await reload();
  }, [reload]);

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedProfileId) ?? null, [profiles, selectedProfileId]);

  const value = useMemo<ProfileContextValue>(() => ({ profiles, selectedProfile, selectedProfileId, setSelectedProfileId, loading, error, reload, createProfile, updateProfile, deleteProfile }), [profiles, selectedProfile, selectedProfileId, setSelectedProfileId, loading, error, reload, createProfile, updateProfile, deleteProfile]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfiles() {
  const context = useContext(ProfileContext);
  if (!context) throw new Error("useProfiles deve essere usato dentro ProfileProvider");
  return context;
}
