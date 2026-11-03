import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.tsx';
import { AssistantAvatar } from './ChatMessage.tsx';
import { ChatHistory, type HistoryState } from './ChatHistory.tsx';
import { ChatWindow, type SendError } from './ChatWindow.tsx';
import { AssistantError, LIMIT_RETRY_DELAY_MS, type ChatMessage, type ConversationSummary } from '../../data/assistant.ts';
import { checkAssistantAccess, listConversations, openConversation, saveConversation, sendToAssistant } from '../../data/assistantServices.ts';

/** One chat in the panel. A new chat or an opened history item gets a new `key`. */
interface ChatSession {
  key: string;
  /** Copilot Studio conversation ID, from the first reply; sent with every later message. */
  conversationId?: string;
  messages: ChatMessage[];
  /** Save state shared by every snapshot of this chat: its row ID and the chain of pending saves. */
  store: { rowId?: string; queue: Promise<void> };
}

type Access = { kind: 'unchecked' } | { kind: 'checking' } | { kind: 'ok' } | { kind: 'denied' } | { kind: 'error'; message: string };

const newId = () => crypto.randomUUID();
const newSession = (): ChatSession => ({ key: newId(), messages: [], store: { queue: Promise.resolve() } });
const narrow = () => window.matchMedia('(max-width: 600px)').matches;

/** User-facing text for a failure; unexpected errors get `fallback` (details go to the dev console only). */
function messageOf(e: unknown, fallback: string) {
  if (e instanceof AssistantError) return e.message;
  if (import.meta.env.DEV) console.error('[assistant]', e);
  return fallback;
}

/**
 * Business Division Assistant: floating launcher and chat panel. Shown only to
 * business division users (App.tsx). The services re-verify the user from
 * tbl_MOEI_UserDetails before every agent call and history read or write.
 */
