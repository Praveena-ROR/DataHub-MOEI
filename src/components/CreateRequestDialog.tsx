import { useMemo, useState } from 'react';
import { Icon } from './Icon.tsx';
import { Alert, ConfirmDialog } from './ui.tsx';
import { createRequests, type CatalogueItem, type CreateOutcome } from '../data/services.ts';
import { datasetId, normalize } from '../data/workflow.ts';
import type { Attribute, Division } from '../data/types.ts';

const isShared = (a: Attribute) => a.divisions.length > 1;

/** Divisions that take part when these attributes are selected (a shared attribute brings in every division mapped to it). */
const divisionsFor = (attributes: Attribute[], ids: ReadonlySet<string>) => {
  const out: Division[] = [];
  for (const a of attributes) if (ids.has(a.mapId)) for (const x of a.divisions) if (!out.some((y) => y.id === x.id)) out.push(x);
  return out;
};

/**
 * Create New Request, opened from My Requests. Lists only datasets that still
 * have attributes of the user's division (owned or shared) that are not already
 * in a request in progress, pending review or approved, and for each only those
 * attributes. Nothing is created until Create is selected. One request (with its
 * own Request ID from Dataverse) is created per dataset; the IDs are shown once
 * Dataverse has confirmed them.
 */
export function CreateRequestDialog({ division, items, onClose, onCreated, onOpen }: {
  division: Division;
  /** Datasets mapped to the division, each with the attributes still free to request. */
  items: CatalogueItem[];
  onClose: () => void;
  /** At least one request was created: the caller reloads its list. */
  onCreated: () => void;
  onOpen: (requestKey: string) => void;
}) {
  const [picked, setPicked] = useState<Map<string, ReadonlySet<string>>>(new Map());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<CreateOutcome[]>([]);
  const [results, setResults] = useState<CreateOutcome[] | null>(null);

  const requestable = useMemo(() => items.filter((i) => i.available.length > 0), [items]);
  const visible = useMemo(() => {
    const q = normalize(search);
    return requestable.filter((i) => picked.has(i.dataset.key) || !q || normalize(`${datasetId(i.dataset)} ${i.dataset.name}`).includes(q));
  }, [requestable, picked, search]);

  const chosen = requestable.filter((i) => picked.has(i.dataset.key));
  const problems = chosen.filter((i) => picked.get(i.dataset.key)!.size === 0).map((i) => `${i.dataset.name}: select at least one attribute.`);

  const toggleDataset = (item: CatalogueItem) => setPicked((m) => {
    const next = new Map(m);
    if (next.has(item.dataset.key)) next.delete(item.dataset.key); else next.set(item.dataset.key, new Set(item.available.map((a) => a.mapId)));
    return next;
  });
  const setAttributes = (key: string, ids: string[]) => setPicked((m) => new Map(m).set(key, new Set(ids)));
  const toggleAttribute = (key: string, mapId: string) => setPicked((m) => {
    const ids = new Set(m.get(key) ?? []);
    if (ids.has(mapId)) ids.delete(mapId); else ids.add(mapId);
    return new Map(m).set(key, ids);
  });

  const create = async () => {
    if (busy || chosen.length === 0 || problems.length) return;
    setBusy(true);
    setFailed([]);
    try {
      const batch = chosen.map((i) => ({ datasetKey: i.dataset.key, attributeIds: [...picked.get(i.dataset.key)!] }));
      const outcomes = await createRequests(batch);
      if (outcomes.some((r) => r.result)) {
        setResults(outcomes);
        onCreated();
      } else {
        setFailed(outcomes.filter((r) => r.error));
      }
    } catch (e) {
      // Nothing is reported as created. A retry never duplicates: attributes already in a request are refused.
      setFailed(chosen.map((i) => ({ datasetKey: i.dataset.key, datasetName: i.dataset.name, error: e instanceof Error ? e.message : 'The request could not be created.' })));
    } finally {
      setBusy(false);
    }
  };

  if (results) {
    const ok = results.filter((r) => r.result?.requestKey);
    const errors = results.filter((r) => r.error);
    return (
      <ConfirmDialog wide title="Requests created" confirmLabel="Done" hideCancel onCancel={onClose} onConfirm={onClose}>
        <Alert tone="success">{ok.length} request(s) were saved in Dataverse. Open one to enter your division's values.</Alert>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Request ID</th><th scope="col">Dataset</th><th scope="col" className="right">Action</th></tr></thead>
            <tbody>
              {ok.map((o) => {
                const key = o.result!.requestKey;
                return (
                  <tr key={o.datasetKey}>
                    <td><span className="request-id">{key}</span></td>
                    <td className="wrap">{o.datasetName}</td>
                    <td className="right"><button className="btn btn-link" onClick={() => onOpen(key)}><Icon name="arrow" />Open</button></td>
                  </tr>
                );
              })}
              {errors.map((o) => (
                <tr key={o.datasetKey}>
                  <td><span className="muted">—</span></td>
                  <td className="wrap" colSpan={2}>{o.datasetName}: <span className="warn-text">not created. {o.error}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {errors.length > 0 && <p className="muted small">Select Create New Request again to retry the datasets that were not created.</p>}
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      wide
      title="Create New Request"
      confirmLabel={busy ? 'Creating…' : chosen.length > 1 ? `Create ${chosen.length} requests` : 'Create request'}
      busy={busy}
      confirmDisabled={chosen.length === 0 || problems.length > 0}
      onCancel={onClose}
      onConfirm={() => void create()}
    >
      <p className="muted small">
        Choose the datasets and the attributes the request covers. Only attributes mapped to {division.name} that are not already in a request
        (in progress, pending review or approved) are listed. One request with its own Request ID is created per dataset.
      </p>
      {failed.length > 0 && (
        <Alert tone="error" title="The request could not be created">
          <ul className="result-list">{failed.map((o) => <li key={o.datasetKey}>{o.datasetName}: {o.error}</li>)}</ul>
          <div className="small">Your selection is kept. Select Create again to retry; a retry never creates a duplicate.</div>
        </Alert>
      )}
      <div className="toolbar">
        <span className="input-icon drill-search">
          <Icon name="search" size={13} />
          <input className="input input-filter" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search datasets" aria-label="Search datasets" />
        </span>
        <span className="selection-count" aria-live="polite">{chosen.length} selected</span>
      </div>
      {requestable.length === 0 ? (
        <p className="muted">There is nothing left to request: every attribute of your division is already in a request that is in progress, pending review or approved.</p>
      ) : (
        <div className="pick-list">
          {visible.length === 0 && <p className="muted small">No datasets match the search.</p>}
          {visible.map((item) => {
            const { dataset: d, available } = item;
            const ids = picked.get(d.key);
            const parts = ids ? divisionsFor(available, ids) : [];
            const shared = available.filter(isShared).length;
            return (
              <div key={d.key} className={`pick-dataset${ids ? ' selected' : ''}`}>
                <div className="pick-head">
                  <label>
                    <input type="checkbox" className="checkbox" checked={!!ids} onChange={() => toggleDataset(item)} />
                    <span>
                      <span className="mono">{datasetId(d)}</span> · {d.name}
                      <span className="sub">{available.length} attribute{available.length === 1 ? '' : 's'} to request · {available.length - shared} owned · {shared} shared</span>
                    </span>
                  </label>
                </div>
                {ids && (
                  <>
                    <div className="pick-tools">
                      <span className="muted">Attributes ({ids.size} of {available.length} selected):</span>
                      <button type="button" className="btn btn-link" onClick={() => setAttributes(d.key, available.map((a) => a.mapId))}>Select all</button>
                      <button type="button" className="btn btn-link" onClick={() => setAttributes(d.key, [])}>None</button>
                    </div>
                    <div className="pick-attrs">
                      {available.map((a) => (
                        <label key={a.mapId} className="pick-attr">
                          <input type="checkbox" className="checkbox" checked={ids.has(a.mapId)} onChange={() => toggleAttribute(d.key, a.mapId)} />
                          <span>
                            {a.name}{a.unit ? ` (${a.unit})` : ''}
                            <span className="sub">{isShared(a) ? `Shared · ${a.divisions.map((x) => x.name).join(' / ')}` : `Owned by ${division.name}`}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="pick-tools">
                      <span className="muted">Divisions taking part:</span>
                      {parts.length ? parts.map((x) => <span key={x.id} className={`chip${x.id === division.id ? ' chip-green' : ''}`}>{x.name}</span>) : <span className="muted">none</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {problems.length > 0 && <div className="field-error">{problems.join(' ')}</div>}
    </ConfirmDialog>
  );
}
