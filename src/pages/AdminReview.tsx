import { useEffect, useState } from 'react';
import { AttributeTable } from '../components/AttributeTable.tsx';
import { ClarificationThread } from '../components/ClarificationThread.tsx';
import { Icon } from '../components/Icon.tsx';
import { RequestSummary } from '../components/RequestSummary.tsx';
import { formatDateTime, personName } from '../components/format.ts';
import { Alert, ConfirmDialog, SectionTitle, Spinner } from '../components/ui.tsx';
import { loadRequest, recordDecision, requestClarification, resolveClarification } from '../data/services.ts';
import { datasetId, isOpen, rowDivisionId, TEXT_MAX_LENGTH, WorkflowError } from '../data/workflow.ts';
import type { Attribute, Clarification, Division, RequestState, ReviewStatus, Session, ValueRow } from '../data/types.ts';

type Feedback = { tone: 'success' | 'error'; text: string; reload?: boolean } | null;
type ClarificationTarget = { attribute: Attribute; division: Division; row: ValueRow; followUp: boolean };
type ReportState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; fileName: string; url: string } | { kind: 'error'; message: string };

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** DG Admin request details: combined values, clarifications, the decision (with its comment) and the final report. */
export function AdminReview({ session, requestKey, backLabel, onBack, onChanged }: {
  session: Session; requestKey: string; backLabel: string; onBack: () => void; /** A decision or clarification was saved. */ onChanged?: () => void;
}) {
  const [state, setState] = useState<RequestState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [decision, setDecision] = useState<ReviewStatus | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [target, setTarget] = useState<ClarificationTarget | null>(null);
  const [question, setQuestion] = useState('');
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportState>({ kind: 'idle' });

  useEffect(() => {
    let live = true;
    loadRequest(session, requestKey).then(
      (s) => live && setState(s),
      (e) => live && setError(errorText(e, 'This request could not be loaded.')),
    );
    return () => { live = false; };
  }, [session, requestKey]);

  const reload = () => {
    setFeedback(null);
    loadRequest(session, requestKey).then(setState, (e) => setError(errorText(e, 'This request could not be loaded.')));
  };

  /** Run a write; keep the user's typed text if it fails. */
  const run = async (key: string, action: () => Promise<RequestState>, success: string): Promise<boolean> => {
    setBusy(key);
    setFeedback(null);
    try {
      setState(await action());
      onChanged?.();
      setFeedback({ tone: 'success', text: success });
      return true;
    } catch (e) {
      setFeedback({ tone: 'error', text: errorText(e, 'The change could not be saved.'), reload: e instanceof WorkflowError && (e.kind === 'conflict' || e.kind === 'locked') });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const startDecision = (d: ReviewStatus) => {
    if (d === 'Rejected' && !reason.trim()) {
      setReasonError('Enter the reason for rejecting this request.');
      return;
    }
    setReasonError(null);
    setDecision(d);
  };

  const decide = async () => {
    if (!decision) return;
    const ok = await run('decision', () => recordDecision(requestKey, decision, reason),
      decision === 'Approved'
        ? 'Approved. The submitted values stay locked. You can now download the PDF report.'
        : 'Rejected. The submitted values stay locked because the correction and resubmission process has not been agreed yet. You can now download the PDF report.');
    setDecision(null);
    if (ok) setReason('');
  };

  const downloadReport = async () => {
    setReport({ kind: 'busy' });
    try {
      const { downloadRequestReport } = await import('../report/download.ts'); // loaded on demand (jsPDF is large)
      const file = await downloadRequestReport(requestKey);
      setReport({ kind: 'done', ...file });
    } catch (e) {
      setReport({ kind: 'error', message: errorText(e, 'The report could not be generated.') });
    }
  };

  const openClarification = (attribute: Attribute, division: Division, row: ValueRow, followUp: boolean) => {
    setTarget({ attribute, division, row, followUp });
    setQuestion('');
    setQuestionError(null);
  };

  const askClarification = async () => {
    if (!target) return;
    if (!question.trim()) {
      setQuestionError('Enter the clarification question.');
      return;
    }
    const ok = await run('clarify', () => requestClarification(requestKey, target.attribute.mapId, target.division.id, question),
      `Clarification sent to ${target.division.name}. Their submitted value is unchanged.`);
    if (ok) {
      setTarget(null);
      setQuestion('');
    }
  };

  const resolve = (c: Clarification) =>
    run(c.id, () => resolveClarification(requestKey, c.id, c.modifiedon), `Clarification on ${c.attributeName} (${c.divisionName}) resolved.`);

  const followUp = (c: Clarification) => {
    if (!state) return;
    const attribute = state.dataset.attributes.find((a) => a.mapId === c.mapId);
    const division = attribute?.divisions.find((d) => d.id === c.divisionId);
    const row = state.rows.find((r) => r.myapp_attributemapid === c.mapId && rowDivisionId(r) === c.divisionId);
    if (attribute && division && row) openClarification(attribute, division, row, true);
  };

  const undecided = !!state && !state.review;
  const openClarifications = state?.clarifications.filter(isOpen) ?? [];
  const canDecide = !!state && undecided && state.overall === 'Pending DG Admin Review';

  const clarifyAction = (attribute: Attribute, division: Division, row: ValueRow | undefined) => {
    if (!state || !undecided || row?.myapp_submissionstatus !== 'Submitted') return null;
    const waiting = state.clarifications.some((c) => c.mapId === attribute.mapId && c.divisionId === division.id && c.status === 'Pending Response');
    if (waiting) return <span className="muted small">Awaiting response</span>;
    return (
      <button className="btn btn-link" onClick={() => openClarification(attribute, division, row, false)}>
        <Icon name="info" />Request clarification
      </button>
    );
  };

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <button className="btn btn-link" onClick={onBack}><Icon name="back" />{backLabel}</button>
        <span>/</span>
        <span>{requestKey}</span>
      </nav>
      {error && <Alert tone="error" title="This request couldn't be opened">{error}</Alert>}
      {!state && !error && <Spinner label="Loading request…" />}

      {state && (
        <>
          <div className="page-header">
            <div>
              <h1>{state.dataset.name}</h1>
              <p className="muted"><span className="request-id">{state.key}</span> · Dataset {datasetId(state.dataset)} · values from every participating division</p>
            </div>
            {state.review && (
              <div className="page-actions">
                <button className="btn btn-primary" onClick={() => void downloadReport()} disabled={report.kind === 'busy'}>
                  <Icon name="save" />{report.kind === 'busy' ? 'Preparing report…' : 'Download PDF Report'}
                </button>
              </div>
            )}
          </div>
          {report.kind === 'done' && (
            <Alert tone="success">
              Report downloaded as {report.fileName}.{' '}
              <a className="btn btn-link" href={report.url} target="_blank" rel="noopener noreferrer">Open the PDF</a> if the download didn't start.
            </Alert>
          )}
          {report.kind === 'error' && (
            <Alert tone="error" title="The PDF report couldn't be generated">
              {report.message} The decision is saved and unaffected.
              <div className="alert-actions"><button className="btn btn-outline" onClick={() => void downloadReport()}><Icon name="refresh" />Try again</button></div>
            </Alert>
          )}

          <RequestSummary state={state} />

          {feedback && (
            <Alert tone={feedback.tone}>
              {feedback.text}
              {feedback.reload && <div className="alert-actions"><button className="btn btn-outline" onClick={reload}><Icon name="refresh" />Reload latest</button></div>}
            </Alert>
          )}

          <div className="panel">
            <SectionTitle icon="layers">Attributes and division values</SectionTitle>
            <p className="muted small">Shared attributes list each division's value on its own row, so you can ask the exact division about its value. Asking for clarification never changes or unlocks a submitted value.</p>
            <AttributeTable state={state} editable={false} values={{}} rowAction={clarifyAction} />
          </div>

          <div className="panel">
            <SectionTitle icon="info">Clarifications</SectionTitle>
            <ClarificationThread state={state} mode="admin" busyId={busy} onResolve={(c) => void resolve(c)} onFollowUp={followUp} />
          </div>

          {state.review ? (
            <div className="panel">
              <SectionTitle icon="shield">Decision</SectionTitle>
              <dl className="kv">
                <dt>Decision</dt><dd>{state.review.status}</dd>
                <dt>Reviewed by</dt><dd>{personName(state.names, state.review.by)}{state.review.by && state.roles?.[state.review.by.toLowerCase()] ? ` (${state.roles[state.review.by.toLowerCase()]})` : ''}</dd>
                <dt>Reviewed on</dt><dd>{formatDateTime(state.review.on)}</dd>
                <dt>{state.review.status === 'Rejected' ? 'Rejection reason' : 'Approval comment'}</dt><dd>{state.review.comments || '—'}</dd>
              </dl>
            </div>
          ) : canDecide && (
            <div className="panel">
              <SectionTitle icon="shield">Decision</SectionTitle>
              {openClarifications.length > 0 && (
                <Alert tone="warning">
                  You can't approve or reject while {openClarifications.length} clarification{openClarifications.length === 1 ? ' is' : 's are'} still open. Resolve them first.
                </Alert>
              )}
              <label className="field spaced">
                <span className="field-label">Approval comment (optional) or rejection reason (required to reject)</span>
                <textarea
                  className={`input textarea${reasonError ? ' input-invalid' : ''}`}
                  rows={3}
                  maxLength={TEXT_MAX_LENGTH}
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); if (e.target.value.trim()) setReasonError(null); }}
                  aria-invalid={!!reasonError || undefined}
                  placeholder="Recorded with your decision"
                />
                {reasonError && <span className="field-error">{reasonError}</span>}
              </label>
              <div className="form-actions">
                <button className="btn btn-danger-outline" onClick={() => startDecision('Rejected')} disabled={!!busy || openClarifications.length > 0}><Icon name="x" />Reject</button>
                <button className="btn btn-primary" onClick={() => startDecision('Approved')} disabled={!!busy || openClarifications.length > 0}><Icon name="check" />Approve</button>
              </div>
            </div>
          )}
        </>
      )}

      {decision && (
        <ConfirmDialog
          title={decision === 'Approved' ? 'Approve this request?' : 'Reject this request?'}
          confirmLabel={decision === 'Approved' ? 'Approve' : 'Reject'}
          tone={decision === 'Approved' ? 'primary' : 'danger'}
          busy={busy === 'decision'}
          onCancel={() => setDecision(null)}
          onConfirm={() => void decide()}
        >
          <p>Your decision is recorded with your name and the current time. It can't be changed afterwards.</p>
          {reason.trim() && <p className="muted">{decision === 'Rejected' ? 'Reason' : 'Comment'}: {reason.trim()}</p>}
          {decision === 'Rejected' && <p className="muted">Rejecting doesn't reopen the request for editing, because the resubmission process hasn't been agreed yet.</p>}
        </ConfirmDialog>
      )}

      {target && state && (
        <ConfirmDialog
          title={target.followUp ? 'Ask a follow-up question' : 'Request clarification'}
          confirmLabel="Send to division"
          busy={busy === 'clarify'}
          onCancel={() => setTarget(null)}
          onConfirm={() => void askClarification()}
        >
          <dl className="kv">
            <dt>Request ID</dt><dd className="request-id">{state.key}</dd>
            <dt>Dataset</dt><dd>{datasetId(state.dataset)} · {state.dataset.name}</dd>
            <dt>Attribute</dt><dd>{target.attribute.name}{target.attribute.unit ? ` (${target.attribute.unit})` : ''}</dd>
            <dt>Division</dt><dd>{target.division.name}</dd>
            <dt>Submitted value</dt><dd>{target.row.myapp_attributevalue || 'Blank'} ({target.row.myapp_submissionstatus ?? 'Draft'})</dd>
          </dl>
          <label className="field spaced">
            <span className="field-label">Question <span className="req" aria-hidden="true">*</span></span>
            <textarea
              className={`input textarea${questionError ? ' input-invalid' : ''}`}
              rows={4}
              maxLength={TEXT_MAX_LENGTH}
              value={question}
              onChange={(e) => { setQuestion(e.target.value); if (e.target.value.trim()) setQuestionError(null); }}
              aria-required="true"
              aria-invalid={!!questionError || undefined}
              autoFocus
            />
            {questionError && <span className="field-error">{questionError}</span>}
          </label>
        </ConfirmDialog>
      )}
    </>
  );
}
