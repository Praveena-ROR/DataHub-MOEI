import { useCallback, useEffect, useState } from 'react';
import { AppShell, type NavKey } from './components/AppShell.tsx';
import { landingFor } from './components/nav.ts';
import { Alert, ConfirmDialog, Spinner } from './components/ui.tsx';
import { Icon } from './components/Icon.tsx';
import { BusinessAdminAssistant } from './components/assistant/BusinessAdminAssistant.tsx';
import { loadAdminOverview, loadDivisionWorkspace, resolveAccess, type AdminOverview, type DivisionWorkspace } from './data/services.ts';
import type { Session } from './data/types.ts';
import { AdminCentre } from './pages/AdminCentre.tsx';
import { canManage } from './data/workflow.ts';
import { AdminDashboard } from './pages/AdminDashboard.tsx';
import { AdminRequests, type ReviewFilters, type ReviewState } from './pages/AdminRequests.tsx';
import { AdminReview } from './pages/AdminReview.tsx';
import { DivisionDashboard } from './pages/DivisionDashboard.tsx';
import { EntryScreen, type EntryState } from './pages/EntryScreen.tsx';
import { MyRequests, type RequestFilters } from './pages/MyRequests.tsx';
import { RequestDetail } from './pages/RequestDetail.tsx';

// Navigation is in-memory state only; nothing in the URL grants access, and
// every load and write re-checks the user in the data layer.
type View =
  | { name: 'dashboard' }
  | { name: 'requests'; filters?: RequestFilters }
  | { name: 'reviews' }
  | { name: 'admin' }
  | { name: 'request'; key: string; from: 'dashboard' | 'requests' }
  | { name: 'review'; key: string };

const BACK_LABELS = { dashboard: 'Dashboard', requests: 'My Requests' } as const;

/** The Review screen starts with every request shown. */
const initialReviewState: ReviewState = { ids: [], datasets: [], divisions: [], statuses: [], clarification: false, page: 1, pageSize: 10 };

const navOf = (v: View): NavKey => (v.name === 'request' ? v.from : v.name === 'review' ? 'reviews' : v.name);

