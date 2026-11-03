// Unit tests for the Business Division Assistant rules (src/data/assistant.ts):
// reading connector responses, the stored message log and per-user history.
// Fixtures are test-only and are never used by the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_BOT_ID, classifyConnectorError, classifyReplyText, historyFrom, MAX_LOG_LENGTH, ownsRow, parseAgentResponse, parseLog, serializeLog, titleFrom,
  type ChatMessage, type ConversationRow,
} from '../src/data/assistant.ts';

const msg = (role: ChatMessage['role'], text: string, at: string): ChatMessage => ({ id: `${role}-${at}`, role, text, at });
let n = 0;
const row = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  myapp_tbl_moei_assistantconversationid: `row${++n}`,
  myapp_conversationid: `conv${n}`,
  myapp_botid: ASSISTANT_BOT_ID,
  myapp_userupn: 'Gen@x.com',
  myapp_title: `Question ${n}`,
  myapp_lastactivityon: '2026-10-28T08:00:00Z',
  _ownerid_value: 'OWNER-A',
  ...over,
});

test('agent response: every reply in order, conversation ID in any casing', () => {
  assert.deepEqual(parseAgentResponse({ responses: ['One', ' ', 'Two'], lastResponse: 'Two', conversationId: 'c1', completed: true }),
    { texts: ['One', 'Two'], conversationId: 'c1', completed: true, cards: 0, consent: false });
  assert.equal(parseAgentResponse({ lastResponse: 'Only', ConversationId: 'c2' }).conversationId, 'c2');
  assert.deepEqual(parseAgentResponse({ lastResponse: 'Only', conversationID: 'c3' }).texts, ['Only']);
  assert.equal(parseAgentResponse({ responses: ['x'], completed: false }).completed, false);
});

test('agent response: empty, missing or malformed payloads give no reply', () => {
  // undefined is what the SDK returns for a 201/202 with no body: the agent is still working.
  for (const data of [undefined, null, '', '  ', 42, {}, { responses: [] }, { responses: ['  '], lastResponse: '' }, { responses: [{ a: 1 }] }]) {
    assert.deepEqual(parseAgentResponse(data).texts, [], JSON.stringify(data));
  }
});

test('agent response: a non-JSON body (returned by the SDK as a string) is the reply; a JSON string is parsed', () => {
  assert.deepEqual(parseAgentResponse('Plain reply').texts, ['Plain reply']);
  const parsed = parseAgentResponse(JSON.stringify({ responses: ['From JSON'], conversationId: 'c9' }));
  assert.deepEqual([parsed.texts, parsed.conversationId], [['From JSON'], 'c9']);
  assert.deepEqual(parseAgentResponse({ responses: [{ type: 'message', text: 'Activity text' }] }).texts, ['Activity text']);
});

// The card Copilot Studio sent before running GetRequestDetails with the user's connection
// (conversation 77b7d919…, 27 Oct 2026), trimmed.
const CONSENT_CARD = {
  type: 'message', text: '',
  attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.3', body: [
    { type: 'TextBlock', text: 'Connect to continue' },
    { type: 'TextBlock', text: "I'll use your credentials to connect and to get the information you're looking for." },
  ] } }],
};

test('agent response: a "Connect to continue" card is a consent request, not a reply', () => {
  for (const responses of [[CONSENT_CARD], [JSON.stringify(CONSENT_CARD)], [CONSENT_CARD.attachments[0].content]]) {
    const r = parseAgentResponse({ responses, conversationId: 'c1', completed: false });
    assert.deepEqual([r.texts, r.consent, r.cards, r.conversationId], [[], true, 1, 'c1']);
  }
  const otherCard = parseAgentResponse({ responses: [{ type: 'AdaptiveCard', body: [{ type: 'TextBlock', text: 'Pick one' }] }] });
  assert.deepEqual([otherCard.texts, otherCard.consent, otherCard.cards], [[], false, 1]);
});

test('connector errors: 429/402 and limit wording are usage limits; anything else was not sent', () => {
  assert.equal(classifyConnectorError({ status: 429, message: 'Too Many Requests' }).kind, 'limit');
  assert.equal(classifyConnectorError({ status: 402, message: '' }).kind, 'limit');
  assert.equal(classifyConnectorError(new Error('The environment does not have sufficient Copilot Credits to run workflows.')).kind, 'limit');
  assert.equal(classifyConnectorError({ message: 'Rate limit is exceeded. Try again in 30 seconds.' }).kind, 'limit');
  assert.deepEqual(classifyConnectorError({ status: 502, message: 'Bad Gateway' }), { kind: 'not-sent', status: 502, detail: 'Bad Gateway' });
  assert.equal(classifyConnectorError(new Error('Failed to fetch')).kind, 'not-sent');
  assert.equal(classifyConnectorError(undefined).kind, 'not-sent');
});

