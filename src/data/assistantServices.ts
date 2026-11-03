// Business Division Assistant services: the Copilot Studio agent call and the
// user's saved conversations (tbl_MOEI_AssistantConversation). Every call first
// re-resolves the signed-in user from tbl_MOEI_UserDetails and requires a
// business division user; the session held in React state is never trusted.
//
// Chat history is read from tbl_MOEI_AssistantConversation, not from
// ConversationTranscript: transcripts are owned by the Copilot Studio system
// user, are written up to ~30 minutes after a session ends, and name the user
// only inside the content JSON, so they can't be limited to "own rows" by
// Dataverse. Conversation rows are User-owned and the users' security role has
// User-depth privileges on them, so Dataverse itself returns only their rows.
import { getContext } from '@microsoft/power-apps/app';
import { MicrosoftCopilotStudioService } from '../generated/services/MicrosoftCopilotStudioService';
import { createRecordReturningId, DataverseError, odataString, retrieveAll, retrieveRecord, Tables, updateRecord } from './dataverse.ts';
import { requireDivision } from './services.ts';
import {
  ASSISTANT_AGENT_NAME,
  ASSISTANT_BOT_ID,
  ASSISTANT_TIMEOUT_MS,
  AssistantError,
  classifyConnectorError,
  classifyReplyText,
  historyFrom,
  MAX_MESSAGE_LENGTH,
  NOTIFICATION_URL_PLACEHOLDER,
  ownsRow,
  parseAgentResponse,
  parseLog,
  serializeLog,
  titleFrom,
  toSummary,
  type AgentReply,
  type ChatMessage,
  type Conversation,
  type ConversationRow,
  type ConversationSummary,
} from './assistant.ts';

const ID = 'myapp_tbl_moei_assistantconversationid';
const LIST_COLUMNS = [ID, 'myapp_title', 'myapp_conversationid', 'myapp_botid', 'myapp_userupn', 'myapp_lastactivityon', 'createdon', '_ownerid_value'];
const ROW_COLUMNS = [...LIST_COLUMNS, 'myapp_messages'];

interface Caller {
  upn: string;
  systemUserId?: string;
}

/** The verified caller, who must be an active business division user. */
async function requireAssistantUser(): Promise<Caller> {
  let upn: string;
  try {
    upn = (await requireDivision('use the Business Division Assistant')).session.user.upn;
  } catch (e) {
    if (e instanceof DataverseError) throw new AssistantError('failed', 'Your access could not be checked. Check your connection and try again.');
    throw new AssistantError('forbidden', 'The Business Division Assistant is available to business division users only.');
  }
  const systemUserId = (await getContext()).user?.systemUserId?.trim() || undefined;
  return { upn, ...(systemUserId && { systemUserId }) };
}

/** Whether the signed-in user may use the assistant; checked when the panel opens. */
export async function checkAssistantAccess(): Promise<void> {
  await requireAssistantUser();
}

const TIMED_OUT = Symbol('timed out');

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const LIMIT_MESSAGE = 'The Business Division Assistant is temporarily unavailable because its usage limit has been reached. Your message is kept below; try again later.';

/**
 * Send one message to the Business Division Assistant and wait for its reply.
 * Pass the conversation ID from the previous reply to continue the same conversation.
 *
 * Failures are reported by kind and say whether the agent received the message:
 * not-sent (connector failure), limit (usage limit), no-reply / consent / agent-error
 * (received, but no usable reply), timeout. Nothing is retried automatically.
 */