export default function App() {
  const [entry, setEntry] = useState<EntryState>({ kind: 'loading' });
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>({ name: 'dashboard' });
  /** Bumped whenever My Requests is opened, so it starts from the filters it was opened with. */
  const [requestsVisit, setRequestsVisit] = useState(0);
  const [workspace, setWorkspace] = useState<DivisionWorkspace | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  /** Unsaved values on the open request; navigation asks before discarding them. */
  const [dirty, setDirty] = useState(false);
  const [pendingView, setPendingView] = useState<View | null>(null);
  /** DG Admin overview, loaded once and shared by every dashboard section; reloaded on Refresh or after a change. */
  const [admin, setAdmin] = useState<AdminOverview | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  /** Set when nothing is loaded yet or a review changed data, so the next visit to the dashboard reloads. */
  const [adminStale, setAdminStale] = useState(true);
  const [review, setReview] = useState<ReviewState>(initialReviewState);

  const checkAccess = useCallback(async () => {
    try {
      setEntry({ kind: 'resolved', access: await resolveAccess() });
    } catch (e) {
      if (import.meta.env.DEV) console.error(e);
      setEntry({ kind: 'error', message: 'The data service could not be reached. Check your connection and try again.' });
    }
  }, []);
  useEffect(() => {
    let live = true;
    resolveAccess().then(
      (access) => live && setEntry({ kind: 'resolved', access }),
      (e) => {
        if (import.meta.env.DEV) console.error(e);
        if (live) setEntry({ kind: 'error', message: 'The data service could not be reached. Check your connection and try again.' });
      },
    );
    return () => { live = false; };
  }, []);

  /** Reload the catalogue and request list. Existing data stays on screen until the new data arrives. */
  const loadWorkspace = useCallback(async (s: Session) => {
    setListError(null);
    try {
      setWorkspace(await loadDivisionWorkspace(s));
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Your datasets could not be loaded.');
    }
  }, []);

  /** Reload the DG Admin overview. Existing data stays on screen until the new data arrives. */
  const loadAdmin = useCallback(async () => {
    setAdminStale(false);
    setAdminError(null);
    setAdminLoading(true);
    try {
      setAdmin(await loadAdminOverview());
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'The dashboard could not be loaded.');
    } finally {
      setAdminLoading(false);
    }
  }, []);

  const enter = () => {
    if (entry.kind !== 'resolved' || entry.access.kind !== 'ok') return;
    const s = entry.access.session;
    setSession(s);
    const landing: View = { name: landingFor(s).key };
    setView(landing);
    if (s.division) void loadWorkspace(s);
    else if (s.isAdmin) void loadAdmin();
  };

  /**
   * Leave the app and return to its sign-in screen. All loaded data is dropped
   * and access is checked again from the user details table. The host sign-in
   * (the verified identity) is not touched, so the same person is looked up again.
   */
  const signOut = () => {
    setConfirmSignOut(false);
    setSession(null);
    setWorkspace(null);
    setListError(null);
    setAdmin(null);
    setAdminError(null);
    setAdminStale(true);
    setReview(initialReviewState);
    setDirty(false);
    setView({ name: 'dashboard' });
    setEntry({ kind: 'loading' });
    void checkAccess();
  };

  if (!session) {
    const retry = () => { setEntry({ kind: 'loading' }); void checkAccess(); };
    return <EntryScreen state={entry} onContinue={enter} onRetry={retry} />;
  }

  /** Show a view; the dashboard reloads only if it has nothing yet or a review changed something. */
  const show = (next: View) => {
    setView(next);
    if (next.name === 'requests') setRequestsVisit((n) => n + 1);
    if ((next.name === 'dashboard' || next.name === 'reviews') && session.isAdmin && adminStale && !adminLoading) void loadAdmin();
  };
  const go = (next: View) => (dirty ? setPendingView(next) : show(next));
  const refreshList = () => { setWorkspace(null); void loadWorkspace(session); };
  const from = view.name === 'dashboard' ? 'dashboard' : 'requests';
  const openRequest = (key: string) => go({ name: 'request', key, from });
  const division = session.division;

  let content;
  if ((view.name === 'dashboard' || view.name === 'requests') && division) {
    content = listError ? (
      <Alert tone="error" title="Your requests couldn't be loaded">
        {listError}
        <div className="alert-actions"><button className="btn btn-outline" onClick={refreshList}><Icon name="refresh" />Try again</button></div>
      </Alert>
    ) : !workspace ? (
      <Spinner label="Loading your division’s requests…" />
    ) : view.name === 'dashboard' ? (
      <DivisionDashboard
        division={division}
        requests={workspace.requests}
        onRefresh={refreshList}
        onShowRequests={(filters) => go({ name: 'requests', filters })}
        onOpen={openRequest}
      />
    ) : (
      <MyRequests
        key={requestsVisit}
        division={division}
        requests={workspace.requests}
        catalogue={workspace.catalogue}
        initialFilters={view.filters}
        onOpen={openRequest}
        onRefresh={refreshList}
        onCreated={() => void loadWorkspace(session)}
      />
    );
  } else if (view.name === 'request' && division) {
    content = (
      <RequestDetail
        session={session}
        key={view.key}
        requestKey={view.key}
        backLabel={BACK_LABELS[view.from]}
        onBack={() => { setDirty(false); show({ name: view.from }); }}
        onChanged={() => void loadWorkspace(session)}
        onDirtyChange={setDirty}
      />
    );
  } else if (view.name === 'dashboard' && session.isAdmin) {
    content = (
      <AdminDashboard
        data={admin}
        error={adminError}
        loading={adminLoading}
        onRefresh={() => void loadAdmin()}
        onShowRequests={(filters: ReviewFilters) => {
          setReview({ ...initialReviewState, pageSize: review.pageSize, statuses: filters.statuses ?? [], clarification: !!filters.clarification, raisedBy: filters.raisedBy });
          go({ name: 'reviews' });
        }}
      />
    );
  } else if (view.name === 'reviews' && session.isAdmin) {
    content = (
      <AdminRequests
        data={admin}
        error={adminError}
        loading={adminLoading}
        ui={review}
        onUi={setReview}
        onRefresh={() => void loadAdmin()}
        onOpen={(key) => go({ name: 'review', key })}
      />
    );
  } else if (view.name === 'admin' && canManage(session)) {
    content = <AdminCentre session={session} />;
  } else if (view.name === 'review' && session.isAdmin) {
    content = (
      <AdminReview
        session={session}
        requestKey={view.key}
        backLabel="Review"
        onBack={() => go({ name: 'reviews' })}
        onChanged={() => setAdminStale(true)}
      />
    );
  } else {
    content = <Alert tone="error" title="Access denied">You don't have access to this page.</Alert>;
  }

  return (
    <AppShell session={session} active={navOf(view)} onNavigate={(key) => go({ name: key })} onSignOut={() => setConfirmSignOut(true)}>
      {content}
      {/* Business Division Assistant: business division users only; its services re-check the role on every call. */}
      {division && !session.isAdmin && !session.isSystemAdmin && <BusinessAdminAssistant />}
      {pendingView && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          confirmLabel="Discard changes"
          tone="danger"
          onCancel={() => setPendingView(null)}
          onConfirm={() => { setDirty(false); show(pendingView); setPendingView(null); }}
        >
          <p>You have changes that haven't been saved. Save them as a draft first if you want to keep them.</p>
        </ConfirmDialog>
      )}
      {confirmSignOut && (
        <ConfirmDialog title="Sign out?" confirmLabel="Sign out" onCancel={() => setConfirmSignOut(false)} onConfirm={signOut}>
          <p>You'll return to the sign-in screen.</p>
          <p className="muted">Any changes you haven't saved as a draft will be lost.</p>
        </ConfirmDialog>
      )}
    </AppShell>
  );
}
