import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import logoLight from '../assets/dewa-logo-light.svg';
import { Icon } from './Icon.tsx';
import { navItemsFor, type NavKey } from './nav.ts';
import { initials } from './format.ts';
import type { Session } from '../data/types.ts';

export type { NavKey };

export function AppShell({ session, active, onNavigate, onSignOut, children }: {
  session: Session; active: NavKey; onNavigate: (key: NavKey) => void; onSignOut: () => void; children: ReactNode;
}) {
  const items = navItemsFor(session);
  const role = [session.division?.name, session.isAdmin ? session.roleLabel ?? 'DG Admin' : session.isSystemAdmin ? session.roleLabel ?? 'Admin' : null].filter(Boolean).join(' · ');
  // Wide screens: the sidebar collapses to an icon rail (remembered per browser).
  // Narrow screens: it is an off-canvas drawer, closed by default.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const narrow = useMediaQuery(NARROW_QUERY);
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); }, [collapsed]);
  useEffect(() => { if (!narrow) setDrawerOpen(false); }, [narrow]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);
  const expanded = narrow ? drawerOpen : !collapsed;
  const toggle = () => (narrow ? setDrawerOpen((o) => !o) : setCollapsed((c) => !c));
  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand">
          <button className="nav-toggle" onClick={toggle} aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={expanded} aria-controls="app-sidebar">
            <Icon name="menu" size={20} />
          </button>
          <img src={logoLight} alt="Dubai Electricity & Water Authority" className="logo-topbar" />
        </div>
        <div className="topbar-title">MOEI Yearly Datasets Integration</div>
        <div className="topbar-right">
          <ProfileMenu session={session} role={role} onSignOut={onSignOut} />
          <button className="btn btn-outline btn-sm" onClick={onSignOut} aria-label="Sign out">
            <Icon name="logout" /><span className="signout-label">Sign out</span>
          </button>
        </div>
      </header>
      <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <aside className="sidebar" id="app-sidebar">
        <nav aria-label="Main">
          {items.map((n) => (
            <button
              key={n.key}
              className={`nav-item${active === n.key ? ' active' : ''}`}
              onClick={() => { onNavigate(n.key); setDrawerOpen(false); }}
              aria-current={active === n.key ? 'page' : undefined}
              title={collapsed && !narrow ? n.label : undefined}
            >
              <Icon name={n.icon} size={18} />
              <span className="nav-label">{n.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

const COLLAPSED_KEY = 'moei.sidebarCollapsed';
const NARROW_QUERY = '(max-width: 960px)';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Avatar button that opens a small card with the user's details from tbl_MOEI_UserDetails and Sign out. */
function ProfileMenu({ session, role, onSignOut }: { session: Session; role: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const { user } = session;
  const details: [string, string | undefined][] = [
    ['User ID', user.userId],
    ['Email', user.upn],
    ['Role', session.role],
    ['Designation', session.designation],
    ['Division', session.division?.name],
  ];
  return (
    <div className="profile" ref={ref}>
      <button className="profile-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label="Your profile">
        <span className="avatar" aria-hidden="true">{initials(user.fullName)}</span>
        <span className="profile-text">
          <span className="profile-name">{user.fullName}</span>
          <span className="profile-role">{role}</span>
        </span>
      </button>
      {open && (
        <div className="profile-card" role="dialog" aria-label="Profile">
          <div className="profile-card-head">
            <span className="avatar avatar-lg" aria-hidden="true">{initials(user.fullName)}</span>
            <div className="profile-card-name">{user.fullName}</div>
            <button className="btn btn-outline btn-sm profile-card-signout" onClick={() => { setOpen(false); onSignOut(); }}>
              <Icon name="logout" />Sign out
            </button>
          </div>
          <dl className="kv profile-card-kv">
            {details.filter(([k, v]) => v && !(k === 'Division' && v === session.designation)).map(([k, v]) => (
              <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
