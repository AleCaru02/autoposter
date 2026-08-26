import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Globe2, RefreshCw } from "lucide-react";
import { NavLink } from "react-router-dom";
import { authClient, neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type Scan = {
  id: string;
  state: string;
  root_url: string;
  discovered_pages: number;
  analyzed_pages: number;
  skipped_pages: number;
  failed_pages: number;
  page_limit: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

type ScanPage = {
  id: string;
  url: string;
  status: string;
  depth: number;
  title: string | null;
  skip_reason: string | null;
  error: string | null;
};

type JwtAuth = { getJWTToken?: () => Promise<string | null> };

export function WebsiteScanPage() {
  const { selectedProfile } = useProfiles();
  const [scan, setScan] = useState<Scan | null>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    setLoading(true); setError(null);
    const scanResult = await neonClient.from("website_scans").select("id,state,root_url,discovered_pages,analyzed_pages,skipped_pages,failed_pages,page_limit,error,created_at,finished_at").eq("profile_id", profileId).order("created_at", { ascending: false }).limit(1);
    if (scanResult.error) { setLoading(false); setError(scanResult.error.message); return; }
    const latest = (scanResult.data?.[0] ?? null) as Scan | null;
    setScan(latest);
    if (!latest) { setPages([]); setLoading(false); return; }
    const pageResult = await neonClient.from("website_pages").select("id,url,status,depth,title,skip_reason,error").eq("profile_id", profileId).eq("scan_id", latest.id).order("depth", { ascending: true }).order("url", { ascending: true });
    setLoading(false);
    if (pageResult.error) { setError(pageResult.error.message); return; }
    setPages((pageResult.data ?? []) as ScanPage[]);
  }, [selectedProfile?.id]);

  useEffect(() => { void load(); }, [load]);

  async function startScan() {
    if (!selectedProfile?.id || !selectedProfile.website_url) return;
    setRunning(true); setError(null);
    try {
      const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
      if (!token) throw new Error("Sessione non valida: effettua nuovamente l’accesso.");
      const response = await fetch("/api/website-scan", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ profileId: selectedProfile.id, pageLimit: 500 }) });
      const body = await response.json() as { error?: string; detail?: string };
      if (!response.ok) throw new Error(body.detail || body.error || "Scansione non riuscita.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Scansione non riuscita.");
    } finally {
      setRunning(false);
    }
  }

  if (!selectedProfile) return null;
  const coverage = scan?.discovered_pages ? Math.round((scan.analyzed_pages / scan.discovered_pages) * 100) : 0;
  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Sito · {selectedProfile.name}</p><h1>Analisi pagina per pagina</h1><p>Il crawler segue le pagine interne e la sitemap. Ogni URL viene salvato con stato e copertura reale.</p></div><button className="primary-button" type="button" disabled={running || !selectedProfile.website_url} onClick={() => void startScan()}><RefreshCw size={16} className={running ? "spin" : ""} /> {running ? "Analisi in corso…" : scan ? "Nuova scansione" : "Analizza sito"}</button></header>{error && <p className="form-error">{error}</p>}{!selectedProfile.website_url ? <section className="unavailable-panel"><Globe2 size={24} /><div><h2>Sito non configurato</h2><p>Inserisci prima il sito dell’attività nella pagina Brand.</p><NavLink className="text-link" to="/app/brand">Apri Brand</NavLink></div></section> : loading ? <section className="panel">Caricamento scansione…</section> : !scan ? <section className="panel empty-panel"><Globe2 size={26} /><h2>Nessuna scansione</h2><p>Il sito configurato è {selectedProfile.website_url}. Avvia l’analisi per verificare le singole pagine.</p></section> : <><section className="scan-summary"><article><span>Stato</span><strong className={scan.state === "COMPLETE" ? "status-ok" : "status-wait"}>{scan.state}</strong></article><article><span>Pagine rilevate</span><strong>{scan.discovered_pages}</strong></article><article><span>Analizzate</span><strong>{scan.analyzed_pages}</strong></article><article><span>Saltate</span><strong>{scan.skipped_pages}</strong></article><article><span>Errori</span><strong>{scan.failed_pages}</strong></article><article><span>Copertura</span><strong>{coverage}%</strong></article></section>{scan.state !== "COMPLETE" && <p className="coverage-warning">Copertura non completa. Motivo: {scan.error || "alcune pagine non sono state analizzate"}. Il sistema non considera il sito interamente analizzato.</p>}<section className="panel"><div className="panel-heading"><div><h2>Pagine della scansione</h2><p>{scan.root_url}</p></div><span>{pages.length} record salvati</span></div><div className="scan-pages">{pages.map((page) => <article className="scan-page-row" key={page.id}><div className={`scan-dot ${page.status.toLowerCase()}`} /><div className="scan-page-copy"><strong>{page.title || new URL(page.url).pathname || "/"}</strong><a href={page.url} target="_blank" rel="noreferrer">{page.url} <ExternalLink size={12} /></a>{(page.skip_reason || page.error) && <small>{page.skip_reason || page.error}</small>}</div><div className="scan-page-meta"><span>{page.status}</span><small>profondità {page.depth}</small></div></article>)}</div></section></>}</div>;
}