export function BusinessAdminAssistant() {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<Access>({ kind: 'unchecked' });
  const [chat, setChatState] = useState<ChatSession>(newSession);
  const chatRef = useRef(chat);
  const [sending, setSending] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyOpenRef = useRef(false);
  const [history, setHistory] = useState<HistoryState>({ kind: 'idle' });
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const setChat = (next: ChatSession) => {
    chatRef.current = next;
    setChatState(next);
  };

  // Return focus to the launcher when the panel closes.
  useEffect(() => {
    if (!open && wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const denyOn = (e: unknown) => { if (e instanceof AssistantError && e.kind === 'forbidden') setAccess({ kind: 'denied' }); };

  const verify = useCallback(async () => {
    setAccess({ kind: 'checking' });
    try {
      await checkAssistantAccess();
      setAccess({ kind: 'ok' });
    } catch (e) {
      setAccess(e instanceof AssistantError && e.kind === 'forbidden'
        ? { kind: 'denied' }
        : { kind: 'error', message: messageOf(e, 'Your access could not be checked. Try again.') });
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistory({ kind: 'loading' });
    try {
      setHistory({ kind: 'ready', items: await listConversations() });
    } catch (e) {
      denyOn(e);
      setHistory({ kind: 'error', message: messageOf(e, 'Your conversations could not be loaded.') });
    }
  }, []);

  const openPanel = () => {
    setOpen(true);
    if (access.kind === 'unchecked' || access.kind === 'error') void verify();
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    historyOpenRef.current = next;
    setHistoryOpen(next);
    if (next) void loadHistory();
  };

  /** Queue a save of this chat's messages; saves of one chat run in order. */
  const persist = (s: ChatSession) => {
    const { store, messages } = s;
    const conversationId = s.conversationId;
    if (!conversationId) return;
    store.queue = store.queue.then(async () => {
      const created = !store.rowId;
      try {
        store.rowId = await saveConversation({ rowId: store.rowId, conversationId, messages });
        if (chatRef.current.key === s.key) setNotice(null);
        if (created && historyOpenRef.current) void loadHistory();
      } catch (e) {
        denyOn(e);
        if (import.meta.env.DEV) console.error('[assistant] save failed', e);
        if (chatRef.current.key === s.key) setNotice('This conversation couldn’t be saved to your history. It stays here until you start a new chat.');
      }
    });
  };

  const send = async (text: string, base: ChatSession = chatRef.current) => {
    const question: ChatMessage = { id: newId(), role: 'user', text, at: new Date().toISOString() };
    setChat({ ...base, messages: [...base.messages, question] });
    setError(null);
    setSending(true);
    try {
      const reply = await sendToAssistant(text, base.conversationId);
      // Ignore a reply for a chat that is no longer open.
      if (chatRef.current.key !== base.key) return;
      const at = new Date().toISOString();
      const current = chatRef.current;
      const next: ChatSession = {
        ...current,
        conversationId: reply.conversationId ?? current.conversationId,
        messages: [...current.messages, ...reply.texts.map((t): ChatMessage => ({ id: newId(), role: 'assistant', text: t, at }))],
      };
      setChat(next);
      if (!next.conversationId) setNotice('The assistant didn’t return a conversation ID, so this conversation can’t be saved or continued.');
      else {
        if (!reply.completed) setNotice('The assistant may not have finished its reply.');
        persist(next);
      }
    } catch (e) {
      if (chatRef.current.key !== base.key) return;
      denyOn(e);
      const err = e instanceof AssistantError ? e : null;
      const kind = err?.kind ?? 'not-sent';
      // The question stays in the chat either way, marked by whether the agent received it.
      const current = chatRef.current;
      const next: ChatSession = {
        ...current,
        conversationId: err?.conversationId ?? current.conversationId,
        messages: current.messages.map((m): ChatMessage => (m.id === question.id ? { ...m, delivery: err?.delivered ? 'no-reply' : 'not-sent' } : m)),
      };
      setChat(next);
      // A received question is part of the agent's conversation, so it's saved like any turn.
      if (err?.delivered && next.conversationId) persist(next);
      setError({
        kind,
        message: messageOf(e, 'Your message wasn’t sent: the assistant could not be reached. Try again.'),
        failedId: question.id,
        canRetry: kind !== 'consent' && kind !== 'forbidden',
        ...(kind === 'limit' && { retryAt: Date.now() + LIMIT_RETRY_DELAY_MS }),
      });
    } finally {
      if (chatRef.current.key === base.key) setSending(false);
    }
  };

  const retry = () => {
    const current = chatRef.current;
    const failed = error && current.messages.find((m) => m.id === error.failedId);
    if (!failed) return;
    void send(failed.text, { ...current, messages: current.messages.filter((m) => m.id !== failed.id) });
  };

  const startNewChat = () => {
    setChat(newSession());
    setError(null);
    setNotice(null);
    setSending(false);
    setLoadingChat(false);
  };

  const openFromHistory = async (item: ConversationSummary) => {
    if (narrow()) { historyOpenRef.current = false; setHistoryOpen(false); }
    if (item.rowId === chatRef.current.store.rowId) return;
    const placeholder: ChatSession = { key: newId(), conversationId: item.conversationId, messages: [], store: { rowId: item.rowId, queue: Promise.resolve() } };
    setChat(placeholder);
    setError(null);
    setNotice(null);
    setLoadingChat(true);
    try {
      const conversation = await openConversation(item.rowId);
      if (chatRef.current.key !== placeholder.key) return;
      setChat({ ...placeholder, conversationId: conversation.conversationId, messages: conversation.messages });
      setLoadingChat(false);
    } catch (e) {
      if (chatRef.current.key !== placeholder.key) return;
      denyOn(e);
      startNewChat();
      setNotice(messageOf(e, 'This conversation couldn’t be opened.'));
    }
  };

  if (!open) {
    return (
      <button ref={launcherRef} className="assistant-launcher" onClick={openPanel} aria-label="Open Business Division Assistant" title="Business Division Assistant">
        <AssistantAvatar size={48} />
      </button>
    );
  }

  const ready = access.kind === 'ok';
  const busy = sending || loadingChat;
  return (
    <div
      className={`assistant-panel${ready && historyOpen ? ' with-history' : ''}`}
      role="dialog"
      aria-label="Business Division Assistant"
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
    >
      <header className="assistant-head">
        <AssistantAvatar size={36} />
        <div className="assistant-head-text">
          <h2 className="assistant-title">Business Division Assistant</h2>
          <div className="assistant-sub">AI assistant</div>
        </div>
        <div className="assistant-head-actions">
          <button
            className={`chat-icon-btn${historyOpen ? ' active' : ''}`}
            onClick={toggleHistory}
            disabled={!ready}
            aria-pressed={historyOpen}
            aria-label="Chat history"
            title="Chat history"
          >
            <Icon name="clock" size={18} />
          </button>
          <button className="btn btn-outline btn-sm" onClick={startNewChat} disabled={!ready || busy} title="Start a new conversation">
            <Icon name="plus" />New chat
          </button>
          <button className="chat-icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant" title="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
      </header>
      <div className="assistant-body">
        {access.kind === 'checking' || access.kind === 'unchecked' ? (
          <div className="chat-empty" role="status"><span className="spinner" aria-hidden="true" />Checking your access…</div>
        ) : access.kind === 'denied' ? (
          <div className="assistant-state">
            <div className="alert alert-error" role="alert">
              <Icon name="lock" size={18} />
              <div>
                <div className="alert-title">Access denied</div>
                The Business Division Assistant is available to business division users only.
              </div>
            </div>
          </div>
        ) : access.kind === 'error' ? (
          <div className="assistant-state">
            <div className="alert alert-error" role="alert">
              <Icon name="alert" size={18} />
              <div>
                {access.message}
                <div className="alert-actions"><button className="btn btn-outline btn-sm" onClick={() => void verify()}><Icon name="refresh" />Try again</button></div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {historyOpen && (
              <ChatHistory
                state={history}
                activeRowId={chat.store.rowId}
                disabled={busy}
                onSelect={(item) => void openFromHistory(item)}
                onRetry={() => void loadHistory()}
                onClose={toggleHistory}
              />
            )}
            <ChatWindow
              key={chat.key}
              messages={chat.messages}
              sending={sending}
              loading={loadingChat}
              error={error}
              notice={notice}
              onSend={(text) => void send(text)}
              onRetry={retry}
              onNewChat={startNewChat}
            />
          </>
        )}
      </div>
    </div>
  );
}
