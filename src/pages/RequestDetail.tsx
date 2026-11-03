import { useCallback, useEffect, useMemo, useState } from 'react';
import { AttributeTable } from '../components/AttributeTable.tsx';
import { ClarificationThread } from '../components/ClarificationThread.tsx';
import { Icon } from '../components/Icon.tsx';
import { RequestSummary } from '../components/RequestSummary.tsx';
import { Alert, ConfirmDialog, SectionTitle, Spinner } from '../components/ui.tsx';
import { loadRequest, respondToClarification, saveDivisionPortion } from '../data/services.ts';
import { attributesFor, canDivisionEdit, datasetId, missingRequiredValues, rowDivisionId, WorkflowError } from '../data/workflow.ts';
import type { Clarification, RequestState, Session } from '../data/types.ts';

type Feedback = { tone: 'success' | 'error' | 'info'; text: string; conflict?: boolean } | null;

const ownValues = (state: RequestState, divisionId: string) => {
  const out: Record<string, string> = {};
  for (const a of attributesFor(state.dataset, divisionId)) {
    const row = state.rows.find((r) => r.myapp_attributemapid === a.mapId && rowDivisionId(r) === divisionId);
    out[a.mapId] = row?.myapp_attributevalue ?? '';
  }
  return out;
};
const versionsOf = (state: RequestState) => Object.fromEntries(state.rows.map((r) => [r.myapp_tbl_moei_requestid, r.modifiedon]));
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** Request details for a business division user: own values editable while Draft, everything else read-only. */
export function RequestDetail({ session, requestKey, notice, backLabel = 'My Requests', onBack, onChanged, onDirtyChange }: {
  session: Session; requestKey: string; notice?: string; backLabel?: string; onBack: () => void; onChanged: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const divisionId = session.division?.id;
  const [state, setState] = useState<RequestState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(notice ? { tone: 'success', text: notice } : null);
  const [confirm, setConfirm] = useState<'submit' | 'leave' | null>(null);
  /** Required values left blank, highlighted after a Submit attempt. */
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [responding, setResponding] = useState<string | null>(null);

  const apply = useCallback((s: RequestState) => {
    setState(s);
    const v = divisionId ? ownValues(s, divisionId) : {};
    setValues(v);
    setLoaded(v);
    setVersions(versionsOf(s));
    setMissing(new Set());
  }, [divisionId]);

  const load = useCallback(async () => {
    try {
      apply(await loadRequest(session, requestKey));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [apply, session, requestKey]);

  useEffect(() => {
    let live = true;
    loadRequest(session, requestKey).then(
      (s) => live && apply(s),
      (e) => live && setLoadError(errorText(e)),
    );
    return () => { live = false; };
  }, [apply, session, requestKey]);

  const dirty = useMemo(() => Object.keys(values).some((k) => values[k] !== loaded[k]), [values, loaded]);
  const editable = !!state && !!divisionId && canDivisionEdit(state, divisionId);
  const unsaved = dirty && editable;

  // Warn before the browser tab closes or reloads, and tell the shell about unsaved edits.
  useEffect(() => {
    onDirtyChange(unsaved);
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const save = async (mode: 'draft' | 'submit') => {
    setBusy(mode);
    setFeedback(null);
    try {
      const next = await saveDivisionPortion(requestKey, values, versions, mode);
      apply(next);
      onChanged();
      if (mode === 'draft') setFeedback({ tone: 'success', text: 'Draft saved. Only your division’s values were changed.' });
      else if (next.overall === 'Pending DG Admin Review') setFeedback({ tone: 'success', text: 'Submitted. Every participating division has now submitted, so this request has gone to DG Admin for review.' });
      else setFeedback({ tone: 'success', text: 'Your division’s values are submitted and locked. The request stays In Progress until every other participating division submits.' });
    } catch (e) {
      // Keep the user's unsaved values on screen.
      setFeedback({ tone: 'error', text: errorText(e), conflict: e instanceof WorkflowError && (e.kind === 'conflict' || e.kind === 'locked') });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const back = () => (unsaved ? setConfirm('leave') : onBack());
  /** Every value of the division is filled in (Submit becomes active). */
  const complete = !!state && !!divisionId && missingRequiredValues(state, divisionId, values).length === 0;

  /** Answer a clarification; only the clarification record changes, never the values. */
  const respond = async (c: Clarification, text: string) => {
    setResponding(c.id);
    setFeedback(null);
    try {
      setState(await respondToClarification(requestKey, c.id, text, c.modifiedon));
      onChanged();
      setFeedback({ tone: 'success', text: `Response sent to DG Admin for ${c.attributeName}.` });
    } catch (e) {
      setFeedback({ tone: 'error', text: errorText(e), conflict: e instanceof WorkflowError && (e.kind === 'conflict' || e.kind === 'locked') });
    } finally {
      setResponding(null);
    }
  };

  /** Every owned attribute must have a value before Submit; the write path checks this again. */
  const requestSubmit = () => {
    if (!state || !divisionId) return;
    const blank = missingRequiredValues(state, divisionId, values);
    if (blank.length) {
      setMissing(new Set(blank.map((a) => a.mapId)));
      setFeedback({ tone: 'error', text: `Enter a value for every attribute before submitting. ${blank.length} value${blank.length === 1 ? ' is' : 's are'} missing: ${blank.map((a) => a.name).join(', ')}.` });
      return;
    }
    setMissing(new Set());
    setConfirm('submit');
  };

  const changeValue = (mapId: string, value: string) => {
    setValues((p) => ({ ...p, [mapId]: value }));
    if (value.trim() && missing.has(mapId)) setMissing((m) => { const next = new Set(m); next.delete(mapId); return next; });
  };

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <button className="btn btn-link" onClick={back}><Icon name="back" />{backLabel}</button>
        <span>/</span>
        <span>{requestKey}</span>
      </nav>

      {loadError && (
        <Alert tone="error" title="This request couldn't be opened">
          {loadError}
          <div className="alert-actions"><button className="btn btn-outline" onClick={() => void load()}><Icon name="refresh" />Try again</button></div>
        </Alert>
      )}
      {!state && !loadError && <Spinner label="Loading request…" />}

      {state && (
        <>
          <div className="page-header">
            <div>
              <h1>{state.dataset.name}</h1>
              <p className="muted"><span className="request-id">{state.key}</span> · Dataset {datasetId(state.dataset)}{state.dataset.description && state.dataset.description !== state.dataset.name ? ` · ${state.dataset.description}` : ''}</p>
            </div>
          </div>

          <RequestSummary state={state} viewerDivisionId={divisionId} showReadiness={false} />

          {feedback && (
            <Alert tone={feedback.tone}>
              {feedback.text}
              {feedback.conflict && <div className="alert-actions"><button className="btn btn-outline" onClick={() => { setFeedback(null); void load(); }}><Icon name="refresh" />Reload latest values</button></div>}
            </Alert>
          )}
          {!editable && divisionId && (
            <Alert tone="info">
              {!state.portions.some((p) => p.division.id === divisionId)
                ? 'Your division has no attributes in this request, so it is view-only for you.'
                : state.overall === 'Rejected'
                ? 'DG Admin rejected this request. Values stay locked because the correction and resubmission process has not been agreed yet.'
                : state.overall === 'Approved'
                  ? 'DG Admin approved this request. It is view-only.'
                  : state.overall === 'Pending DG Admin Review'
                    ? 'Every participating division has submitted. The request is with DG Admin and is view-only.'
                    : 'Your division has submitted its values. They are locked and view-only.'}
            </Alert>
          )}

          <div className="panel">
            <SectionTitle icon="layers" right={unsaved ? <span className="chip chip-amber">Unsaved changes</span> : null}>
              Attributes and division values
            </SectionTitle>
            <p className="muted small">
              Only attributes mapped to your division ({session.division?.name}) are shown, including attributes shared with other divisions. You can edit only your division’s values while your contribution is a draft. Every value is required before you submit; you can save a draft at any time.
              For a shared attribute each division’s value is kept separately; the other divisions’ values are shown read-only as soon as they save them, including drafts.
            </p>
            <AttributeTable
              state={state}
              viewerDivisionId={divisionId}
              editable={editable && !busy}
              values={values}
              onChange={changeValue}
              missing={missing}
            />
          </div>

          {editable && (
            <div className="form-actions">
              <button className="btn btn-outline" onClick={() => void save('draft')} disabled={!!busy || !dirty}>
                <Icon name="save" />{busy === 'draft' ? 'Saving…' : 'Save Draft'}
              </button>
              {/* Looks disabled until every value is entered; selecting it then explains what is missing. */}
              <button className={`btn btn-primary${complete ? '' : ' btn-soft-disabled'}`} onClick={requestSubmit} disabled={!!busy}
                aria-disabled={!complete || undefined} title={complete ? undefined : 'Enter every value to submit'}>
                <Icon name="send" />Submit
              </button>
            </div>
          )}

          <div className="panel">
            <SectionTitle icon="info">Clarifications for your division</SectionTitle>
            <ClarificationThread state={state} mode="division" busyId={responding} onRespond={(c, text) => void respond(c, text)} />
          </div>
        </>
      )}

      {confirm === 'submit' && (
        <ConfirmDialog title="Submit your division’s values?" confirmLabel="Submit" busy={busy === 'submit'} onCancel={() => setConfirm(null)} onConfirm={() => void save('submit')}>
          <p>This submits and locks the values for <strong>{session.division?.name}</strong> only. You won't be able to change them after you submit.</p>
          <p className="muted">The request goes to DG Admin for review once every participating division has submitted.</p>
        </ConfirmDialog>
      )}
      {confirm === 'leave' && (
        <ConfirmDialog title="Discard unsaved changes?" confirmLabel="Discard changes" tone="danger" onCancel={() => setConfirm(null)} onConfirm={onBack}>
          <p>You have changes that haven't been saved. Save them as a draft first if you want to keep them.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
