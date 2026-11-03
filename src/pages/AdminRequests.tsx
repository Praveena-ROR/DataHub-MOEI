import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { pageSlice } from '../components/format.ts';
import { Alert, MultiSelectFilter, PageHeader, Pagination, SectionTitle, Spinner, StatusBadge, Th } from '../components/ui.tsx';
import type { AdminOverview } from '../data/services.ts';
import { datasetId, isOpen, normalize } from '../data/workflow.ts';
import { OVERALL_STATUSES, type RequestState } from '../data/types.ts';

/** Filters the Dashboard can open the Review screen with. */
export interface ReviewFilters {
  statuses?: string[];
  /** Only requests with a clarification that is not resolved. */
  clarification?: boolean;
  /** Only requests raised by this division (myapp_requestingdivision). */
  raisedBy?: string;
}

/** Everything chosen on the Review screen; held by the app so it survives opening a request. */
export interface ReviewState {
  ids: string[];
  datasets: string[];
  divisions: string[];
  statuses: string[];
  clarification: boolean;
  raisedBy?: string;
  page: number;
  pageSize: number;
}

const sortedOptions = (pairs: [string, string][]) => [...new Map(pairs).entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));

/**
 * DG Admin Review screen: every request with its participating divisions'
 * submission status and the overall status. Every column has a multi-select
 * filter. Review / View opens the request; decided requests offer the PDF report.
 */
