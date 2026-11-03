import { useState } from 'react';
import { Icon } from './Icon.tsx';
import { formatDateTime, personName } from './format.ts';
import { StatusBadge } from './ui.tsx';
import { isOpen, TEXT_MAX_LENGTH } from '../data/workflow.ts';
import type { Clarification, RequestState } from '../data/types.ts';

/**
 * Clarification history for a request, newest first. DG Admin can resolve an
 * answered question or ask a follow-up (a new record, so the history is kept);
 * the responsible division answers pending ones (once — answers are kept).
 */
export function ClarificationThread({ state, mode, busyId, onResolve, onRespond, onFollowUp }: {
  state: RequestState;
  mode: 'admin' | 'division';
  busyId?: string | null;
  onResolve?: (c: Clarification) => void;
  onRespond?: (c: Clarification, response: string) => void;
  onFollowUp?: (c: Clarification) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const decided = !!state.review;
  const items = [...state.clarifications].reverse();

  if (items.length === 0) {
    return <p className="muted small">{mode === 'admin' ? 'No clarifications have been requested for this request.' : 'DG Admin has not asked your division for any clarifications.'}</p>;
  }

  return (
    <div className="thread">
      {items.map((c) => {
        const busy = busyId === c.id;
        const draft = drafts[c.id] ?? '';
        const sameValue = state.clarifications.filter((x) => x.mapId === c.mapId && x.divisionId === c.divisionId);
        const isFollowUp = sameValue.indexOf(c) > 0;
        const isLatest = sameValue.at(-1) === c;
        return (
          <article key={c.id} className={`thread-item${isOpen(c) ? ' open' : ''}`} aria-label={`Clarification on ${c.attributeName}`}>
            <div className="thread-head">
              <strong className="thread-title">{c.attributeName} · {c.divisionName}{isFollowUp && <span className="chip">Follow-up</span>}</strong>
              <StatusBadge status={c.status} />
            </div>
            <div className="thread-meta">
              Submitted value: {c.submittedValue || 'Blank'} · Asked by {personName(state.names, c.askedBy)} on {formatDateTime(c.askedOn)}
            </div>
            <div className="thread-text">{c.question}</div>

            {c.response && (
              <div className="thread-reply">
                <div className="thread-meta">Response from {personName(state.names, c.respondedBy)} on {formatDateTime(c.respondedOn)}</div>
                <div className="thread-text">{c.response}</div>
              </div>
            )}
            {c.status === 'Resolved' && (
              <div className="thread-meta spaced">Resolved by {personName(state.names, c.resolvedBy)} on {formatDateTime(c.resolvedOn)}</div>
            )}

            {mode === 'admin' && !decided && (c.status === 'Responded' || (isLatest && c.status === 'Resolved' && onFollowUp)) && (
              <div className="thread-actions">
                {onFollowUp && isLatest && (
                  <button className="btn btn-link btn-sm" disabled={busy} onClick={() => onFollowUp(c)}>
                    <Icon name="info" />Ask follow-up
                  </button>
                )}
                {c.status === 'Responded' && (
                  <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onResolve?.(c)}>
                    <Icon name="check" />{busy ? 'Saving…' : 'Mark resolved'}
                  </button>
                )}
              </div>
            )}

            {mode === 'division' && c.status === 'Pending Response' && !decided && (
              <div className="thread-reply">
                <label className="field">
                  <span className="field-label">Your response <span className="req" aria-hidden="true">*</span></span>
                  <textarea
                    className="input textarea"
                    rows={3}
                    maxLength={TEXT_MAX_LENGTH}
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    aria-required="true"
                    placeholder="Explain the value. Your submitted value stays as it is."
                  />
                </label>
                <div className="thread-actions">
                  <button className="btn btn-primary btn-sm" disabled={busy || !draft.trim()} onClick={() => onRespond?.(c, draft)}>
                    <Icon name="send" />{busy ? 'Sending…' : 'Send response'}
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
