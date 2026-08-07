import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { section: 'System' },
  { to: '/services', label: 'Services' },
  { to: '/processes', label: 'Prozesse' },
  { to: '/logs', label: 'Logs' },
  { to: '/storage', label: 'Speicher' },
  { to: '/network', label: 'Netzwerk' },
  { section: 'Benutzer' },
  { to: '/users', label: 'Benutzer' },
  { to: '/groups', label: 'Gruppen' },
  { section: 'Sicherheit' },
  { to: '/audit', label: 'Audit Log' },
  { to: '/settings', label: 'Einstellungen' },
] as const;

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>CodigoWorks</strong>
          <span>Server Panel</span>
        </div>
        <nav>
          {links.map((item, idx) =>
            'section' in item ? (
              <div className="nav-section" key={`s-${idx}`}>
                {item.section}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <div style={{ marginTop: '1.5rem', padding: '0.6rem' }}>
          <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            {user?.username} · {user?.role}
          </div>
          <button className="btn" style={{ width: '100%' }} onClick={() => void logout()}>
            Abmelden
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
