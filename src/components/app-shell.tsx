import { BarChart3, Bot, Building2, CalendarDays, FileCheck2, FileText, Globe2, LayoutDashboard, LogOut, Settings2, Share2, Sparkles } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

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

const mobileLinks = [links[0], links[4], links[6], links[7], links[8]] as const;

export function AppShell() {
  const navigate = useNavigate();
  const { profiles, selectedProfileId, setSelectedProfileId, loading } = useProfiles();

  async function signOut() {
    await authClient.signOut();
    navigate("/login", { replace: true });
  }

  return <div className="shell"><aside className="sidebar"><label className="profile-switcher profile-switcher-top"><span>Attività</span><select disabled={loading || profiles.length === 0} value={selectedProfileId ?? ""} onChange={(event) => setSelectedProfileId(event.target.value)}>{profiles.length === 0 && <option value="">Nessuna attività</option>}{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><nav>{links.map(([label, href, Icon]) => <NavLink key={href} to={href} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon size={17} /><span>{label}</span></NavLink>)}</nav><button type="button" className="nav-link logout" onClick={signOut}><LogOut size={17} /><span>Esci</span></button></aside><main className="shell-main"><Outlet /></main><nav className="mobile-nav">{mobileLinks.map(([label, href, Icon]) => <NavLink key={href} to={href} className={({ isActive }) => `mobile-nav-link ${isActive ? "active" : ""}`}><Icon size={18} /><span>{label}</span></NavLink>)}</nav></div>;
}
