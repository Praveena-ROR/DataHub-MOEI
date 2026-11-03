import type { OverallStatus } from '../data/types.ts';

// Display helpers shared by pages.
const parse = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export const formatDate = (iso?: string) =>
  parse(iso)?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '—';

export const formatDateTime = (iso?: string) =>
  parse(iso)?.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? '—';

export const initials = (name: string) =>
  name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export function pageSlice<T>(items: T[], pageSize: number, page: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  return items.slice((current - 1) * pageSize, current * pageSize);
}

/** Display name for a sign-in address: myapp_username from tbl_MOEI_UserDetails, else the address. */
export const personName = (names: Record<string, string> | undefined, upn?: string) =>
  upn ? names?.[upn.trim().toLowerCase()] ?? upn : '—';

/** Calendar month of a timestamp as `YYYY-MM` (local time), or '' when missing. */
export const monthKey = (iso?: string) => {
  const d = parse(iso);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
};

/** `YYYY-MM` → e.g. "Oct 2026". */
export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—';
};

// ---------- Months by year for the trend chart ----------

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Requests created per month (Jan–Dec) for each of the given years, from the
 * created timestamps (local time). Years with no requests get twelve zeros.
 */
export function monthlyCounts(dates: (string | undefined)[], years: number[]): Map<number, number[]> {
  const out = new Map(years.map((y) => [y, Array(12).fill(0) as number[]]));
  for (const iso of dates) {
    const d = parse(iso);
    const row = d && out.get(d.getFullYear());
    if (row) row[d.getMonth()] += 1;
  }
  return out;
}

/** Distinct years of the timestamps, newest first. */
export const yearsOf = (dates: (string | undefined)[]) =>
  [...new Set(dates.map((iso) => parse(iso)?.getFullYear()).filter((y): y is number => y != null))].sort((a, b) => b - a);

/** Parse an ISO timestamp, or null. */
export const toDate = (iso?: string) => parse(iso);

/** Short status labels used on charts and cards. */
export const STATUS_LABELS: Record<OverallStatus, string> = {
  'In Progress': 'In progress',
  'Pending DG Admin Review': 'Pending DG Admin review',
  Approved: 'Approved',
  Rejected: 'Rejected',
};
