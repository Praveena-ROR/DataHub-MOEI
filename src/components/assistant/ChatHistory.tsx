import { Icon } from '../Icon.tsx';
import { formatDateTime } from '../format.ts';
import type { ConversationSummary } from '../../data/assistant.ts';

export type HistoryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: ConversationSummary[] };

/** The signed-in user's saved conversations, most recent first. */
export function ChatHistory({ state, activeRowId, disabled, onSelect, onRetry, onClose }: {
  state: HistoryState;
  activeRowId?: string;
  disabled?: boolean;
  onSelect: (item: ConversationSummary) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <section className="chat-history" aria-label="Chat history">
      <div className="chat-history-head">
        <span>Chat history</span>
        <button className="chat-icon-btn chat-history-close" onClick={onClose} aria-label="Hide chat history" title="Hide chat history">
          <Icon name="back" />
        </button>
      </div>
      {state.kind === 'loading' || state.kind === 'idle' ? (
        <div className="chat-history-note" role="status"><span className="spinner" aria-hidden="true" />Loading…</div>
      ) : state.kind === 'error' ? (
        <div className="chat-history-note chat-history-error" role="alert">
          {state.message}
          <button className="btn btn-outline btn-sm" onClick={onRetry}><Icon name="refresh" />Try again</button>
        </div>
      ) : state.items.length === 0 ? (
        <div className="chat-history-note">No saved conversations yet. Your conversations appear here after the assistant replies.</div>
      ) : (
        <ul className="chat-history-list">
          {state.items.map((item) => (
            <li key={item.rowId}>
              <button
                className={`chat-history-item${item.rowId === activeRowId ? ' active' : ''}`}
                onClick={() => onSelect(item)}
                disabled={disabled}
                aria-current={item.rowId === activeRowId ? 'true' : undefined}
              >
                <span className="chat-history-title">{item.title}</span>
                <span className="chat-history-time">{formatDateTime(item.lastActivity)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
