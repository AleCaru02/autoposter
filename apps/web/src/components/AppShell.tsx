import { NavLink, Outlet } from 'react-router';
import { navigation } from '../app/demo-data';

export function AppShell() {
  return <div className="app-shell">
    <aside className="sidebar">
      <NavLink className="brand-mark" to="/app"><span className="brand-symbol">S</span><span><strong>SocialPilot AI</strong><small>Development</small></span></NavLink>
      <div className="tenant-switcher"><span className="avatar">DS</span><div><strong>Demo Studio</strong><small>Tenant demo locale</small></div></div>
      <nav className="side-nav" aria-label="Navigazione principale">
        {navigation.map(([label, href]) => <NavLink key={href} to={href} end={href === '/app'} className={({ isActive }) => isActive ? 'active' : ''}>{label}</NavLink>)}
      </nav>
      <div className="sidebar-footer"><span className="status-dot" /> Modalità mock · nessuna API reale</div>
    </aside>
    <main className="main-column">
      <div className="topbar"><div><span className="crumb">Workspace / Demo Studio</span></div><div className="top-actions"><span className="pill">Piano Local Dev</span><button className="icon-button" type="button" aria-label="Notifiche">3</button><span className="user-chip">AC</span></div></div>
      <div className="content"><Outlet /></div>
    </main>
  </div>;
}
