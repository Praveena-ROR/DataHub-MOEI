import { useMemo, useState } from 'react';
import type { Period } from '../components/charts.tsx';
import { CreateRequestDialog } from '../components/CreateRequestDialog.tsx';
import { Icon } from '../components/Icon.tsx';
import { formatDateTime, monthKey, monthLabel, pageSlice, toDate } from '../components/format.ts';
import { MultiSelectFilter, PageHeader, Pagination, SectionTitle, StatusBadge, Th } from '../components/ui.tsx';
import type { CatalogueItem } from '../data/services.ts';
import { canDivisionEdit, datasetId, normalize } from '../data/workflow.ts';
import { OVERALL_STATUSES, type Division, type RequestState } from '../data/types.ts';

const actionFor = (state: RequestState, division: Division) => {
  const portion = state.portions.find((p) => p.division.id === division.id);
  if (canDivisionEdit(state, division.id)) {
    return portion?.status === 'Draft' ? { label: 'Continue', icon: 'edit' as const } : { label: 'Open', icon: 'arrow' as const };
  }
  return { label: 'View', icon: 'eye' as const };
};

/** Filters another screen can open My Requests with (e.g. a Dashboard card or chart). */
export interface RequestFilters { statuses?: string[]; months?: string[]; period?: Period }

const sortedOptions = (pairs: [string, string][]) => [...new Map(pairs).entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));

/**
 * My Requests: one row per request the division takes part in, multi-select
 * filters in the table header, and Create New Request (a modal).
 */
export function MyRequests({ division, requests, catalogue, initialFilters, onOpen, onRefresh, onCreated }: {
  division: Division;
  requests: RequestState[];
  /** Datasets mapped to the division, for the Create New Request modal. */
  catalogue: CatalogueItem[];
  initialFilters?: RequestFilters;
  onOpen: (requestKey: string) => void;
  onRefresh: () => void;
  /** Requests were created: reload the list (the modal stays open to show the new IDs). */
  onCreated: () => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [datasets, setDatasets] = useState<string[]>([]);
  const [months, setMonths] = useState<string[]>(initialFilters?.months ?? []);
  const [statuses, setStatuses] = useState<string[]>(initialFilters?.statuses ?? []);
  /** Set from a Dashboard chart point: requests created in that day/week/month/year. */
  const [period, setPeriod] = useState<Period | undefined>(initialFilters?.period);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [creating, setCreating] = useState(false);

  const options = useMemo(() => ({
    ids: sortedOptions(requests.map((r) => [r.key, r.key])),
    datasets: sortedOptions(requests.map((r) => [r.dataset.key, `${datasetId(r.dataset)} · ${r.dataset.name}`])),
    months: [...new Set(requests.map((r) => monthKey(r.info.createdOn)).filter(Boolean))].sort().reverse().map((m) => [m, monthLabel(m)] as [string, string]),
    statuses: OVERALL_STATUSES.map((s) => [s, s] as [string, string]),
  }), [requests]);

  const rows = useMemo(() => requests
    .filter((r) => ids.length === 0 || ids.includes(r.key))
    .filter((r) => datasets.length === 0 || datasets.includes(r.dataset.key))
    .filter((r) => months.length === 0 || months.includes(monthKey(r.info.createdOn)))
    .filter((r) => statuses.length === 0 || statuses.includes(r.overall))
    .filter((r) => {
      if (!period) return true;
      const t = toDate(r.info.createdOn)?.getTime();
      return t != null && t >= Date.parse(period.start) && t < Date.parse(period.end);
    }), [requests, ids, datasets, months, statuses, period]);

  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const filtered = ids.length + datasets.length + months.length + statuses.length > 0 || !!period;
  const reset = (fn: (v: string[]) => void) => (v: string[]) => { fn(v); setPage(1); };
  const clearFilters = () => { setIds([]); setDatasets([]); setMonths([]); setStatuses([]); setPeriod(undefined); setPage(1); };

  return (
    <>
      <PageHeader
        title="My Requests"
        subtitle={`${requests.length} request(s) · ${division.name}${filtered ? ` · ${rows.length} shown` : ''}`}
        actions={
          <>
            <button className="btn btn-outline" onClick={onRefresh}><Icon name="refresh" />Refresh</button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="send" />Create New Request</button>
          </>
        }
      />
      <div className="panel">
        <SectionTitle icon="list" right={filtered && <button className="btn btn-link" onClick={clearFilters}><Icon name="x" />Clear filters</button>}>
          Requests your division takes part in
        </SectionTitle>
        {period && (
          <div className="filter-chips">
            <span className="filter-chip">Created: {period.label}<button type="button" onClick={() => setPeriod(undefined)} aria-label="Remove the created-in filter"><Icon name="x" size={12} /></button></span>
          </div>
        )}
        {requests.length === 0 ? (
          <div className="empty">
            <Icon name="drafts" size={28} />
            <p>No requests yet.</p>
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Icon name="send" />Create New Request</button>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <Th icon="hash">Request ID</Th>
                    <Th icon="datasets">Dataset</Th>
                    <Th icon="calendar">Created on</Th>
                    <Th icon="status">Status</Th>
                    <Th icon="actions" className="right">Actions</Th>
                  </tr>
                  <tr className="filter-row">
                    <th><MultiSelectFilter label="Filter by Request ID" options={options.ids} selected={ids} onChange={reset(setIds)} /></th>
                    <th><MultiSelectFilter label="Filter by dataset" options={options.datasets} selected={datasets} onChange={reset(setDatasets)} /></th>
                    <th><MultiSelectFilter label="Filter by month created" options={options.months} selected={months} onChange={reset(setMonths)} /></th>
                    <th><MultiSelectFilter label="Filter by status" options={options.statuses} selected={statuses} onChange={reset(setStatuses)} /></th>
                    <th className="right">{filtered && <button className="btn btn-link" onClick={clearFilters}><Icon name="x" />Clear</button>}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="center muted">No requests match these filters. <button className="btn btn-link" onClick={clearFilters}>Clear filters</button></td></tr>
                  )}
                  {pageSlice(rows, pageSize, current).map((r) => {
                    const action = actionFor(r, division);
                    return (
                      <tr key={r.key}>
                        <td><button className="btn btn-link request-id" onClick={() => onOpen(r.key)}>{r.key}</button></td>
                        <td className="wrap">
                          <div>{r.dataset.name}</div>
                          <div className="sub">
                            Dataset {datasetId(r.dataset)}
                            {normalize(r.info.requestingDivision) !== division.id && r.info.requestingDivision && ` · raised by ${r.info.requestingDivision} (shared attribute${r.dataset.attributes.length === 1 ? '' : 's'})`}
                          </div>
                        </td>
                        <td>{formatDateTime(r.info.createdOn)}</td>
                        <td><StatusBadge status={r.overall} tone="neutral" /></td>
                        <td className="right">
                          <button className="btn btn-link" onClick={() => onOpen(r.key)}><Icon name={action.icon} />{action.label}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 0 && (
              <Pagination page={current} pageSize={pageSize} total={rows.length} noun="request(s)"
                onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
            )}
          </>
        )}
      </div>

      {creating && (
        <CreateRequestDialog
          division={division}
          items={catalogue}
          onClose={() => setCreating(false)}
          onCreated={onCreated}
          onOpen={(key) => { setCreating(false); onOpen(key); }}
        />
      )}
    </>
  );
}
