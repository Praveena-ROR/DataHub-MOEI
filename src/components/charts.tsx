import { useMemo, useState } from 'react';
import { MONTH_NAMES, monthlyCounts, STATUS_LABELS, yearsOf } from './format.ts';
import { MultiSelectFilter } from './ui.tsx';
import { OVERALL_STATUSES, type OverallStatus } from '../data/types.ts';

// Plain HTML/SVG charts shared by the dashboards. Every mark has a text label or
// hover text, so colour is never the only way to read a value.

/** A time period on the trend chart: [start, end) in local time. */
export interface Period { start: string; end: string; label: string }

/** Categorical series colours (validated default palette), in fixed order. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MAX_YEARS = SERIES.length;

/**
 * Line chart of requests created per month, one line per selected year
 * (years present in the data only; multi-select). Each year keeps its colour
 * whatever else is selected. Hover a month to see every year's count; click a
 * point to open that month's requests.
 */
export function RequestTrendChart({ dates, onSelect }: { dates: (string | undefined)[]; onSelect?: (period: Period) => void }) {
  const years = useMemo(() => yearsOf(dates), [dates]);
  const [picked, setPicked] = useState<string[]>(() => (years[0] != null ? [String(years[0])] : []));
  const [hover, setHover] = useState<number | null>(null);
  // Only years still in the data; none picked = the most recent years (up to the colour limit).
  const chosen = useMemo(() => {
    const valid = picked.map(Number).filter((y) => years.includes(y));
    return (valid.length ? valid : years.slice(0, MAX_YEARS)).sort((a, b) => a - b);
  }, [picked, years]);
  const counts = useMemo(() => monthlyCounts(dates, chosen), [dates, chosen]);
  /** Colour follows the year (its place among all years), never its rank in the selection. */
  const colourOf = (y: number) => SERIES[(years.length - 1 - years.indexOf(y)) % SERIES.length];

  const W = 560, H = 230, L = 34, R = 44, T = 14, B = 30;
  const max = Math.max(1, ...chosen.flatMap((y) => counts.get(y)!));
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * Math.ceil(max / step);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const x = (m: number) => L + (m * (W - L - R)) / 11;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const options = years.map((yr) => [String(yr), String(yr)] as [string, string]);
  const select = (yr: number, m: number) => onSelect?.({
    start: new Date(yr, m, 1).toISOString(),
    end: new Date(yr, m + 1, 1).toISOString(),
    label: `${MONTH_NAMES[m]} ${yr}`,
  });

  return (
    <figure className="panel bar-chart">
      <div className="chart-head">
        <figcaption className="bar-chart-title">Requests created by month</figcaption>
        {years.length > 0 && (
          <span className="chart-filter">
            <span className="muted small">Year</span>
            <MultiSelectFilter label="Years to show" options={options} selected={picked.filter((p) => years.includes(Number(p)))}
              onChange={(v) => setPicked(v.slice(-MAX_YEARS))} />
          </span>
        )}
      </div>
      {years.length === 0 ? <p className="muted small">No requests yet.</p> : (
        <>
          {chosen.length > 1 && (
            <ul className="legend" aria-label="Legend">
              {chosen.map((yr) => <li key={yr}><span className="legend-swatch" style={{ background: colourOf(yr) }} aria-hidden="true" />{yr}</li>)}
            </ul>
          )}
          <div className="line-chart">
            <svg viewBox={`0 0 ${W} ${H}`} role="img"
              aria-label={`Requests created per month: ${chosen.map((yr) => `${yr}: ${counts.get(yr)!.map((v, m) => `${MONTH_NAMES[m]} ${v}`).join(', ')}`).join('; ')}`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="lc-grid" />
                  <text x={L - 8} y={y(t) + 4} className="lc-axis" textAnchor="end">{t}</text>
                </g>
              ))}
              {MONTH_NAMES.map((name, m) => <text key={name} x={x(m)} y={H - 8} className="lc-axis" textAnchor="middle">{name}</text>)}
              {/* Hover/click area per month (under the points, so each year's point stays clickable). */}
              {MONTH_NAMES.map((name, m) => (
                <rect key={name} x={x(m) - (W - L - R) / 22} y={T} width={(W - L - R) / 11} height={H - T - B} className="lc-hit"
                  onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)}
                  onClick={() => { if (chosen.length === 1) select(chosen[0], m); }} />
              ))}
              {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="lc-cross" />}
              {chosen.map((yr) => {
                const values = counts.get(yr)!;
                return (
                  <g key={yr}>
                    <polyline points={values.map((v, m) => `${x(m)},${y(v)}`).join(' ')} className="lc-line" style={{ stroke: colourOf(yr) }} />
                    {chosen.length > 1 && <text x={x(11) + 8} y={y(values[11]) + 4} className="lc-axis lc-end">{yr}</text>}
                    {values.map((v, m) => (
                      <circle key={m} cx={x(m)} cy={y(v)} r={hover === m ? 5 : 3.5} className="lc-dot lc-click" style={{ fill: colourOf(yr) }}
                        onMouseEnter={() => setHover(m)} onClick={() => select(yr, m)}>
                        <title>{`${MONTH_NAMES[m]} ${yr}: ${v} request${v === 1 ? '' : 's'}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}
            </svg>
            {hover != null && (
              <div className="lc-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(T / H) * 100}%` }}>
                <strong>{MONTH_NAMES[hover]}</strong>
                {chosen.map((yr) => <div key={yr}>{yr}: <strong>{counts.get(yr)![hover]}</strong> request{counts.get(yr)![hover] === 1 ? '' : 's'}</div>)}
              </div>
            )}
          </div>
          {picked.length === 0 && years.length > MAX_YEARS && <p className="muted small">Showing the {MAX_YEARS} most recent years.</p>}
        </>
      )}
    </figure>
  );
}

