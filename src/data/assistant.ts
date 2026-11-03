// Business Division Assistant: agent identifiers, types and the pure rules for
// reading connector responses and the stored message log. No I/O, so the rules
// can be unit tested (scripts/assistant.test.ts).

/**
 * Agent name for the Copilot Studio connector (`Copilot` path parameter):
 * bot.schemaname of "Business Division Assistant" in this environment.
 */
export const ASSISTANT_AGENT_NAME = 'Default_BusinessDivisionAssistant';
/** BotId recorded in ConversationTranscript.metadata for this agent; stored on every conversation row. */
export const ASSISTANT_BOT_ID = '1177b630-8b96-d3bc-ccdf-1d53e3120901';
/** Required by ExecuteCopilotAsyncV2 but not used when the call waits for the reply. */
export const NOTIFICATION_URL_PLACEHOLDER = 'https://notificationurlplaceholder';
/** Longest wait for one agent reply before the turn is reported as timed out. */
export const ASSISTANT_TIMEOUT_MS = 120_000;
/** After a usage-limit error, Retry stays disabled this long; nothing is retried automatically. */
export const LIMIT_RETRY_DELAY_MS = 60_000;
export const MAX_MESSAGE_LENGTH = 4000;
/** myapp_messages is a 1,048,576-character memo; the oldest messages are dropped beyond this. */
export const MAX_LOG_LENGTH = 1_000_000;

/** tbl_MOEI_AssistantConversation columns. Must match scripts/provision-assistant-conversation.mjs. */
export const ASSISTANT_COLUMNS = ['myapp_title', 'myapp_conversationid', 'myapp_botid', 'myapp_userupn', 'myapp_messages', 'myapp_lastactivityon'] as const;

export type ChatRole = 'user' | 'assistant';

/**
 * What happened to a user message (shown under it; not stored):
 * `not-sent` = the agent never received it; `no-reply` = the agent received it
 * but no reply came back.
 */
export type Delivery = 'sent' | 'not-sent' | 'no-reply';

export interface ChatMessage {
  /** Client-side key only. */
  id: string;
  role: ChatRole;
  text: string;
  /** ISO time the message was sent or received. */
  at: string;
  delivery?: Delivery;
}

/** One tbl_MOEI_AssistantConversation row as read by the app. */
export interface ConversationRow {
  myapp_tbl_moei_assistantconversationid: string;
  myapp_title?: string;
  myapp_conversationid?: string;
  myapp_botid?: string;
  myapp_userupn?: string;
  myapp_messages?: string;
  myapp_lastactivityon?: string;
  createdon?: string;
  _ownerid_value?: string;
}

/** A conversation as listed in Chat History. */
export interface ConversationSummary {
  /** Dataverse row ID. */
  rowId: string;
  conversationId: string;
  title: string;
  lastActivity: string;
}

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
}

/**
 * ExecuteCopilotAsyncV2 response. The generated service types it as void; the
 * fields are those documented for code apps, with the ID's casing varying.
 * `responses` items may be text, or JSON (a string or object) for cards.
 */
export interface AgentResponse {
  responses?: unknown;
  lastResponse?: unknown;
  completed?: unknown;
  conversationId?: unknown;
  ConversationId?: unknown;
  conversationID?: unknown;
}

export interface AgentReply {
  /** Agent messages for this turn, in order; never empty. */
  texts: string[];
  conversationId?: string;
  /** False when the agent reported it had not finished. */
  completed: boolean;
}

export type AssistantErrorKind =
  | 'forbidden'
  /** The agent didn't receive the message (connector or network failure). */
  | 'not-sent'
  /** The agent received the message but returned no text before the call ended. */
  | 'no-reply'
  /** The agent asked the user to sign in to a connection, which can't be done through the connector. */
  | 'consent'
  /** Copilot Studio / Power Platform usage limit (Copilot Credits, quota, throttling). */
  | 'limit'
  /** The agent replied with its error topic (e.g. a workflow failed). */
  | 'agent-error'
  /** No answer within ASSISTANT_TIMEOUT_MS; the message may have been received. */
  | 'timeout'
  | 'not-found'
  | 'failed';