test('replies from the agent error topic: Copilot Credits is a usage limit, other errors are agent errors', () => {
  // Test-mode On Error reply recorded in conversation 77b7d919….
  const credits = "Error Message: The flow 'GetRequestDetails' ('fb394aeb-3fd2-75f4-07ac-e8b101ac3bf5') failed to run with response code 'PaymentRequired', error code: NotSpecified. Error details: The environment '8df9dcac-cbda-e603-9ebc-d833fe1b181a' does not have sufficient Copilot Credits to run workflows.\nError Code: FlowRequestFailure\nConversation Id: 77b7d919\nTime (UTC): 2026-10-27T06:41:11.837Z";
  assert.deepEqual(classifyReplyText([credits]), { kind: 'limit', code: 'FlowRequestFailure' });
  // Published On Error reply (no details).
  const published = 'An error has occurred.\nError code: FlowRequestFailure\nConversation Id: abc\nTime (UTC): 2026-10-28T10:00:00Z.';
  assert.deepEqual(classifyReplyText([published]), { kind: 'agent-error', code: 'FlowRequestFailure' });
  // Ordinary answers, including ones that mention capacity or errors, are not failures.
  assert.equal(classifyReplyText(['Here are the details for your request:\n- **Submission Status:** Submitted']), null);
  assert.equal(classifyReplyText(['Installed Capacity is a Generation dataset. An error has occurred only if values are missing.']), null);
});

test('message log round-trips in time order and skips invalid entries', () => {
  const log = serializeLog([msg('user', 'Hi', '2026-10-28T08:00:00Z'), msg('assistant', 'Hello', '2026-10-28T08:00:05Z')]);
  assert.ok(!log.includes('"id"'), 'client keys are not stored');
  const back = parseLog(log);
  assert.deepEqual(back.map((m) => [m.role, m.text]), [['user', 'Hi'], ['assistant', 'Hello']]);

  const mixed = JSON.stringify([
    { role: 'assistant', text: 'second', at: '2026-10-28T08:00:05Z' },
    { role: 'system', text: 'no', at: '2026-10-28T08:00:00Z' },
    { role: 'user', text: 'first', at: '2026-10-28T08:00:00Z' },
    { role: 'user', text: 5, at: '2026-10-28T08:00:00Z' },
    null,
  ]);
  assert.deepEqual(parseLog(mixed).map((m) => m.text), ['first', 'second']);
  assert.deepEqual(parseLog('not json'), []);
  assert.deepEqual(parseLog('{"a":1}'), []);
  assert.deepEqual(parseLog(undefined), []);
});

test('message log drops the oldest messages to fit the column', () => {
  const big = 'x'.repeat(400_000);
  const messages = [0, 1, 2, 3].map((i) => msg('user', big, `2026-10-28T08:00:0${i}Z`));
  const log = serializeLog(messages);
  assert.ok(log.length <= MAX_LOG_LENGTH);
  assert.equal(parseLog(log).length, 2);
  assert.equal(parseLog(log)[1].at, '2026-10-28T08:00:03Z');
});

test('title is the first question on one line, shortened', () => {
  assert.equal(titleFrom('  What is\n the status? '), 'What is the status?');
  assert.equal(titleFrom('a'.repeat(100)).length, 78);
  assert.equal(titleFrom('   '), 'New conversation');
});

test('a row belongs to the user only for this agent, their address and their owner ID', () => {
  assert.ok(ownsRow(row(), 'gen@X.com', 'owner-a'));
  assert.ok(ownsRow(row(), 'gen@x.com'));
  assert.ok(!ownsRow(row(), 'bde@x.com', 'OWNER-A'), 'another user');
  assert.ok(!ownsRow(row(), 'gen@x.com', 'OWNER-B'), 'owned by someone else');
  assert.ok(!ownsRow(row({ myapp_botid: 'other-bot' }), 'gen@x.com', 'OWNER-A'), 'another agent');
  assert.ok(!ownsRow(row({ myapp_conversationid: '' }), 'gen@x.com', 'OWNER-A'), 'no conversation');
});

test('history lists only the user’s conversations, most recent first', () => {
  const rows = [
    row({ myapp_title: 'old', myapp_lastactivityon: '2026-10-01T00:00:00Z' }),
    row({ myapp_title: 'other user', myapp_userupn: 'bde@x.com', myapp_lastactivityon: '2026-10-30T00:00:00Z' }),
    row({ myapp_title: 'new', myapp_lastactivityon: '2026-10-28T00:00:00Z' }),
    row({ myapp_title: 'other bot', myapp_botid: 'x', myapp_lastactivityon: '2026-10-29T00:00:00Z' }),
    row({ myapp_title: '', myapp_lastactivityon: undefined, createdon: '2026-10-15T00:00:00Z' }),
  ];
  assert.deepEqual(historyFrom(rows, 'gen@x.com', 'OWNER-A').map((h) => h.title), ['new', 'New conversation', 'old']);
});
