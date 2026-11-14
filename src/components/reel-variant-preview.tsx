import { useEffect, useState } from "react";
import { neonClient } from "../lib/neon-client";

/** Video preview for REEL variants in Revisioni. Reads only the profile's own VIDEO asset through RLS. */
export function ReelVariantPreview({ profileId, contentId, posterUrl }: { profileId: string; contentId: string; posterUrl?: string | null }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [state, setState] = useState<"LOADING" | "READY" | "MISSING">("LOADING");
  useEffect(() => {
    let cancelled = false;
    setState("LOADING");
    void neonClient.from("assets").select("storage_url,quality_status,created_at").eq("profile_id", profileId).eq("content_id", contentId).eq("kind", "VIDEO").order("created_at", { ascending: false }).limit(1)
      .then((result) => {
        if (cancelled) return;
        const row = (result.data ?? [])[0] as { storage_url?: string } | undefined;
        setVideoUrl(row?.storage_url ?? null);
        setState(row?.storage_url ? "READY" : "MISSING");
      });
    return () => { cancelled = true; };
  }, [profileId, contentId]);
  if (state === "LOADING") return <div className="no-image-state">Caricamento anteprima video…</div>;
  if (!videoUrl) return <div className="no-image-state">Video del Reel non trovato: rigeneralo dalla pagina Contenuti.</div>;
  return <figure className="approval-image"><video src={videoUrl} poster={posterUrl ?? undefined} controls playsInline preload="metadata" style={{ width: "100%", maxWidth: 320, aspectRatio: "9 / 16", borderRadius: 14, background: "#111713" }} /><figcaption>Reel 9:16 · MP4 H.264/AAC con sottotitoli</figcaption></figure>;
}