export class AssistantError extends Error {
  readonly kind: AssistantErrorKind;
  /** Whether the agent received the message. */
  readonly delivered: boolean;
  /** Conversation ID returned with the failed turn, if any, so the chat can keep it. */
  readonly conversationId?: string;
  constructor(kind: AssistantErrorKind, message: string, options: { delivered?: boolean; conversationId?: string } = {}) {
    super(message);
    this.kind = kind;
    this.delivered = options.delivered ?? false;
    if (options.conversationId) this.conversationId = options.conversationId;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** A JSON string parsed, or the value itself when it isn't one. */
function maybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!/^[[{]/.test(t)) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/** Sign-in / "Connect to continue" cards Copilot Studio sends before running a flow with the user's connection. */
const CONSENT_PATTERN = /Connect to continue|application\/vnd\.microsoft\.card\.oauth|"OAuthCard"|"signin"/i;

interface ReplyPart { text?: string; card?: boolean; consent?: boolean }

/** One `responses` item: plain text, an activity-like object with text, or a card. */
function partOf(item: unknown): ReplyPart {
  const v = maybeJson(item);
  if (typeof v === 'string') return v.trim() ? { text: v.trim() } : {};
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const text = str(o.text);
  const attachments = Array.isArray(o.attachments) ? o.attachments : [];
  const card = o.type === 'AdaptiveCard' || attachments.length > 0 || typeof o.contentType === 'string';
  const consent = card && CONSENT_PATTERN.test(JSON.stringify(v));
  return { ...(text && { text }), ...(card && { card }), ...(consent && { consent }) };
}

/**
 * Agent messages and conversation ID from a connector response; empty `texts`
 * means no text reply. The SDK returns a string when the body isn't JSON, and
 * nothing when the connector answered without a body (201/202 while the agent
 * is still working, e.g. waiting for a sign-in card or a flow).
 */
export function parseAgentResponse(data: unknown): AgentReply & { cards: number; consent: boolean } {
  const parsed = maybeJson(data);
  if (typeof parsed === 'string') {
    return { texts: parsed.trim() ? [parsed.trim()] : [], completed: true, cards: 0, consent: false };
  }
  const r = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) as AgentResponse;
  let parts = Array.isArray(r.responses) ? r.responses.map(partOf) : [];
  if (!parts.some((p) => p.text) && r.lastResponse !== undefined) parts = [...parts, partOf(r.lastResponse)];
  const texts = parts.map((p) => p.text).filter((t): t is string => !!t);
  const conversationId = str(r.conversationId) ?? str(r.ConversationId) ?? str(r.conversationID);
  return {
    texts: [...new Set(texts)],
    ...(conversationId && { conversationId }),
    completed: r.completed !== false,
    cards: parts.filter((p) => p.card).length,
    consent: parts.some((p) => p.consent),
  };
}

/** Usage-limit wording from Copilot Studio, Power Automate and the connector gateway. */
const LIMIT_PATTERN = /Copilot Credits|PaymentRequired|usage limit|message capacity|quota (?:has been |was )?exceeded|exceeded (?:the |its |your )?(?:quota|rate limit|usage)|rate limit|too many requests|throttl/i;

/** Classify a failed connector call: 429/402 or limit wording is a usage limit; anything else means the message wasn't sent. */
export function classifyConnectorError(error: unknown): { kind: 'limit' | 'not-sent'; status?: number; detail: string } {
  const e = (error && typeof error === 'object' ? error : {}) as { status?: unknown; message?: unknown };
  const status = typeof e.status === 'number' ? e.status : undefined;
  const detail = typeof e.message === 'string' ? e.message : typeof error === 'string' ? error : '';
  const kind = status === 429 || status === 402 || LIMIT_PATTERN.test(detail) ? 'limit' : 'not-sent';
  return { kind, ...(status !== undefined && { status }), detail };
}

/**
 * A reply that is really the agent reporting a failure: its On Error topic
 * ("An error has occurred. Error code: …", or in test mode "Error Message: … Error Code: …").
 * Copilot Credits / limit wording makes it a usage limit.
 */
export function classifyReplyText(texts: string[]): { kind: 'limit' | 'agent-error'; code?: string } | null {
  const all = texts.join('\n');
  // The topic's own "Error code:" line, not "error code: …" inside a flow's error message.
  const code = /^Error code:\s*([A-Za-z0-9_-]+)/im.exec(all)?.[1];
  const errorTopic = /^(An error has occurred|Error Message:)/im.test(all) && !!code;
  if (LIMIT_PATTERN.test(all) && (errorTopic || /Copilot Credits|PaymentRequired/i.test(all))) return { kind: 'limit', ...(code && { code }) };
  return errorTopic ? { kind: 'agent-error', ...(code && { code }) } : null;
}

/** Title for Chat History: the first question, on one line, shortened. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line || 'New conversation';
}

/** Serialise messages for myapp_messages, dropping the oldest if the log would exceed the column. */
export function serializeLog(messages: ChatMessage[]): string {
  let kept = messages.map(({ role, text, at }) => ({ role, text, at }));
  let json = JSON.stringify(kept);
  while (json.length > MAX_LOG_LENGTH && kept.length > 1) {
    kept = kept.slice(1);
    json = JSON.stringify(kept);
  }
  return json;
}

/** Read myapp_messages; invalid entries are skipped and the result is in time order. */
export function parseLog(json: string | undefined): ChatMessage[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  raw.forEach((m, i) => {
    if (!m || typeof m !== 'object') return;
    const { role, text, at } = m as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || typeof at !== 'string') return;
    out.push({ id: `log-${i}`, role, text, at });
  });
  // Stable sort keeps the stored order for messages with the same time.
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * Whether a row belongs to this user and this agent. Dataverse privileges already
 * limit reads to the user's own rows; this repeats the check in the app.
 */
export function ownsRow(row: ConversationRow, upn: string, systemUserId?: string): boolean {
  if (row.myapp_botid !== ASSISTANT_BOT_ID || !row.myapp_conversationid) return false;
  if ((row.myapp_userupn ?? '').trim().toLowerCase() !== upn.trim().toLowerCase()) return false;
  return !systemUserId || !row._ownerid_value || row._ownerid_value.toLowerCase() === systemUserId.toLowerCase();
}

export function toSummary(row: ConversationRow): ConversationSummary {
  return {
    rowId: row.myapp_tbl_moei_assistantconversationid,
    conversationId: row.myapp_conversationid ?? '',
    title: row.myapp_title?.trim() || 'New conversation',
    lastActivity: row.myapp_lastactivityon ?? row.createdon ?? '',
  };
}

/** The user's conversations for this agent, most recent activity first. */
export function historyFrom(rows: ConversationRow[], upn: string, systemUserId?: string): ConversationSummary[] {
  return rows
    .filter((r) => ownsRow(r, upn, systemUserId))
    .map(toSummary)
    .sort((a, b) => (Date.parse(b.lastActivity) || 0) - (Date.parse(a.lastActivity) || 0));
}
