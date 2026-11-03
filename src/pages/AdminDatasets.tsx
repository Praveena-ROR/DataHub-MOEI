import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { pageSlice } from '../components/format.ts';
import { Alert, ConfirmDialog, FilterText, MultiSelectFilter, Pagination, SectionTitle, Th } from '../components/ui.tsx';
import {
  AdminValidationError, CLASSIFICATION_OPTIONS, datasetUsage, divisionChoices, draftFromDataset, LIMITS, MAX_ATTRIBUTES, nextDatasetNumber,
  validateDataset, VALUE_TYPE_OPTIONS, type AttributeDraft, type DatasetDraft, type DraftErrors,
} from '../data/admin.ts';
import { saveDataset, type AdminCentreData } from '../data/services.ts';
import { datasetId, normalize } from '../data/workflow.ts';
import type { Dataset } from '../data/types.ts';

type Mode = { kind: 'list' } | { kind: 'form'; number?: number };

let seq = 0;
const newKey = () => `new-${Date.now().toString(36)}-${++seq}`;
const blankAttribute = (): AttributeDraft => ({ key: newKey(), name: '', description: '', unit: '', divisions: [], classification: '', valueType: '', comments: '' });
const label = (options: [number, string][], v: string) => options.find(([n]) => String(n) === v)?.[1];

/** One row of the dataset list: a mapped dataset, or a reference row with no mapping rows yet. */
interface ListRow { number: number; name: string; description?: string; dataset?: Dataset; attributes: number; divisions: string[]; classifications: string[]; requests: string[] }

/**
 * Dataset & Attribute Management: the dataset list (from the mapping table, plus
 * reference rows with no attributes yet), a details pop-up, and a three-step
 * create/edit form that writes both tables. Datasets are never removed; attributes
 * not used by any request can be removed while editing.
 */
export function AdminDatasets({ data, onSaved }: { data: AdminCentreData; onSaved: (message: string) => void }) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [search, setSearch] = useState('');
  const [divisionFilter, setDivisionFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  /** Dataset number whose details pop-up is open. */
  const [viewing, setViewing] = useState<number | null>(null);

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = data.datasets.filter((d) => d.number != null).map((d) => ({
      number: d.number!, name: d.name, description: d.description, dataset: d, attributes: d.attributes.length,
      divisions: d.divisions.map((x) => x.name), classifications: d.classifications, requests: datasetUsage(d, data.requests, data.values).requests,
    }));
    for (const r of data.references) {
      if (r.myapp_recordnumber == null || out.some((x) => x.number === r.myapp_recordnumber)) continue;
      out.push({ number: r.myapp_recordnumber, name: r.myapp_datasetname ?? '(unnamed)', attributes: 0, divisions: [], classifications: [], requests: data.requests.filter((q) => q.datasetKey === String(r.myapp_recordnumber)).map((q) => q.key) });
    }
    return out.sort((a, b) => a.number - b.number);
  }, [data]);
  const divisionOptions = useMemo(() => [...new Set(rows.flatMap((r) => r.divisions))].sort().map((d) => [d, d] as [string, string]), [rows]);
  const shown = useMemo(() => {
    const q = normalize(search);
    return rows
      .filter((r) => !q || normalize(`${datasetId({ number: r.number, key: String(r.number) })} ${r.name} ${r.description ?? ''}`).includes(q))
      .filter((r) => divisionFilter.length === 0 || r.divisions.some((d) => divisionFilter.includes(d)));
  }, [rows, search, divisionFilter]);
  const current = Math.min(page, Math.max(1, Math.ceil(shown.length / pageSize)));

  if (mode.kind === 'form') {
    const row = mode.number != null ? rows.find((r) => r.number === mode.number) : undefined;
    return <DatasetForm key={mode.number ?? 'new'} data={data} row={row} onCancel={() => setMode({ kind: 'list' })}
      onSaved={(msg, number) => { onSaved(msg); setMode({ kind: 'list' }); setViewing(number); }} />;
  }
  const viewRow = viewing != null ? rows.find((r) => r.number === viewing) : undefined;

  return (
    <section className="panel">
      <SectionTitle icon="datasets" right={<button className="btn btn-primary btn-sm" onClick={() => setMode({ kind: 'form' })}><Icon name="plus" />Create Dataset</button>}>
        Datasets ({rows.length})
      </SectionTitle>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <Th icon="hash">Dataset ID</Th>
              <Th icon="datasets">Dataset</Th>
              <Th icon="layers">Attributes</Th>
              <Th icon="users">Business divisions</Th>
              <Th icon="lock">Classification</Th>
              <Th icon="actions" className="right">Actions</Th>
            </tr>
            <tr className="filter-row">
              <th colSpan={2}><FilterText label="Search datasets" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Dataset ID, name or description" /></th>
              <th />
              <th><MultiSelectFilter label="Filter by business division" options={divisionOptions} selected={divisionFilter} onChange={(v) => { setDivisionFilter(v); setPage(1); }} /></th>
              <th />
              <th className="right">{(search || divisionFilter.length > 0) && <button className="btn btn-link" onClick={() => { setSearch(''); setDivisionFilter([]); }}><Icon name="x" />Clear</button>}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6} className="center muted">{rows.length ? 'No datasets match these filters.' : 'No datasets yet. Select Create Dataset to add one.'}</td></tr>}
            {pageSlice(shown, pageSize, current).map((r) => (
              <tr key={r.number} className="clickable-row" onClick={() => setViewing(r.number)} title="Show the dataset's details">
                <td className="mono">{datasetId({ number: r.number, key: String(r.number) })}</td>
                <td className="wrap"><div>{r.name}</div>{r.description && r.description !== r.name && <div className="sub">{r.description}</div>}</td>
                <td>{r.attributes || <span className="warn-text small">None mapped</span>}</td>
                <td><div className="chips">{r.divisions.map((d) => <span key={d} className="chip">{d}</span>)}</div></td>
                <td>{r.classifications.join(', ') || <span className="muted">—</span>}</td>
                <td className="right" onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-link" onClick={() => setViewing(r.number)}><Icon name="eye" />View</button>
                  <button className="btn btn-link" onClick={() => setMode({ kind: 'form', number: r.number })}><Icon name="edit" />Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 0 && <Pagination page={current} pageSize={pageSize} total={shown.length} noun="dataset(s)" onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}

      {viewRow && <DatasetPopup data={data} row={viewRow} onClose={() => setViewing(null)} onEdit={() => { setViewing(null); setMode({ kind: 'form', number: viewRow.number }); }} />}
    </section>
  );
}

