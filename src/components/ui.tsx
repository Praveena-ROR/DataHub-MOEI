import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import type { ClarificationStatus, DivisionStatus, OverallStatus } from '../data/types.ts';

const TONE: Record<DivisionStatus | OverallStatus | ClarificationStatus, string> = {
  'Pending Response': 'amber',
  Responded: 'teal',
  Resolved: 'green',
  Pending: 'neutral',
  Draft: 'amber',
  Submitted: 'green',
  'In Progress': 'teal',
  'Pending DG Admin Review': 'amber',
  Approved: 'green',
  Rejected: 'red',
};

/** `tone` overrides the default colour for the status (e.g. yellow / orange / red / green on My Requests). */
export function StatusBadge({ status, tone }: { status: DivisionStatus | OverallStatus | ClarificationStatus; tone?: string }) {
  return <span className={`badge badge-${tone ?? TONE[status]}`}>{status}</span>;
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'error' | 'success' | 'warning'; title?: string; children?: ReactNode }) {
  const icon: IconName = tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <div>
        {title && <div className="alert-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner-row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ icon, children, right }: { icon: IconName; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>
        <Icon name={icon} size={17} />
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Th({ icon, children, className }: { icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={className}>
      <span className="th">
        {icon && <Icon name={icon} size={14} />}
        {children}
      </span>
    </th>
  );
}

/** Text filter placed in a table's filter row (directly under its column header). */
export function FilterText({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <span className="input-icon">
      <Icon name="search" size={13} />
      <input className="input input-filter" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Search'} aria-label={label} />
    </span>
  );
}

/** Choice filter placed in a table's filter row. */
export function FilterSelect({ label, value, onChange, options, allLabel = 'All' }: {
  label: string; value: string; onChange: (v: string) => void; options: (string | [string, string])[]; allLabel?: string;
}) {
  return (
    <select className="select input-filter" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{allLabel}</option>
      {options.map((o) => {
        const [v, text] = Array.isArray(o) ? o : [o, o];
        return <option key={v} value={v}>{text}</option>;
      })}
    </select>
  );
}

/**
 * Multi-select filter for a table's filter row: a button showing the choice
 * ("All", one value, or "n selected") that opens a checklist with an optional search.
 * The list is positioned on screen (fixed), so it is never clipped by a scrolling table.
 */
export function MultiSelectFilter({ label, options, selected, onChange }: {
  label: string; options: [string, string][]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (panel.current?.contains(e.target as Node) || button.current?.contains(e.target as Node))) return;
      if (e.type === 'scroll' && panel.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  const toggleOpen = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 260), width: Math.max(r.width, 240) });
    setQuery('');
    setOpen((o) => !o);
  };
  const chosen = new Set(selected);
  const q = query.trim().toLowerCase();
  const shown = options.filter(([, text]) => !q || text.toLowerCase().includes(q));
  const toggle = (v: string) => onChange(chosen.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? options.find(([v]) => v === selected[0])?.[1] ?? selected[0] : `${selected.length} selected`;
  return (
    <>
      <button ref={button} type="button" className={`select input-filter multi-trigger${selected.length ? ' has-value' : ''}`} onClick={toggleOpen}
        aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${summary}`}>
        <span className="multi-summary">{summary}</span>
      </button>
      {open && pos && (
        <div ref={panel} className="multi-panel" style={{ top: pos.top, left: pos.left, width: pos.width }} role="listbox" aria-multiselectable="true" aria-label={label}>
          {options.length > 6 && (
            <span className="input-icon">
              <Icon name="search" size={13} />
              <input className="input input-filter" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label={`Search ${label}`} />
            </span>
          )}
          <div className="multi-tools">
            <button type="button" className="btn btn-link" onClick={() => onChange([...new Set([...selected, ...shown.map(([v]) => v)])])}>Select all</button>
            <button type="button" className="btn btn-link" onClick={() => onChange([])} disabled={selected.length === 0}>Clear</button>
          </div>
          <div className="multi-options">
            {shown.length === 0 && <p className="muted small">No matches.</p>}
            {shown.map(([v, text]) => (
              <label key={v} className="multi-option">
                <input type="checkbox" className="checkbox" checked={chosen.has(v)} onChange={() => toggle(v)} />
                <span>{text}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, noun }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void; noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <span className="muted">Showing {from}–{to} of {total} {noun}</span>
      <div className="pager">
        <button className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icon name="back" /></button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>
        ))}
        <button className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><Icon name="next" /></button>
        <select className="select select-sm" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
          {[10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, children, confirmLabel, tone = 'primary', busy, wide, confirmDisabled, cancelLabel = 'Cancel', hideCancel, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; tone?: 'primary' | 'danger'; busy?: boolean; wide?: boolean; confirmDisabled?: boolean;
  cancelLabel?: string; hideCancel?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className={`dialog${wide ? ' dialog-wide' : ''}`} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} aria-labelledby="dlg-title">
      <h2 id="dlg-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        {!hideCancel && <button className="btn btn-outline" onClick={onCancel} disabled={busy}>{cancelLabel}</button>}
        <button className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy || confirmDisabled}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
