import { NavLink, Outlet, useLocation } from 'react-router';
import { Seo } from './Seo';
import { useLocalE2E } from '../services/local-e2e';

const groups = [
  { label: 'Home', items: [['Panoramica', '/app', '⌂']] },
  { label: 'Attività', items: [['Sito', '/app/site', '⌕'], ['Brand', '/app/brand', 'B']] },
  { label: 'Contenuti', items: [['Contenuti', '/app/contents', '✦'], ['Calendario', '/app/calendar', '□'], ['Approvazioni', '/app/approvals', '✓'], ['Asset Library', '/app/assets', '▧']] },
  { label: 'Strategia', items: [['Strategia', '/app/strategy', '◇']] },
  { label: 'Risultati', items: [['Analytics', '/app/analytics', '↗']] },
  { label: 'Connessioni', items: [['Social', '/app/connections', '◎'], ['Notifiche', '/app/notifications', '•']] },
  { label: 'Account', items: [['Impostazioni', '/app/settings', '⚙'], ['Supporto', '/app/support', '?']] },
] as const;

const mobileItems = [['Home', '/app', '⌂'], ['Contenuti', '/app/contents', '✦'], ['Calendario', '/app/calendar', '□'], ['Approva', '/app/approvals', '✓'], ['Altro', '/app/settings', '••']] as const;

export function AppShell() {
  const location = useLocation();
  const local = useLocalE2E();
  const activeTenant = local.tenants.find((tenant) => tenant.id === local.tenantId);
  const activeName = String(local.workspace?.tenant?.name ?? activeTenant?.name ?? (local.enabled ? 'Nessuna attività' : 'Backend da configurare'));
  const initials = activeName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'PA';

  return <div className="app-shell">
    <Seo title="Workspace | Post Automatici" description="Area privata Post Automatici" path={location.pathname} noIndex />
    <aside className="sidebar">
      <NavLink className="brand-mark" to="/app"><span className="brand-symbol">P</span><span><strong>Post Automatici</strong><small>Workspace personale</small></span></NavLink>
      <div className="tenant-switcher">
        <span className="avatar">{initials}</span>
        <div className="grow">
          <small>Attività attiva</small>
          {local.enabled && local.token ? <select aria-label="Cambia attività" value={local.tenantId ?? ''} onChange={(event) => { if (event.target.value) void local.selectTenant(event.target.value); }}>
            <option value="" disabled>{local.tenants.length ? 'Seleziona attività' : 'Nessuna attività'}</option>
            {local.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select> : <strong>{activeName}</strong>}
        </div>
        {local.enabled && local.token ? <NavLink className="icon-button" to="/onboarding?new=1" aria-label="Crea nuova attività">+</NavLink> : null}
      </div>
      <nav className="side-nav" aria-label="Navigazione principale">
        {groups.map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map(([label, href, icon]) => <NavLink key={href} to={href} end={href === '/app'} className={({ isActive }) => isActive ? 'active' : ''}><span className="nav-icon">{icon}</span><span>{label}</span></NavLink>)}</div>)}
      </nav>
      <div className="sidebar-footer" aria-label="Stato integrazioni"><div><span className="status-dot" /><strong>{local.enabled ? 'Persistenza locale attiva' : 'Backend non collegato'}</strong></div><small>OpenAI e provider social: da configurare</small></div>
    </aside>
    <main className="main-column">
      <div className="topbar"><div className="topbar-title"><span className="crumb">{activeName}</span><strong>{pageName(location.pathname)}</strong></div><div className="top-actions"><span className="pill"><span className="status-dot"/>{local.enabled ? 'Locale' : 'Da configurare'}</span><NavLink className="icon-button" to="/app/notifications" aria-label="Notifiche">•</NavLink><span className="user-chip">AC</span></div></div>
      <div className="content"><Outlet /></div>
    </main>
    <nav className="mobile-bottom-nav" aria-label="Navigazione mobile">{mobileItems.map(([label,href,icon])=><NavLink key={href} to={href} end={href==='/app'} className={({isActive})=>isActive?'active':''}><span>{icon}</span><small>{label}</small></NavLink>)}</nav>
  </div>;
}

function pageName(path: string) {
  const entries: Array<[RegExp,string]> = [
    [/^\/app$/, 'Panoramica'], [/site/, 'Sito'], [/contents/, 'Contenuti'], [/calendar/, 'Calendario'], [/approvals|^\/approvals/, 'Approvazioni'], [/assets/, 'Asset Library'], [/strategy/, 'Strategia'], [/brand/, 'Brand'], [/analytics/, 'Analytics'], [/connections/, 'Social'], [/notifications/, 'Notifiche'], [/settings/, 'Impostazioni'], [/support/, 'Supporto'], [/admin\/providers/, 'Provider Console'], [/admin/, 'Admin'], [/onboarding/, 'Onboarding'], [/posts/, 'Contenuto'],
  ];
  return entries.find(([pattern]) => pattern.test(path))?.[1] ?? 'Workspace';
}
