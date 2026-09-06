import { useEffect, useRef, useState } from "react";
import { BarChart3, Bot, Building2, CalendarDays, FileCheck2, FileText, Globe2, LayoutDashboard, LogOut, Menu, Settings2, Share2, Sparkles, X } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";
import { ImpersonationBanner } from "./impersonation-banner";
import { ProductBrand } from "./product-brand";

const links = [
  ["Dashboard", "/app/dashboard", LayoutDashboard],
  ["Attività", "/app/profili", Building2],
  ["Brand", "/app/brand", Sparkles],
  ["Sito", "/app/sito", Globe2],
  ["Contenuti", "/app/contenuti", FileText],
  ["Revisioni", "/app/approvazioni", FileCheck2],
  ["Calendario", "/app/calendario", CalendarDays],
  ["Social", "/app/social", Share2],
  ["Analytics", "/app/analytics", BarChart3],
  ["Apprendimento", "/app/apprendimento", Bot],
  ["Impostazioni", "/app/impostazioni", Settings2],
] as const;

const mobilePrimaryLinks = [links[0], links[4], links[6], links[7]] as const;
const mobileMoreLinks = [links[1], links[2], links[3], links[5], links[8], links[9], links[10]] as const;

const navigationGroups = [
  { label: "Oggi", items: [links[0]] },
  { label: "Crea e pubblica", items: [links[4], links[5], links[6]] },
  { label: "Canali e risultati", items: [links[7], links[8], links[9]] },
  { label: "La tua attività", items: [links[1], links[2], links[3], links[10]] },
] as const;

export function AppShell() {
  const navigate = useNavigate();
  const { profiles, selectedProfileId, setSelectedProfileId, loading } = useProfiles();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMoreCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileMoreCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMoreOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      mobileMoreButtonRef.current?.focus();
    };
  }, [mobileMoreOpen]);

  async function signOut() {
    setMobileMoreOpen(false);
    await authClient.signOut();
    navigate("/login", { replace: true });
  }

  function closeMobileMore() {
    setMobileMoreOpen(false);
  }

  return <div className="shell">
    <a className="skip-link" href="#main-content">Vai al contenuto</a>
    <ImpersonationBanner />
    <aside className="sidebar">
      <NavLink className="sidebar-home" to="/app/dashboard" aria-label="Post Automatici, dashboard"><ProductBrand /></NavLink>
      <label className="profile-switcher profile-switcher-top"><span>Attività attiva</span><select disabled={loading || profiles.length === 0} value={selectedProfileId ?? ""} onChange={(event) => setSelectedProfileId(event.target.value)}>{profiles.length === 0 && <option value="">Nessuna attività</option>}{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      <nav aria-label="Navigazione principale">{navigationGroups.map((group) => <section className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([label, href, Icon]) => <NavLink key={href} to={href} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon size={18} /><span>{label}</span></NavLink>)}</section>)}</nav>
      <button type="button" className="nav-link logout" onClick={signOut}><LogOut size={17} /><span>Esci</span></button>
    </aside>

    <div className="shell-workspace">
      <header className="mobile-header"><NavLink to="/app/dashboard" aria-label="Post Automatici, dashboard"><ProductBrand compact /></NavLink><label className="mobile-header-profile"><span className="sr-only">Attività attiva</span><select disabled={loading || profiles.length === 0} value={selectedProfileId ?? ""} onChange={(event) => setSelectedProfileId(event.target.value)}>{profiles.length === 0 && <option value="">Nessuna attività</option>}{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label></header>
      <main className="shell-main" id="main-content" tabIndex={-1}><Outlet /></main>
    </div>

    {mobileMoreOpen && <div className="mobile-more-backdrop" role="presentation" onClick={closeMobileMore}><section className="mobile-more-menu" role="dialog" aria-modal="true" aria-label="Altre sezioni" onClick={(event) => event.stopPropagation()}>
      <div className="mobile-more-head"><div><small>Attività attiva</small><label className="profile-switcher mobile-profile-switcher"><span className="sr-only">Seleziona attività</span><select disabled={loading || profiles.length === 0} value={selectedProfileId ?? ""} onChange={(event) => setSelectedProfileId(event.target.value)}>{profiles.length === 0 && <option value="">Nessuna attività</option>}{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label></div><button ref={mobileMoreCloseRef} type="button" className="mobile-more-close" aria-label="Chiudi menu" onClick={closeMobileMore}><X size={20} /></button></div>
      <nav className="mobile-more-links">{mobileMoreLinks.map(([label, href, Icon]) => <NavLink key={href} to={href} onClick={closeMobileMore} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
      <button type="button" className="nav-link mobile-signout" onClick={() => void signOut()}><LogOut size={18} /><span>Esci</span></button>
    </section></div>}

    <nav className="mobile-nav" aria-label="Navigazione principale mobile">{mobilePrimaryLinks.map(([label, href, Icon]) => <NavLink key={href} to={href} onClick={closeMobileMore} className={({ isActive }) => `mobile-nav-link ${isActive ? "active" : ""}`}><Icon size={18} /><span>{label}</span></NavLink>)}<button ref={mobileMoreButtonRef} type="button" className={`mobile-nav-link mobile-more-trigger ${mobileMoreOpen ? "active" : ""}`} aria-expanded={mobileMoreOpen} aria-haspopup="dialog" aria-label={mobileMoreOpen ? "Chiudi altre sezioni" : "Apri altre sezioni"} onClick={() => setMobileMoreOpen((value) => !value)}>{mobileMoreOpen ? <X size={18} /> : <Menu size={18} />}<span>Altro</span></button></nav>
  </div>;
}