export function AdminRequests({ data, error, loading, ui, onUi, onRefresh, onOpen }: {
  data: AdminOverview | null;
  error: string | null;
  loading: boolean;
  ui: ReviewState;
  onUi: (next: ReviewState) => void;
  onRefresh: () => void;
  onOpen: (requestKey: string) => void;
}) {
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<{ tone: 'success' | 'error'; text: string; url?: string } | null>(null);
  /** Any filter change returns to the first page. */
  const filter = (changes: Partial<ReviewState>) => onUi({ ...ui, ...changes, page: 1 });

  // One row per Request ID, however many attribute-value rows it has.
  const requests = useMemo(() => [...new Map((data?.requests ?? []).map((r) => [r.key, r])).values()], [data]);
  const options = useMemo(() => {
    const divisions = new Map<string, string>();
    for (const r of requests) for (const p of r.portions) divisions.set(p.division.id, p.division.name);
    return {
      ids: sortedOptions(requests.map((r) => [r.key, r.key])),
      datasets: sortedOptions(requests.map((r) => [r.dataset.key, `${datasetId(r.dataset)} · ${r.dataset.name}`])),
      divisions: [...divisions.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      statuses: OVERALL_STATUSES.map((s) => [s, s] as [string, string]),
    };
  }, [requests]);

  const rows = useMemo(() => requests
    .filter((r) => ui.ids.length === 0 || ui.ids.includes(r.key))
    .filter((r) => ui.datasets.length === 0 || ui.datasets.includes(r.dataset.key))
    .filter((r) => ui.divisions.length === 0 || r.portions.some((p) => ui.divisions.includes(p.division.id)))
    .filter((r) => ui.statuses.length === 0 || ui.statuses.includes(r.overall))
    .filter((r) => !ui.clarification || r.clarifications.some(isOpen))
    .filter((r) => !ui.raisedBy || normalize(r.info.requestingDivision) === normalize(ui.raisedBy)), [requests, ui]);

  const page = Math.min(ui.page, Math.max(1, Math.ceil(rows.length / ui.pageSize)));
  const filtered = ui.ids.length + ui.datasets.length + ui.divisions.length + ui.statuses.length > 0 || ui.clarification || !!ui.raisedBy;
  const clearFilters = () => filter({ ids: [], datasets: [], divisions: [], statuses: [], clarification: false, raisedBy: undefined });

  const report = async (r: RequestState) => {
    setReportBusy(r.key);
    setReportMessage(null);
    try {
      const { downloadRequestReport } = await import('../report/download.ts'); // loaded on demand (jsPDF is large)
      const file = await downloadRequestReport(r.key);
      setReportMessage({ tone: 'success', text: `Report for ${r.key} downloaded as ${file.fileName}.`, url: file.url });
    } catch (e) {
      setReportMessage({ tone: 'error', text: `The report for ${r.key} could not be generated. ${e instanceof Error ? e.message : ''} The decision is unaffected; try again.` });
    } finally {
      setReportBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Review"
        subtitle={data ? `${requests.length} request(s) · ${requests.filter((r) => r.overall === 'Pending DG Admin Review').length} pending DG Admin review${filtered ? ` · ${rows.length} shown` : ''}` : 'Loading…'}
        actions={<button className="btn btn-outline" onClick={onRefresh} disabled={loading}><Icon name="refresh" />{loading && data ? 'Refreshing…' : 'Refresh'}</button>}
      />
      {error && (
        <Alert tone="error" title="Requests couldn't be loaded">
          {error}
          <div className="alert-actions"><button className="btn btn-outline" onClick={onRefresh} disabled={loading}><Icon name="refresh" />Try again</button></div>
        </Alert>
      )}
      {!data && loading && <Spinner label="Loading requests…" />}
      {reportMessage && (
        <Alert tone={reportMessage.tone}>
          {reportMessage.text}
          {reportMessage.url && <> <a className="btn btn-link" href={reportMessage.url} target="_blank" rel="noopener noreferrer">Open the PDF</a></>}
        </Alert>
      )}

      {data && (
        <section className="panel" aria-label="Requests">
          <SectionTitle icon="shield" right={filtered && <button className="btn btn-link" onClick={clearFilters}><Icon name="x" />Clear filters</button>}>
            Requests
          </SectionTitle>
          {(ui.clarification || ui.raisedBy) && (
            <div className="filter-chips">
              {ui.clarification && (
                <span className="filter-chip">Open clarifications<button type="button" onClick={() => filter({ clarification: false })} aria-label="Remove the clarification filter"><Icon name="x" size={12} /></button></span>
              )}
              {ui.raisedBy && (
                <span className="filter-chip">Raised by {ui.raisedBy}<button type="button" onClick={() => filter({ raisedBy: undefined })} aria-label="Remove the raised-by filter"><Icon name="x" size={12} /></button></span>
              )}
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <Th icon="hash">Request ID</Th>
                  <Th icon="datasets">Dataset</Th>
                  <Th icon="users">Divisions</Th>
                  <Th icon="status">Status</Th>
                  <Th icon="actions" className="right">Actions</Th>
                </tr>
                <tr className="filter-row">
                  <th><MultiSelectFilter label="Filter by Request ID" options={options.ids} selected={ui.ids} onChange={(v) => filter({ ids: v })} /></th>
                  <th><MultiSelectFilter label="Filter by dataset" options={options.datasets} selected={ui.datasets} onChange={(v) => filter({ datasets: v })} /></th>
                  <th><MultiSelectFilter label="Filter by participating division" options={options.divisions} selected={ui.divisions} onChange={(v) => filter({ divisions: v })} /></th>
                  <th><MultiSelectFilter label="Filter by status" options={options.statuses} selected={ui.statuses} onChange={(v) => filter({ statuses: v })} /></th>
                  <th className="right">{filtered && <button className="btn btn-link" onClick={clearFilters}><Icon name="x" />Clear</button>}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty">
                        <Icon name="search" size={28} />
                        <p>{requests.length === 0 ? 'No requests have been created yet.' : 'No requests match these filters.'}</p>
                        {filtered && requests.length > 0 && <button className="btn btn-outline btn-sm" onClick={clearFilters}><Icon name="x" />Clear filters</button>}
                      </div>
                    </td>
                  </tr>
                )}
                {pageSlice(rows, ui.pageSize, page).map((r) => {
                  const reviewable = r.overall === 'Pending DG Admin Review';
                  return (
                    <tr key={r.key}>
                      <td><div className="request-id">{r.key}</div></td>
                      <td className="wrap">
                        <div>{r.dataset.name}</div>
                        <div className="sub">{datasetId(r.dataset)}</div>
                      </td>
                      <td>
                        <div className="chips">{r.portions.map((p) => <span key={p.division.id} className={`chip${p.complete ? ' chip-green' : ''}`}>{p.division.name}: {p.status}</span>)}</div>
                      </td>
                      <td>
                        <StatusBadge status={r.overall} />
                        {r.issues.length > 0 && <span className="flag" title="This request has data issues"><Icon name="alert" size={14} label="Data issues" /></span>}
                      </td>
                      <td className="right">
                        <button className="btn btn-link" onClick={() => onOpen(r.key)}>
                          <Icon name={reviewable ? 'shield' : 'eye'} />{reviewable ? 'Review' : 'View'}
                        </button>
                        {r.review && (
                          <button className="btn btn-link" disabled={reportBusy === r.key} onClick={() => void report(r)}>
                            <Icon name="save" />{reportBusy === r.key ? 'Preparing…' : 'PDF'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <Pagination page={page} pageSize={ui.pageSize} total={rows.length} noun="request(s)"
              onPage={(p) => onUi({ ...ui, page: p })} onPageSize={(n) => onUi({ ...ui, pageSize: n, page: 1 })} />
          )}
        </section>
      )}
    </>
  );
}
