import { formatDateTime, personName } from './format.ts';
import { datasetId, isOpen, outstandingReasons } from '../data/workflow.ts';
import { Alert, StatusBadge } from './ui.tsx';
import type { RequestState } from '../data/types.ts';

/** `showReadiness` = show the "Not ready for DG Admin review" box (DG Admin only). */
export function RequestSummary({ state, viewerDivisionId, showReadiness = true }: { state: RequestState; viewerDivisionId?: string; showReadiness?: boolean }) {
  const openClarifications = state.clarifications.filter(isOpen).length;
  const reasons = outstandingReasons(state);
  return (
    <>
      <div className="panel summary">
        <div className="summary-item">
          <span className="field-label">Request ID</span>
          <span className="request-id">{state.key}</span>
        </div>
        <div className="summary-item">
          <span className="field-label">Dataset</span>
          <span>{datasetId(state.dataset)}</span>
        </div>
        <div className="summary-item">
          <span className="field-label">Created</span>
          <span>{formatDateTime(state.info.createdOn)}</span>
        </div>
        <div className="summary-item">
          <span className="field-label">Created by</span>
          <span>{personName(state.names, state.info.requestedBy)}{state.info.requestingDivision ? ` (${state.info.requestingDivision})` : ''}</span>
        </div>
        <div className="summary-item">
          <span className="field-label">Overall status</span>
          <StatusBadge status={state.overall} />
        </div>
        <div className="summary-item">
          <span className="field-label">Attributes</span>
          <span>{state.dataset.attributes.length}</span>
        </div>
        {state.clarifications.length > 0 && (
          <div className="summary-item">
            <span className="field-label">Clarifications</span>
            <span>{openClarifications} open of {state.clarifications.length}</span>
          </div>
        )}
        {state.review && (
          <div className="summary-item">
            <span className="field-label">DG Admin decision</span>
            <span>{state.review.status} by {personName(state.names, state.review.by)} · {formatDateTime(state.review.on)}</span>
          </div>
        )}
      </div>

      <div className="portions" aria-label="Division submission status">
        {state.portions.map((p) => (
          <div key={p.division.id} className={`portion${p.division.id === viewerDivisionId ? ' portion-own' : ''}`}>
            <div className="portion-head">
              <span>{p.division.name}{p.division.id === viewerDivisionId && ' (you)'}</span>
              <StatusBadge status={p.status} />
            </div>
            <div className="sub">
              {p.complete
                ? `Submitted ${formatDateTime(p.submittedOn)}${p.submittedBy ? ` by ${personName(state.names, p.submittedBy)}` : ''}`
                : p.status === 'Draft'
                  ? `${p.submittedCount} of ${p.total} values submitted · draft saved ${formatDateTime(p.lastUpdated)}`
                  : `Not started · ${p.total} value${p.total === 1 ? '' : 's'} to submit`}
            </div>
          </div>
        ))}
      </div>

      {showReadiness && !state.review && reasons.length > 0 && (
        <Alert tone="warning" title="Not ready for DG Admin review">
          The request goes to DG Admin only after every participating division has submitted all of its values.
          <ul className="issue-list">{reasons.map((i) => <li key={i}>{i}</li>)}</ul>
        </Alert>
      )}
      {state.review && state.issues.length > 0 && (
        <Alert tone="warning" title="Data notes">
          <ul className="issue-list">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </Alert>
      )}
      {state.warnings.length > 0 && (
        <Alert tone="info" title="Mapping notes">
          <ul className="issue-list">{state.warnings.map((i) => <li key={i}>{i}</li>)}</ul>
        </Alert>
      )}
    </>
  );
}
