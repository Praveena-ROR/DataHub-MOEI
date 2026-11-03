import type { IconName } from './Icon.tsx';
import type { Session } from '../data/types.ts';

export type NavKey = 'dashboard' | 'requests' | 'reviews' | 'admin';

const NAV: { key: NavKey; label: string; icon: IconName; for: 'division' | 'admin' | 'all' | 'system' }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'layers', for: 'all' },
  { key: 'requests', label: 'My Requests', icon: 'drafts', for: 'division' },
  { key: 'reviews', label: 'Review', icon: 'shield', for: 'admin' },
  { key: 'admin', label: 'Admin Centre', icon: 'settings', for: 'system' },
];

/**
 * Sidebar items for a session. DG Admin sees Dashboard, Review and Admin Centre;
 * Admin (UserRole = Admin) sees only the Admin Centre; a business division sees
 * Dashboard and My Requests. Visibility is convenience only: every load and write re-checks the role.
 */
export function navItemsFor(session: Pick<Session, 'isAdmin' | 'isSystemAdmin' | 'division'>) {
  if (session.isSystemAdmin && !session.isAdmin) return NAV.filter((n) => n.for === 'system');
  return NAV.filter((n) => n.for === 'all' || (n.for === 'admin' || n.for === 'system' ? session.isAdmin : n.for === 'division' && !!session.division));
}

/**
 * First screen after sign-in, decided by myapp_userrole: BusinessDivision → the
 * division Dashboard, DG Admin → the DG Admin Dashboard, Admin → Admin Centre.
 */
export function landingFor(session: Pick<Session, 'isAdmin' | 'isSystemAdmin' | 'division'>): { key: NavKey; label: string } {
  const item = navItemsFor(session)[0];
  return { key: item.key, label: item.key === 'dashboard' ? (session.isAdmin ? 'DG Admin Dashboard' : 'Division Dashboard') : item.label };
}
