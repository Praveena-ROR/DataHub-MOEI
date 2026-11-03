import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../Icon.tsx';
import { AssistantAvatar, ChatMessage } from './ChatMessage.tsx';
import { MAX_MESSAGE_LENGTH, type AssistantErrorKind, type ChatMessage as Message } from '../../data/assistant.ts';

export interface SendError {
  kind: AssistantErrorKind;
  message: string;
  /** The user message that wasn't answered; Retry sends it again. */
  failedId: string;
  /** Retry is offered only when sending again can help. */
  canRetry: boolean;
  /** Retry stays disabled until this time (ms), after a usage-limit error. */
  retryAt?: number;
}

const ERROR_TITLES: Partial<Record<AssistantErrorKind, string>> = {
  limit: 'Assistant temporarily unavailable',
  'not-sent': 'Message not sent',
  'no-reply': 'No reply received',
  timeout: 'No reply received',
  consent: 'Connection sign-in needed',
  'agent-error': 'The assistant couldn’t complete this request',
  forbidden: 'Access denied',
};

/** Seconds left until `until` (ms), refreshed every second; 0 when passed or unset. */
function useSecondsUntil(until?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** Messages of the open conversation and the message box. */
export function ChatWindow({ messages, sending, loading, error, notice, onSend, onRetry, onNewChat }: {
  messages: Message[];
  sending: boolean;
  /** A saved conversation is being opened. */
  loading: boolean;
  error: SendError | null;
  /** Non-blocking note, e.g. history couldn't be saved. */
  notice: string | null;
  onSend: (text: string) => void;
  onRetry: () => void;
  onNewChat: () => void;
}) {
  const [draft, setDraft] = useState('');
  const retryIn = useSecondsUntil(error?.retryAt);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, error]);

  // Grow the box with its text, up to the CSS max-height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => { if (!loading) inputRef.current?.focus(); }, [loading]);

  const text = draft.trim();
  const canSend = !!text && !sending && !loading && text.length <= MAX_MESSAGE_LENGTH;
  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter (and Enter while composing IME text) adds a line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="chat-window" aria-label="Conversation">
      <div className="chat-messages" ref={listRef} aria-live="polite" aria-busy={sending || loading}>
        {loading ? (
          <div className="chat-empty" role="status"><span className="spinner" aria-hidden="true" />Opening conversation…</div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <AssistantAvatar size={72} />
            <div className="chat-empty-title">Business Division Assistant</div>
            <p className="muted">Ask a question to start a new conversation.</p>
          </div>
        ) : (
          messages.map((m) => <ChatMessage key={m.id} message={m} />)
        )}
        {sending && (
          <div className="chat-msg chat-msg-assistant" role="status">
            <AssistantAvatar size={28} />
            <div className="chat-bubble chat-typing" aria-label="The assistant is replying">
              <span /><span /><span />
            </div>
          </div>
        )}
        {error && (
          <div className={`alert ${error.kind === 'limit' ? 'alert-warning' : 'alert-error'} chat-alert`} role="alert">
            <Icon name={error.kind === 'limit' ? 'clock' : 'alert'} size={18} />
            <div>
              {ERROR_TITLES[error.kind] && <div className="alert-title">{ERROR_TITLES[error.kind]}</div>}
              {error.message}
              <div className="alert-actions chat-alert-actions">
                {error.canRetry && (
                  <button className="btn btn-outline btn-sm" onClick={onRetry} disabled={sending || retryIn > 0}>
                    <Icon name="refresh" />{retryIn > 0 ? `Retry in ${retryIn}s` : 'Retry'}
                  </button>
                )}
                <button className="btn btn-link btn-sm" onClick={onNewChat}>Start a new chat</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {notice && <div className="chat-notice" role="status"><Icon name="info" size={14} />{notice}</div>}
      <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor="assistant-input" className="visually-hidden">Message the Business Division Assistant</label>
        <textarea
          id="assistant-input"
          ref={inputRef}
          className="input textarea chat-input"
          rows={1}
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Type your message…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
        />
        <button type="submit" className="btn btn-primary chat-send" disabled={!canSend} aria-label="Send message" title="Send (Enter)">
          <Icon name="send" />
        </button>
      </form>
      <div className="chat-hint">Enter to send · Shift+Enter for a new line · Replies are AI-generated; check important details.</div>
    </section>
  );
}
