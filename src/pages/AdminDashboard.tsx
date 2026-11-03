import { useMemo } from 'react';
import { StackedStatusChart, StatusBarChart } from '../components/charts.tsx';
import { Icon } from '../components/Icon.tsx';
import { Alert, PageHeader, Spinner } from '../components/ui.tsx';
import type { AdminOverview } from '../data/services.ts';
import { isOpen, normalize } from '../data/workflow.ts';
import { OVERALL_STATUSES, type OverallStatus } from '../data/types.ts';
import type { ReviewFilters } from './AdminRequests.tsx';

/** Order of the KPI cards; Pending DG Admin Review comes first. */
const CARD_STATUSES: OverallStatus[] = ['Pending DG Admin Review', 'Approved', 'Rejected', 'In Progress'];
const CARD_LABELS: Partial<Record<OverallStatus, string>> = { 'In Progress': 'In progress with divisions' };
const NOT_RECORDED = 'Not recorded';

/**
 * DG Admin dashboard: request KPIs and charts of the requests raised by each
 * division, by status. All figures come from one load of the admin overview and
 * count unique Request IDs. Cards and chart marks open the Review screen filtered.
 */
export function AdminDashboard({ data, error, loading, onRefresh, onShowRequests }: {
  data: AdminOverview | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  onShowRequests: (filters: ReviewFilters) => void;
}) {
  // One entry per Request ID, however many attribute-value rows it has.
  const requests = useMemo(() => [...new Map((data?.requests ?? []).map((r) => [r.key, r])).values()], [data]);
  const counts = useMemo(() => Object.fromEntries(OVERALL_STATUSES.map((s) => [s, requests.filter((r) => r.overall === s).length])) as Record<OverallStatus, number>, [requests]);
  const clarifications = useMemo(() => requests.filter((r) => r.clarifications.some(isOpen)).length, [requests]);

  /** Requests grouped by the division that raised them (myapp_requestingdivision). */
  const byDivision = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; counts: Record<OverallStatus, number> }>();
    for (const r of requests) {
      const label = (r.info.requestingDivision ?? '').replace(/\s+/g, ' ').trim() || NOT_RECORDED;
      const key = normalize(label);
      const g = groups.get(key) ?? { key, label, counts: { 'In Progress': 0, 'Pending DG Admin Review': 0, Approved: 0, Rejected: 0 } };
      g.counts[r.overall] += 1;
      groups.set(key, g);
    }
    const total = (c: Record<OverallStatus, number>) => OVERALL_STATUSES.reduce((n, s) => n + c[s], 0);
    return [...groups.values()].sort((a, b) => total(b.counts) - total(a.counts) || a.label.localeCompare(b.label));
  }, [requests]);
  const raisedBy = (key: string) => byDivision.find((d) => d.key === key)?.label;

  return (
    <>
      <PageHeader
        title="DG Admin Dashboard"
        subtitle={data ? `${requests.length} request(s) · ${byDivision.filter((d) => d.label !== NOT_RECORDED).length} division(s) raised requests · ${data.datasets.length} dataset(s)` : 'Loading…'}
        actions={<button className="btn btn-outline" onClick={onRefresh} disabled={loading}><Icon name="refresh" />{loading && data ? 'Refreshing…' : 'Refresh'}</button>}
      />
      {error && (
        <Alert tone="error" title="The dashboard couldn't be loaded">
          {error}
          <div className="alert-actions"><button className="btn btn-outline" onClick={onRefresh} disabled={loading}><Icon name="refresh" />Try again</button></div>
        </Alert>
      )}
      {!data && loading && <Spinner label="Loading dashboard…" />}

      {data && (
        <>
          <div className="stats" role="group" aria-label="Request summary">
            {CARD_STATUSES.map((s) => (
              <button key={s} className="stat" onClick={() => onShowRequests({ statuses: [s] })} title="Show these requests on the Review screen">
                <span className="stat-value">{counts[s]}</span><span className="stat-label">{CARD_LABELS[s] ?? s}</span>
              </button>
            ))}
            <button className="stat" onClick={() => onShowRequests({ clarification: true })} title="Show these requests on the Review screen">
              <span className="stat-value">{clarifications}</span><span className="stat-label">Pending clarification</span>
            </button>
          </div>

          <div className="chart-grid">
            <StackedStatusChart
              title="Requests raised by division, by status"
              rows={byDivision}
              onSelect={(key, s) => onShowRequests({ statuses: [s], raisedBy: raisedBy(key) })}
            />
            <StatusBarChart counts={counts} onSelect={(s) => onShowRequests({ statuses: [s] })} />
          </div>
          <p className="muted small">Select a card, bar or segment to open those requests on the Review screen.</p>
        </>
      )}
    </>
  );
}
