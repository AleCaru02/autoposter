import { useEffect, useState } from "react";
import { authenticatedApiToken } from "./auth-token";

/**
 * Avatar Reels and identity materials live in a private store: the database holds
 * "private:<pathname>", and the browser asks the server for a 5-minute signed URL after an
 * ownership check. Public URLs (faceless Reels) are returned unchanged.
 */
export function isPrivateMedia(url: string | null | undefined) {
  return typeof url === "string" && url.startsWith("private:");
}

export async function signedMediaUrl(profileId: string, storageUrl: string) {
  const token = await authenticatedApiToken();
  const response = await fetch("/api/avatar/media/url", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ profileId, storageUrl }),
  });
  if (!response.ok) throw new Error("PRIVATE_MEDIA_UNAVAILABLE");
  return (await response.json() as { url: string }).url;
}

export function useResolvedMediaUrl(profileId: string, url: string | null | undefined) {
  const [resolved, setResolved] = useState<string | null>(isPrivateMedia(url) ? null : url ?? null);
  useEffect(() => {
    let cancelled = false;
    if (!url) { setResolved(null); return; }
    if (!isPrivateMedia(url)) { setResolved(url); return; }
    setResolved(null);
    void signedMediaUrl(profileId, url).then((signed) => { if (!cancelled) setResolved(signed); }).catch(() => { if (!cancelled) setResolved(null); });
    return () => { cancelled = true; };
  }, [profileId, url]);
  return resolved;
}

/** 9:16 player that works for public and private Reel files. */
export function ReelVideo({ profileId, src, poster, className, style }: { profileId: string; src: string | null; poster?: string | null; className?: string; style?: React.CSSProperties }) {
  const video = useResolvedMediaUrl(profileId, src);
  const cover = useResolvedMediaUrl(profileId, poster ?? null);
  if (!video) return <div className="no-image-state">{src ? "Caricamento del video privato…" : "Video non disponibile"}</div>;
  return <video className={className} style={style} src={video} poster={cover ?? undefined} controls playsInline preload="metadata" />;
}
