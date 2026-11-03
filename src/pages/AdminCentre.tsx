import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { Alert, PageHeader, Spinner } from '../components/ui.tsx';
import { loadAdminCentre, type AdminCentreData } from '../data/services.ts';
import type { Session } from '../data/types.ts';
import { AdminDatasets } from './AdminDatasets.tsx';
import { AdminUsers } from './AdminUsers.tsx';

type Tab = 'datasets' | 'users';

/** Admin Centre (UserRole = Admin): dataset & attribute management and user management. */
export function AdminCentre({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>('datasets');
  const [data, setData] = useState<AdminCentreData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadAdminCentre());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Admin Centre could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let live = true;
    loadAdminCentre().then(
      (d) => { if (live) { setData(d); setLoading(false); } },
      (e) => { if (live) { setError(e instanceof Error ? e.message : 'The Admin Centre could not be loaded.'); setLoading(false); } },
    );
    return () => { live = false; };
  }, []);

  /** After a save: show the result and reload everything from Dataverse. */
  const saved = (message: string) => { setNotice(message); void reload(); };

  return (
    <>
      <PageHeader
        title="Admin Centre"
        subtitle={data ? `${data.datasets.length} mapped dataset(s) · ${data.users.filter((u) => u.statecode === 0).length} active user(s)` : 'Loading…'}
        actions={<button className="btn btn-outline" onClick={() => void reload()} disabled={loading}><Icon name="refresh" />{loading && data ? 'Refreshing…' : 'Refresh'}</button>}
      />
      <div className="tabs admin-tabs" role="tablist" aria-label="Admin Centre sections">
        <button role="tab" aria-selected={tab === 'datasets'} className={`tab${tab === 'datasets' ? ' active' : ''}`} onClick={() => setTab('datasets')}><Icon name="datasets" size={15} /> Dataset &amp; Attribute Management</button>
        <button role="tab" aria-selected={tab === 'users'} className={`tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}><Icon name="users" size={15} /> User Management</button>
      </div>
      {notice && <Alert tone="success">{notice} <button className="btn btn-link" onClick={() => setNotice(null)}>Dismiss</button></Alert>}
      {error && (
        <Alert tone="error" title="The Admin Centre couldn't be loaded">
          {error}
          <div className="alert-actions"><button className="btn btn-outline" onClick={() => void reload()}><Icon name="refresh" />Try again</button></div>
        </Alert>
      )}
      {!data && loading && <Spinner label="Loading datasets, mappings and users…" />}
      {data && (tab === 'datasets'
        ? <AdminDatasets data={data} onSaved={saved} />
        : <AdminUsers data={data} selfUpn={session.user.upn} onSaved={saved} />)}
    </>
  );
}