/** Dataset details pop-up: ID, description, attributes (count and names) with divisions, classification, unit, comments and value type. */
function DatasetPopup({ data, row, onClose, onEdit }: { data: AdminCentreData; row: ListRow; onClose: () => void; onEdit: () => void }) {
  const mapRows = new Map(data.mapRows.map((r) => [r.myapp_tbl_moei_datasetandbusinessmapid, r]));
  const usage = row.dataset ? datasetUsage(row.dataset, data.requests, data.values) : undefined;
  const attrs = row.dataset?.attributes ?? [];
  const id = datasetId({ number: row.number, key: String(row.number) });
  return (
    <ConfirmDialog wide title={`${id} · ${row.name}`} confirmLabel="Edit" cancelLabel="Close" onCancel={onClose} onConfirm={onEdit}>
      <dl className="kv">
        <dt>Dataset ID</dt><dd>{id}</dd>
        <dt>Description</dt><dd>{row.description || <span className="muted">Not set</span>}</dd>
        <dt>Attributes</dt><dd>{attrs.length}{attrs.length > 0 && <> · {attrs.map((a) => a.name).join(', ')}</>}</dd>
        <dt>Business divisions</dt><dd>{row.divisions.join(', ') || <span className="muted">None</span>}</dd>
        <dt>Classification</dt><dd>{row.classifications.join(', ') || <span className="muted">Not set</span>}</dd>
      </dl>
      {attrs.length === 0 ? <p className="muted">No attributes are mapped yet. Select Edit to add them.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th scope="col">Attribute</th><th scope="col">Business divisions</th><th scope="col">Classification</th><th scope="col">Unit</th><th scope="col">Comments</th><th scope="col">Attribute value</th></tr>
            </thead>
            <tbody>
              {attrs.map((a) => (
                <tr key={a.mapId}>
                  <td className="wrap">
                    <div>{a.name}{usage?.lockedAttributes.has(a.mapId) && <span className="chip" title="Used by a request"><Icon name="lock" size={11} /> In use</span>}</div>
                    {a.description && <div className="sub">{a.description}</div>}
                  </td>
                  <td><div className="chips">{a.divisions.map((d) => <span key={d.id} className="chip">{d.name}</span>)}{a.unresolved.map((t) => <span key={t} className="chip chip-amber">{t}</span>)}</div>{a.divisions.length > 1 && <div className="sub">Shared</div>}</td>
                  <td>{a.classification ?? <span className="muted">—</span>}</td>
                  <td>{a.unit ?? <span className="muted">—</span>}</td>
                  <td className="wrap">{mapRows.get(a.mapId)?.myapp_comments || <span className="muted">—</span>}</td>
                  <td>{a.valueType ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ConfirmDialog>
  );
}

const STEPS = ['Dataset details', 'Attributes', 'Review and save'];

/** Create or edit a dataset in three steps. The form keeps its entries if saving fails. */
function DatasetForm({ data, row, onCancel, onSaved }: { data: AdminCentreData; row?: ListRow; onCancel: () => void; onSaved: (message: string, number: number) => void }) {
  const original = useMemo(() => (row?.dataset ? draftFromDataset(row.dataset, data.mapRows) : undefined), [row, data.mapRows]);
  const [draft, setDraft] = useState<DatasetDraft>(() => original ?? {
    number: row ? String(row.number) : String(nextDatasetNumber(data.datasets, data.references)), name: row?.name ?? '', description: '', attributes: [blankAttribute()],
  });
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const listEnd = useRef<HTMLDivElement>(null);

  const divisions = useMemo(() => divisionChoices(data.users), [data]);
  const usage = useMemo(() => (row?.dataset ? datasetUsage(row.dataset, data.requests, data.values) : undefined), [row, data]);
  const editing = !!row;
  const ctx = useMemo(() => ({
    datasets: data.datasets,
    references: data.references.filter((r) => r.myapp_recordnumber !== row?.number),
    divisions,
    original: row?.dataset && original && usage ? { dataset: row.dataset, draft: original, usage } : undefined,
  }), [data, row, divisions, original, usage]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original ?? null);

  const set = (changes: Partial<DatasetDraft>) => setDraft((d) => ({ ...d, ...changes }));
  const setAttr = (key: string, changes: Partial<AttributeDraft>) => setDraft((d) => ({ ...d, attributes: d.attributes.map((a) => (a.key === key ? { ...a, ...changes } : a)) }));
  const addAttr = () => {
    setDraft((d) => ({ ...d, attributes: [...d.attributes, blankAttribute()] }));
    setTimeout(() => listEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 0);
  };
  const removeAttr = (key: string) => setDraft((d) => ({ ...d, attributes: d.attributes.filter((a) => a.key !== key) }));
  const toggleDivision = (a: AttributeDraft, name: string) =>
    setAttr(a.key, { divisions: a.divisions.some((n) => normalize(n) === normalize(name)) ? a.divisions.filter((n) => normalize(n) !== normalize(name)) : [...a.divisions, name] });

  const errorsFor = (all: DraftErrors, s: number) => Object.fromEntries(Object.entries(all).filter(([k]) => (s === 0 ? !k.startsWith('attr') && k !== 'attributes' : k.startsWith('attr') || k === 'attributes')));
  const next = () => {
    const all = validateDataset(draft, ctx);
    const here = errorsFor(all, step);
    setErrors(here);
    if (Object.keys(here).length === 0) setStep((s) => s + 1);
  };
  const save = async () => {
    const all = validateDataset(draft, ctx);
    if (Object.keys(all).length) {
      setErrors(all);
      setStep(Object.keys(errorsFor(all, 0)).length ? 0 : 1);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await saveDataset(draft, row?.number);
      onSaved(editing
        ? `${draft.name} was saved: ${r.created} attribute(s) added, ${r.updated} updated, ${r.removed} removed. Both tables are up to date.`
        : `${draft.name} (${datasetId({ number: r.datasetNumber, key: draft.number })}) was created with ${draft.attributes.length} attribute(s) in both tables.`, r.datasetNumber);
    } catch (e) {
      if (e instanceof AdminValidationError) {
        setErrors(e.errors);
        setStep(Object.keys(errorsFor(e.errors, 0)).length ? 0 : 1);
      }
      setFailure(e instanceof Error ? e.message : 'The dataset could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (k: string) => errors[k] && <div className="field-error">{errors[k]}</div>;
  const locked = (a: AttributeDraft) => !!a.mapId && !!usage?.lockedAttributes.has(a.mapId);

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <button className="btn btn-link" onClick={() => (dirty ? setConfirmLeave(true) : onCancel())}><Icon name="back" />Datasets</button>
        <span>/</span><span>{editing ? 'Edit dataset' : 'Create dataset'}</span>
      </nav>
      <ol className="steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'active' : i < step ? 'done' : undefined} aria-current={i === step ? 'step' : undefined}>
            <button type="button" onClick={() => (i < step ? setStep(i) : undefined)} disabled={i > step}><span className="step-no">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>{s}</button>
          </li>
        ))}
      </ol>
      {failure && <Alert tone="error" title="Not saved">{failure}</Alert>}

      {step === 0 && (
        <section className="panel form-panel">
          <SectionTitle icon="datasets">Dataset details</SectionTitle>
          <div className="form-grid">
            <div className="field">
              <span className="field-label">Dataset ID</span>
              <span className="auto-value">{datasetId({ number: Number(draft.number), key: draft.number })}</span>
              <span className="sub">{editing ? 'Cannot be changed' : 'Assigned automatically (the next free number)'}</span>
              {fieldError('number')}
            </div>
            <label className="field grow">
              <span className="field-label">Dataset name <span className="req">*</span></span>
              <input className={`input${errors.name ? ' input-invalid' : ''}`} value={draft.name} maxLength={LIMITS.datasetName} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!errors.name || undefined} />
              {fieldError('name')}
            </label>
            <label className="field full">
              <span className="field-label">Dataset description</span>
              <input className={`input${errors.description ? ' input-invalid' : ''}`} value={draft.description} maxLength={LIMITS.datasetDescription} onChange={(e) => set({ description: e.target.value })} />
              <span className="sub">{draft.description.length}/{LIMITS.datasetDescription} characters (stored on each attribute's mapping row)</span>
              {fieldError('description')}
            </label>
          </div>
          <p className="muted small">Classification is set per attribute in the next step; the dataset's classification is shown as the set of its attributes' classifications.</p>
        </section>
      )}

      {step === 1 && (
        <section className="panel form-panel">
          <SectionTitle icon="layers" right={<span className="muted small">{draft.attributes.length} of at most {MAX_ATTRIBUTES}</span>}>Attributes</SectionTitle>
          {errors.attributes && <Alert tone="error">{errors.attributes}</Alert>}
          <div className="attr-forms">
            {draft.attributes.map((a, i) => {
              const k = (f: string) => `attr:${a.key}:${f}`;
              const isLocked = locked(a);
              return (
                <fieldset key={a.key} className="attr-form">
                  <legend>
                    Attribute {i + 1}{a.name.trim() ? ` · ${a.name.trim()}` : ''}
                    {isLocked && <span className="chip" title="Used by a request: name, unit and divisions are locked"><Icon name="lock" size={12} /> In use</span>}
                    {a.divisions.length > 1 && <span className="chip chip-green">Shared</span>}
                  </legend>
                  <button type="button" className="btn btn-link danger-link attr-remove" disabled={isLocked || draft.attributes.length === 1} onClick={() => removeAttr(a.key)}
                    title={isLocked ? 'Used by a request — cannot be removed' : draft.attributes.length === 1 ? 'A dataset needs at least one attribute' : 'Remove this attribute'}>
                    <Icon name="trash" />Remove
                  </button>
                  <div className="form-grid">
                    <label className="field grow">
                      <span className="field-label">Attribute name <span className="req">*</span></span>
                      <input className={`input${errors[k('name')] ? ' input-invalid' : ''}`} value={a.name} maxLength={LIMITS.attributeName} disabled={isLocked} onChange={(e) => setAttr(a.key, { name: e.target.value })} />
                      {fieldError(k('name'))}
                    </label>
                    <label className="field">
                      <span className="field-label">Unit</span>
                      <input className={`input${errors[k('unit')] ? ' input-invalid' : ''}`} value={a.unit} maxLength={LIMITS.unit} disabled={isLocked} onChange={(e) => setAttr(a.key, { unit: e.target.value })} placeholder="e.g. GWh" />
                      {fieldError(k('unit'))}
                    </label>
                    <label className="field">
                      <span className="field-label">Classification</span>
                      <select className="select" value={a.classification} onChange={(e) => setAttr(a.key, { classification: e.target.value })}>
                        <option value="">Not set</option>
                        {CLASSIFICATION_OPTIONS.map(([v, t]) => <option key={v} value={String(v)}>{t}</option>)}
                      </select>
                      {fieldError(k('classification'))}
                    </label>
                    <label className="field">
                      <span className="field-label">Value type</span>
                      <select className="select" value={a.valueType} onChange={(e) => setAttr(a.key, { valueType: e.target.value })}>
                        <option value="">Not set</option>
                        {VALUE_TYPE_OPTIONS.map(([v, t]) => <option key={v} value={String(v)}>{t}</option>)}
                      </select>
                    </label>
                    <label className="field full">
                      <span className="field-label">Attribute description</span>
                      <input className={`input${errors[k('description')] ? ' input-invalid' : ''}`} value={a.description} maxLength={LIMITS.attributeDescription} onChange={(e) => setAttr(a.key, { description: e.target.value })} />
                      {fieldError(k('description'))}
                    </label>
                    <div className="field full" role="group" aria-label={`Business divisions for attribute ${i + 1}`}>
                      <span className="field-label">Business divisions <span className="req">*</span> <span className="sub">(select two or more for a shared attribute)</span></span>
                      <div className="division-picks">
                        {divisions.map((d) => {
                          const on = a.divisions.some((n) => normalize(n) === normalize(d.name));
                          return (
                            <label key={d.name} className={`division-pick${on ? ' on' : ''}${d.selectable ? '' : ' off'}`} title={d.reason}>
                              <input type="checkbox" className="checkbox" checked={on} disabled={isLocked || (!d.selectable && !on)} onChange={() => toggleDivision(a, d.name)} />
                              {d.name}
                            </label>
                          );
                        })}
                      </div>
                      {a.divisions.length > 0 && <span className="sub">Mapped to: {a.divisions.join(' / ')}</span>}
                      {fieldError(k('divisions'))}
                    </div>
                    <label className="field full">
                      <span className="field-label">Comments</span>
                      <textarea className="input textarea" rows={2} value={a.comments} maxLength={LIMITS.comments} onChange={(e) => setAttr(a.key, { comments: e.target.value })} />
                      {fieldError(k('comments'))}
                    </label>
                  </div>
                </fieldset>
              );
            })}
            <div ref={listEnd} />
          </div>
          <button type="button" className="btn btn-outline" onClick={addAttr} disabled={draft.attributes.length >= MAX_ATTRIBUTES}
            title={draft.attributes.length >= MAX_ATTRIBUTES ? `tbl_MOEI_DatasetWithAttributes holds at most ${MAX_ATTRIBUTES} attributes` : undefined}>
            <Icon name="plus" />Add Attribute
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="panel form-panel">
          <SectionTitle icon="check">Review and save</SectionTitle>
          <dl className="kv">
            <dt>Dataset</dt><dd>{datasetId({ number: Number(draft.number), key: draft.number })} · {draft.name}</dd>
            <dt>Description</dt><dd>{draft.description || <span className="muted">Not set</span>}</dd>
            <dt>Attributes</dt><dd>{draft.attributes.length}</dd>
          </dl>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">#</th><th scope="col">Attribute</th><th scope="col">Unit</th><th scope="col">Divisions</th><th scope="col">Classification</th><th scope="col">Value type</th></tr></thead>
              <tbody>
                {draft.attributes.map((a, i) => (
                  <tr key={a.key}>
                    <td>{i + 1}</td>
                    <td className="wrap"><div>{a.name}</div>{a.description && <div className="sub">{a.description}</div>}</td>
                    <td>{a.unit || '—'}</td>
                    <td><div className="chips">{a.divisions.map((d) => <span key={d} className="chip">{d}</span>)}</div>{a.divisions.length > 1 && <div className="sub">Shared</div>}</td>
                    <td>{label(CLASSIFICATION_OPTIONS, a.classification) ?? '—'}</td>
                    <td>{label(VALUE_TYPE_OPTIONS, a.valueType) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Saving writes one row per attribute to tbl_MOEI_DatasetAndBusinessMaps and the dataset row to tbl_MOEI_DatasetWithAttributes (attribute names in its Attribute 1–{MAX_ATTRIBUTES} columns).
            The new attributes appear only to the divisions they are mapped to; a shared attribute appears to every mapped division, each with its own value.
          </p>
        </section>
      )}

      <div className="form-actions">
        <button className="btn btn-outline" onClick={() => (dirty ? setConfirmLeave(true) : onCancel())} disabled={busy}>Cancel</button>
        {step > 0 && <button className="btn btn-outline" onClick={() => setStep((s) => s - 1)} disabled={busy}><Icon name="back" />Back</button>}
        {step < 2 && <button className="btn btn-primary" onClick={next}>Next<Icon name="next" /></button>}
        {step === 2 && <button className="btn btn-primary" onClick={() => void save()} disabled={busy}><Icon name="save" />{busy ? 'Saving…' : editing ? 'Save changes' : 'Create dataset'}</button>}
      </div>

      {confirmLeave && (
        <ConfirmDialog title="Discard your changes?" confirmLabel="Discard" tone="danger" onCancel={() => setConfirmLeave(false)} onConfirm={onCancel}>
          <p>The dataset has not been saved. Your entries will be lost.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