export async function sendToAssistant(message: string, conversationId?: string): Promise<AgentReply> {
  const text = message.trim();
  if (!text) throw new AssistantError('failed', 'Type a message first.');
  if (text.length > MAX_MESSAGE_LENGTH) throw new AssistantError('failed', `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
  await requireAssistantUser();

  let result: Awaited<ReturnType<typeof MicrosoftCopilotStudioService.ExecuteCopilotAsyncV2>> | typeof TIMED_OUT;
  try {
    result = await withTimeout(
      MicrosoftCopilotStudioService.ExecuteCopilotAsyncV2(ASSISTANT_AGENT_NAME, { message: text, notificationUrl: NOTIFICATION_URL_PLACEHOLDER }, conversationId),
      ASSISTANT_TIMEOUT_MS,
    );
  } catch (e) {
    if (import.meta.env.DEV) console.error('[assistant] agent call threw', e);
    if (classifyConnectorError(e).kind === 'limit') throw new AssistantError('limit', LIMIT_MESSAGE);
    throw new AssistantError('not-sent', 'Your message wasn’t sent: the Copilot Studio connection could not be reached. Check your connection and try again.');
  }
  if (result === TIMED_OUT) {
    throw new AssistantError('timeout', 'No reply after 2 minutes. Your message may have reached the assistant; try again in a moment.', { delivered: true });
  }
  if (!result.success) {
    if (import.meta.env.DEV) console.error('[assistant] agent call failed', result.error);
    const failure = classifyConnectorError(result.error);
    if (failure.kind === 'limit') throw new AssistantError('limit', LIMIT_MESSAGE);
    const status = failure.status ? ` (HTTP ${failure.status})` : '';
    throw new AssistantError('not-sent', `Your message wasn’t sent: the Copilot Studio connector returned an error${status}. Try again.`);
  }

  // The generated service types the response as void; the payload is the documented agent response.
  if (import.meta.env.DEV) console.info('[assistant] agent response', result.data);
  const reply = parseAgentResponse(result.data as unknown);
  const convId = reply.conversationId ?? conversationId;
  const received = { delivered: true, ...(convId && { conversationId: convId }) };
  if (reply.texts.length === 0) {
    if (reply.consent) {
      throw new AssistantError('consent', 'Your message reached the assistant, but it asked you to sign in to a connection (Microsoft Dataverse) before answering. That sign-in can’t be completed in this app; ask your administrator to set the agent’s workflow to use the agent author’s connection.', received);
    }
    throw new AssistantError('no-reply', reply.cards
      ? 'Your message reached the assistant, but it replied with content this app can’t show. Try rephrasing your question.'
      : 'Your message reached the assistant, but no reply came back. Questions that run a workflow (such as request status) may not have finished. Try again.', received);
  }
  const failure = classifyReplyText(reply.texts);
  if (failure?.kind === 'limit') throw new AssistantError('limit', LIMIT_MESSAGE, received);
  if (failure) {
    throw new AssistantError('agent-error', `Your message reached the assistant, but it couldn’t complete the request${failure.code ? ` (error ${failure.code})` : ''}. Try again later.`, received);
  }
  return { texts: reply.texts, completed: reply.completed, ...(convId && { conversationId: convId }) };
}

/** Clear errors for history storage that isn't set up or isn't permitted; other errors pass through. */
function historyError(e: unknown): unknown {
  const detail = e instanceof Error ? e.message : String(e);
  if (import.meta.env.DEV) console.error('[assistant] history', e);
  if (/Unable to find data source|DataSourceNotFound|data source info/i.test(detail)) {
    return new AssistantError('failed', 'Chat history isn’t set up in this app yet (the tbl_MOEI_AssistantConversation data source is missing). Ask your administrator.');
  }
  if (/privilege|0x80040220|prv(Read|Create|Write)|\b403\b/i.test(detail)) {
    return new AssistantError('failed', 'You don’t have permission to use chat history. Ask your administrator to give your security role access to tbl_MOEI_AssistantConversation.');
  }
  return e;
}

/** Run a history operation, translating setup and permission failures. */
async function history<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    throw e instanceof AssistantError ? e : historyError(e);
  }
}

/** Rows for this agent and user. Dataverse limits the result to rows the caller owns. */
async function readOwnRows(caller: Caller, extraFilter?: string): Promise<ConversationRow[]> {
  const filters = [`myapp_botid eq ${odataString(ASSISTANT_BOT_ID)}`, `myapp_userupn eq ${odataString(caller.upn)}`];
  if (caller.systemUserId) filters.push(`_ownerid_value eq ${caller.systemUserId}`);
  if (extraFilter) filters.push(extraFilter);
  return retrieveAll<ConversationRow>(Tables.assistant, { select: LIST_COLUMNS, filter: filters.join(' and ') });
}

/** The signed-in user's saved conversations, most recent activity first. */
export async function listConversations(): Promise<ConversationSummary[]> {
  const caller = await requireAssistantUser();
  return history(async () => historyFrom(await readOwnRows(caller), caller.upn, caller.systemUserId));
}

/** One of the user's conversations with its messages in time order. */
export async function openConversation(rowId: string): Promise<Conversation> {
  const caller = await requireAssistantUser();
  let row: ConversationRow;
  try {
    row = await retrieveRecord<ConversationRow>(Tables.assistant, rowId, ROW_COLUMNS);
  } catch (e) {
    const mapped = historyError(e);
    if (mapped instanceof AssistantError) throw mapped;
    // Missing, or not visible to this user: reported the same way.
    throw new AssistantError('not-found', 'This conversation isn’t available.');
  }
  if (!ownsRow(row, caller.upn, caller.systemUserId)) throw new AssistantError('not-found', 'This conversation isn’t available.');
  return { ...toSummary(row), messages: parseLog(row.myapp_messages) };
}

/**
 * Save the conversation's messages. Creates the row on the first reply and
 * updates it afterwards; returns the row ID. Only rows the caller owns are updated.
 */
export async function saveConversation(input: { rowId?: string; conversationId: string; messages: ChatMessage[] }): Promise<string> {
  const caller = await requireAssistantUser();
  return history(() => writeConversation(caller, input));
}

async function writeConversation(caller: Caller, input: { rowId?: string; conversationId: string; messages: ChatMessage[] }): Promise<string> {
  const last = input.messages[input.messages.length - 1];
  const changes = { myapp_messages: serializeLog(input.messages), myapp_lastactivityon: last?.at ?? new Date().toISOString() };
  let rowId = input.rowId;
  if (!rowId) {
    // The row may exist already, e.g. an earlier save succeeded but its response was lost.
    rowId = (await readOwnRows(caller, `myapp_conversationid eq ${odataString(input.conversationId)}`))
      .find((r) => ownsRow(r, caller.upn, caller.systemUserId))?.[ID];
  }
  if (rowId) {
    await updateRecord(Tables.assistant, rowId, changes);
    return rowId;
  }
  const firstQuestion = input.messages.find((m) => m.role === 'user')?.text ?? '';
  return createRecordReturningId(Tables.assistant, {
    ...changes,
    myapp_title: titleFrom(firstQuestion),
    myapp_conversationid: input.conversationId,
    myapp_botid: ASSISTANT_BOT_ID,
    myapp_userupn: caller.upn,
  }, ID);
}