/** Bar colour per status (single-series bar chart; each bar is labelled). */
const BAR_TONE: Record<OverallStatus, string> = { 'In Progress': 'yellow', 'Pending DG Admin Review': 'yellow', Approved: 'green', Rejected: 'red' };

/** Horizontal bar chart of request counts by status; each bar is labelled and clickable. */
export function StatusBarChart({ counts, onSelect }: { counts: Record<OverallStatus, number>; onSelect?: (s: OverallStatus) => void }) {
  const max = Math.max(1, ...OVERALL_STATUSES.map((s) => counts[s]));
  const total = OVERALL_STATUSES.reduce((n, s) => n + counts[s], 0);
  return (
    <figure className="panel bar-chart">
      <figcaption className="bar-chart-title">Requests by status</figcaption>
      {total === 0 ? <p className="muted small">No requests yet.</p> : (
        <ul className="bars">
          {OVERALL_STATUSES.map((s) => (
            <li key={s}>
              <button className="bar-row" onClick={() => onSelect?.(s)} title={`${STATUS_LABELS[s]}: ${counts[s]} request${counts[s] === 1 ? '' : 's'}`}>
                <span className="bar-label">{STATUS_LABELS[s]}</span>
                <span className="bar-track"><span className={`bar-fill bar-${BAR_TONE[s]}`} style={{ width: `${(counts[s] / max) * 100}%` }} /></span>
                <span className="bar-value">{counts[s]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** Stack order and colours (validated for colour-blind separation of neighbours). */
const STACK: OverallStatus[] = ['Approved', 'In Progress', 'Pending DG Admin Review', 'Rejected'];
const STACK_CLASS: Record<OverallStatus, string> = { Approved: 'sb-approved', 'In Progress': 'sb-progress', 'Pending DG Admin Review': 'sb-pending', Rejected: 'sb-rejected' };

/**
 * Stacked horizontal bars: one bar per group (e.g. requesting division), split
 * by status, with a legend, the total beside each bar, hover text per segment
 * and a table view. Clicking a segment reports the group and status.
 */
export function StackedStatusChart({ title, rows, onSelect }: {
  title: string;
  rows: { key: string; label: string; counts: Record<OverallStatus, number> }[];
  onSelect?: (key: string, status: OverallStatus) => void;
}) {
  const [asTable, setAsTable] = useState(false);
  const totals = rows.map((r) => STACK.reduce((n, s) => n + r.counts[s], 0));
  const max = Math.max(1, ...totals);
  return (
    <figure className="panel bar-chart">
      <div className="chart-head">
        <figcaption className="bar-chart-title">{title}</figcaption>
        {rows.length > 0 && <button type="button" className="btn btn-link" onClick={() => setAsTable((t) => !t)}>{asTable ? 'Show chart' : 'Show as table'}</button>}
      </div>
      {rows.length === 0 ? <p className="muted small">No requests yet.</p> : asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Division</th>{STACK.map((s) => <th key={s} scope="col" className="right">{STATUS_LABELS[s]}</th>)}<th scope="col" className="right">Total</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}><td>{r.label}</td>{STACK.map((s) => <td key={s} className="right">{r.counts[s]}</td>)}<td className="right"><strong>{totals[i]}</strong></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <ul className="legend" aria-label="Legend">
            {STACK.map((s) => <li key={s}><span className={`legend-swatch ${STACK_CLASS[s]}`} aria-hidden="true" />{STATUS_LABELS[s]}</li>)}
          </ul>
          <ul className="bars">
            {rows.map((r, i) => (
              <li key={r.key} className="stack-row">
                <span className="bar-label">{r.label}</span>
                <span className="stack-area"><span className="stack-track" style={{ width: `${(totals[i] / max) * 100}%` }}>
                  {STACK.filter((s) => r.counts[s] > 0).map((s) => (
                    <button key={s} type="button" className={`stack-seg ${STACK_CLASS[s]}`} style={{ flexGrow: r.counts[s] }}
                      title={`${r.label} · ${STATUS_LABELS[s]}: ${r.counts[s]}`} aria-label={`${r.label}, ${STATUS_LABELS[s]}: ${r.counts[s]}`}
                      onClick={() => onSelect?.(r.key, s)} />
                  ))}
                </span></span>
                <span className="bar-value">{totals[i]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
