import { NavLink, Outlet, useLocation } from 'react-router';
import { Seo } from './Seo';

const groups = [
  { label: 'Home', items: [['Panoramica', '/app', '⌂']] },
  { label: 'Contenuti', items: [['Calendario', '/app/calendar', '□'], ['Approvazioni', '/app/approvals', '✓'], ['Asset Library', '/app/assets', '▧']] },
  { label: 'Strategia', items: [['Strategia', '/app/strategy', '◇'], ['Brand', '/app/brand', 'B']] },
  { label: 'Risultati', items: [['Analytics', '/app/analytics', '↗']] },
  { label: 'Connessioni', items: [['Social', '/app/connections', '◎'], ['Notifiche', '/app/notifications', '•']] },
  { label: 'Account', items: [['Piano e quote', '/app/billing', '◫'], ['Impostazioni', '/app/settings', '⚙'], ['Supporto', '/app/support', '?'], ['Admin', '/admin', 'A']] },
] as const;

const mobileItems = [['Home', '/app', '⌂'], ['Calendario', '/app/calendar', '□'], ['Approva', '/app/approvals', '✓'], ['Analytics', '/app/analytics', '↗'], ['Altro', '/app/settings', '••']] as const;

export function AppShell() {
  const location = useLocation();
  return <div className="app-shell">
    <Seo title="Workspace | SocialPilot AI" description="Area privata SocialPilot AI" path={location.pathname} noIndex />
    <aside className="sidebar">
      <NavLink className="brand-mark" to="/app"><span className="brand-symbol">S</span><span><strong>SocialPilot AI</strong><small>Workspace</small></span></NavLink>
      <div className="tenant-switcher"><span className="avatar">DS</span><div><strong>Demo Studio</strong><small>Brand attivo</small></div><button type="button" aria-label="Cambia workspace">⌄</button></div>
      <nav className="side-nav" aria-label="Navigazione principale">
        {groups.map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map(([label, href, icon]) => <NavLink key={href} to={href} end={href === '/app'} className={({ isActive }) => isActive ? 'active' : ''}><span className="nav-icon">{icon}</span><span>{label}</span></NavLink>)}</div>)}
      </nav>
      <div className="sidebar-footer"><div><span className="status-dot" /><strong>Sistema operativo</strong></div><small>Provider live non ancora attivati</small></div>
    </aside>
    <main className="main-column">
      <div className="topbar"><div className="topbar-title"><span className="crumb">Demo Studio</span><strong>{pageName(location.pathname)}</strong></div><div className="top-actions"><span className="pill"><span className="status-dot"/>Local Dev</span><NavLink className="icon-button" to="/app/notifications" aria-label="Notifiche">3</NavLink><span className="user-chip">AC</span></div></div>
      <div className="content"><Outlet /></div>
    </main>
    <nav className="mobile-bottom-nav" aria-label="Navigazione mobile">{mobileItems.map(([label,href,icon])=><NavLink key={href} to={href} end={href==='/app'} className={({isActive})=>isActive?'active':''}><span>{icon}</span><small>{label}</small></NavLink>)}</nav>
  </div>;
}

function pageName(path: string) {
  const entries: Array<[RegExp,string]> = [
    [/^\/app$/, 'Panoramica'], [/calendar/, 'Calendario'], [/approvals|^\/approvals/, 'Approvazioni'], [/assets/, 'Asset Library'], [/strategy/, 'Strategia'], [/brand/, 'Brand'], [/analytics/, 'Analytics'], [/connections/, 'Social Connections'], [/notifications/, 'Notifiche'], [/billing/, 'Piano e quote'], [/settings/, 'Impostazioni'], [/support/, 'Supporto'], [/admin\/providers/, 'Provider Console'], [/admin/, 'Admin'], [/onboarding/, 'Onboarding'], [/posts/, 'Contenuto'],
  ];
  return entries.find(([pattern]) => pattern.test(path))?.[1] ?? 'Workspace';
}
