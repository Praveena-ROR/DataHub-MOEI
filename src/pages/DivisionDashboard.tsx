import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { RequestTrendChart, StatusBarChart } from '../components/charts.tsx';
import { formatDateTime, pageSlice, personName, STATUS_LABELS } from '../components/format.ts';
import { FilterText, PageHeader, Pagination, SectionTitle, Th } from '../components/ui.tsx';
import { approvedDatasets, datasetId, normalize } from '../data/workflow.ts';
import { OVERALL_STATUSES, type Division, type OverallStatus, type RequestState } from '../data/types.ts';
import type { RequestFilters } from './MyRequests.tsx';

/** Datasets the division requested and DG Admin approved, each listed once. */
function ApprovedDatasetsPanel({ division, requests, onOpen }: { division: Division; requests: RequestState[]; onOpen: (key: string) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const all = useMemo(() => approvedDatasets(requests), [requests]);
  const rows = useMemo(() => {
    const q = normalize(search);
    return all.filter((d) => !q || normalize(`${datasetId(d.dataset)} ${d.dataset.name} ${d.requests.map((r) => r.key).join(' ')}`).includes(q));
  }, [all, search]);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));

  return (
    <section className="panel" aria-label="My Datasets">
      <SectionTitle icon="datasets">My Datasets</SectionTitle>
      <p className="muted small">Datasets requested by {division.name} and approved by DG Admin. A draft, submission or pending review does not appear here.</p>
      {all.length === 0 ? (
        <div className="empty"><Icon name="datasets" size={28} /><p>No approved datasets yet.</p></div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <Th icon="hash">No.</Th>
                  <Th icon="datasets">Dataset</Th>
                  <Th icon="hash">Approved request</Th>
                  <Th icon="calendar">Approved on</Th>
                  <Th icon="layers">Your attributes</Th>
                  <Th icon="actions" className="right">Actions</Th>
                </tr>
                <tr className="filter-row">
                  <th colSpan={3}><FilterText label="Search datasets or Request ID" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Dataset or Request ID" /></th>
                  <th /><th />
                  <th className="right">{search && <button className="btn btn-link" onClick={() => setSearch('')}><Icon name="x" />Clear</button>}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} className="center muted">No approved datasets match the search.</td></tr>}
                {pageSlice(rows, pageSize, current).map(({ dataset, requests: approved }) => {
                  const latest = approved[0];
                  return (
                    <tr key={dataset.key}>
                      <td className="mono">{datasetId(dataset)}</td>
                      <td className="wrap">{dataset.name}</td>
                      <td>
                        <div className="request-id">{latest.key}</div>
                        {approved.length > 1 && <div className="sub">also {approved.slice(1).map((r) => r.key).join(', ')}</div>}
                      </td>
                      <td className="wrap">
                        <div>{formatDateTime(latest.review?.on)}</div>
                        {latest.review?.by && <div className="sub">by {personName(latest.names, latest.review.by)}</div>}
                      </td>
                      <td>{dataset.attributes.length}</td>
                      <td className="right"><button className="btn btn-link" onClick={() => onOpen(latest.key)}><Icon name="eye" />View</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <Pagination page={current} pageSize={pageSize} total={rows.length} noun="dataset(s)"
              onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Business-division dashboard: KPI cards, requests created by month, requests
 * by status, and My Datasets (approved datasets). All figures come from the
 * loaded Dataverse requests and count unique Request IDs.
 */
export function DivisionDashboard({ division, requests, onRefresh, onShowRequests, onOpen }: {
  division: Division;
  requests: RequestState[];
  onRefresh: () => void;
  onShowRequests: (filters: RequestFilters) => void;
  onOpen: (requestKey: string) => void;
}) {
  // One entry per Request ID, however many value rows it has.
  const unique = useMemo(() => [...new Map(requests.map((r) => [r.key, r])).values()], [requests]);
  const byStatus = useMemo(() => Object.fromEntries(OVERALL_STATUSES.map((s) => [s, unique.filter((r) => r.overall === s).length])) as Record<OverallStatus, number>, [unique]);
  const owned = useMemo(() => approvedDatasets(unique).length, [unique]);

  const cards: { label: string; value: number; onClick?: () => void }[] = [
    { label: 'Total requests', value: unique.length, onClick: () => onShowRequests({}) },
    ...OVERALL_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: byStatus[s], onClick: () => onShowRequests({ statuses: [s] }) })),
    { label: 'Approved datasets', value: owned },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${division.name} · ${unique.length} request(s) · ${owned} approved dataset(s)`}
        actions={<button className="btn btn-outline" onClick={onRefresh}><Icon name="refresh" />Refresh</button>}
      />

      <div className="stats" role="group" aria-label="Request summary">
        {cards.map((c) => c.onClick ? (
          <button key={c.label} className="stat" onClick={c.onClick} title={`Show ${c.label.toLowerCase()} in My Requests`}>
            <span className="stat-value">{c.value}</span><span className="stat-label">{c.label}</span>
          </button>
        ) : (
          <div key={c.label} className="stat stat-static">
            <span className="stat-value">{c.value}</span><span className="stat-label">{c.label}</span>
          </div>
        ))}
      </div>

      <div className="chart-grid">
        <RequestTrendChart dates={unique.map((r) => r.info.createdOn)} onSelect={(period) => onShowRequests({ period })} />
        <StatusBarChart counts={byStatus} onSelect={(s) => onShowRequests({ statuses: [s] })} />
      </div>

      <ApprovedDatasetsPanel division={division} requests={unique} onOpen={onOpen} />
    </>
  );
}
