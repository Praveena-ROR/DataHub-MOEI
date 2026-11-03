// Runs the real write operations (src/data/operations.ts) against an in-memory store.
// Fixtures are test-only and never used by the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequest,
  writeClarificationRequest,
  writeClarificationResolve,
  writeClarificationResponse,
  writeComment,
  writeDecision,
  writeDivisionPortion,
  type NewValueRow,
  type RequestStore,
} from '../src/data/operations.ts';
import {
  approvedDatasets, buildDatasets, datasetForDivision, deriveRequestState, divisionsFromUsers, isRequestRow, requestableAttributes, requestForDivision, requestInfoFromRow, requestsFromRows, RequestRows, rowDivisionId, WorkflowError,
} from '../src/data/workflow.ts';
import type { Dataset, MapRow, RequestRef, RequestState, ReviewEntryRow, UserRow, ValueRow } from '../src/data/types.ts';

const USERS: UserRow[] = ['Generation', 'BD&E', 'TP'].map((d, i) => ({
  myapp_tbl_moei_userdetailsid: `u${i}`, myapp_usermailid: `${i}@x`, myapp_userdesignation: d, myapp_userrole: 'BusinessDivision', statecode: 0,
}));
const DIVS = divisionsFromUsers(USERS);
const map = (id: string, attr: string, division: string): MapRow => ({
  myapp_tbl_moei_datasetandbusinessmapid: id, myapp_datasetnumber: 2, myapp_datasetname: 'Electricity Generation',
  myapp_attributename: attr, myapp_businessdivision: division, statecode: 0,
});
const DATASET = buildDatasets([
  map('steam', 'Steam Turbines', 'Generation'),
  map('gas', 'Natural Gas', 'Generation / BD&E'),
  map('solar', 'Solar PV', 'BD&E'),
], DIVS)[0];
const GEN = DATASET.divisions.find((d) => d.name === 'Generation')!;
const BDE = DATASET.divisions.find((d) => d.name === 'BD&E')!;

const KEY = 'REQ_0001';
/** The request row every test works on (seeded by memoryStore): dataset 2, no stored selection, so every attribute. */
const REQ_ROW: ValueRow = {
  myapp_tbl_moei_requestid: 'r1', myapp_requestid: KEY, myapp_datasetid: '2', myapp_attributemapid: RequestRows.marker, myapp_divisionname: RequestRows.marker,
  myapp_submittedby: 'gen@x', myapp_submittedon: '2026-10-15T09:00:00Z', myapp_reviewstatus: 'In Progress',
};
const REQ: RequestRef = { info: requestInfoFromRow(REQ_ROW), dataset: DATASET };

/** A request row for `dataset` raised by `division`, covering `selected` (test fixture). */
const requestRow = (key: string, dataset: Dataset, selected: string[], division: string, createdOn: string): ValueRow => ({
  myapp_tbl_moei_requestid: `r-${key}`, myapp_requestid: key, myapp_datasetid: dataset.key, myapp_attributemapid: RequestRows.marker, myapp_divisionname: RequestRows.marker,
  myapp_divisionid: division, myapp_reviewcomments: selected.join(','), myapp_reviewstatus: 'In Progress', myapp_submittedon: createdOn,
});

/**
 * In-memory stand-in for tbl_MOEI_requests and tbl_MOEI_DGAdminApproval.
 * Request rows are kept apart from value rows (`requestRows` / `rows`) so tests
 * can look at each, but every read and the alternate keys cover both, as in
 * Dataverse: value per request/attribute/division (which also allows one request
 * row per Request ID) and review entry ID. Bumps modifiedon on every write and
 * reports key violations the way the app's store does.
 */
function memoryStore({ seed = true } = {}) {
  const rows: ValueRow[] = [];
  const requestRows: ValueRow[] = seed ? [{ ...REQ_ROW }] : [];
  const entries: ReviewEntryRow[] = [];
  let tick = 0;
  const stamp = () => `2026-10-15T10:${String(Math.floor(++tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}Z`;
  const duplicate = () => new WorkflowError('conflict', 'duplicate key');
  const all = () => [...requestRows, ...rows];
  const store: RequestStore & { rows: ValueRow[]; requestRows: ValueRow[]; entries: ReviewEntryRow[]; failRequestUpdates?: boolean } = {
    rows,
    requestRows,
    entries,
    loadValueRows: async (key) => all().filter((r) => r.myapp_requestid === key).map((r) => ({ ...r })),
    loadDatasetRows: async (datasetKey) => all().filter((r) => r.myapp_datasetid === datasetKey).map((r) => ({ ...r })),
    loadUsedRequestKeys: async () => [...all().map((r) => r.myapp_requestid ?? ''), ...entries.map((e) => e.myapp_requestkey ?? '')],
    create: async (row: NewValueRow) => {
      if (all().some((r) => r.myapp_requestid === row.myapp_requestid && r.myapp_attributemapid === row.myapp_attributemapid && r.myapp_divisionname === row.myapp_divisionname)) throw duplicate();
      const at = stamp();
      (isRequestRow(row) ? requestRows : rows).push({ ...row, myapp_tbl_moei_requestid: `id${all().length + 1}`, createdon: at, modifiedon: at } as ValueRow);
    },
    update: async (id, changes) => {
      const r = all().find((x) => x.myapp_tbl_moei_requestid === id)!;
      if (isRequestRow(r) && store.failRequestUpdates) throw new Error('network');
      Object.assign(r, changes, { modifiedon: stamp() });
    },
    loadEntries: async (key) => entries.filter((e) => e.myapp_requestkey === key).map((e) => ({ ...e })),
    createEntry: async (row) => {
      if (entries.some((e) => e.myapp_approvalid === row.myapp_approvalid)) throw duplicate();
      const at = stamp();
      entries.push({ ...row, myapp_tbl_moei_dgadminapprovalid: `e${entries.length + 1}`, createdon: at, modifiedon: at } as ReviewEntryRow);
    },
    updateEntry: async (id, changes) => {
      const e = entries.find((x) => x.myapp_tbl_moei_dgadminapprovalid === id)!;
      Object.assign(e, changes, { modifiedon: stamp() });
    },
  };
  return store;
}
type Store = ReturnType<typeof memoryStore>;
/** The request as the app reads it back from the store. */
const refOf = async (store: Store, key: string, dataset = DATASET): Promise<RequestRef> =>
  ({ info: requestsFromRows(await store.loadValueRows(key), [dataset]).find((r) => r.key === key)!, dataset });
const versions = (s: RequestState) => Object.fromEntries(s.rows.map((r) => [r.myapp_tbl_moei_requestid, r.modifiedon]));
const valueOf = (s: RequestState, mapId: string, divId: string) =>
  s.rows.find((r) => r.myapp_attributemapid === mapId && rowDivisionId(r) === divId)?.myapp_attributevalue;

test('save draft persists only the caller division values and can be resumed', async () => {
  const store = memoryStore();
  let s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1200', gas: '' }, {}, 'draft');
  assert.equal(store.rows.length, 1, 'blank draft values do not create rows');
  assert.equal(valueOf(s, 'steam', 'generation'), '1200');
  assert.equal(s.portions.find((p) => p.division.id === 'generation')!.status, 'Draft');
  // Reopen later and edit the same draft.
  s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1250', gas: '100' }, versions(s), 'draft');
  assert.equal(valueOf(s, 'steam', 'generation'), '1250');
  assert.equal(store.rows.length, 2, 'existing row updated, no duplicate');
  assert.ok(store.rows.every((r) => r.myapp_submissionstatus === 'Draft' && !r.myapp_submittedby));
});

test('shared attribute keeps separate values for Generation (100) and BD&E (200)', async () => {
  const store = memoryStore();
  const g = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { gas: '100' }, {}, 'draft');
  const b = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '200' }, versions(g), 'draft');
  assert.equal(valueOf(b, 'gas', 'generation'), '100');
  assert.equal(valueOf(b, 'gas', 'bd&e'), '200');
  await assert.rejects(writeDivisionPortion(store, REQ, GEN, 'gen@x', { solar: '9' }, versions(b), 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
});

test('submit refuses blank required values and writes nothing', async () => {
  const store = memoryStore();
  const s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1200' }, {}, 'draft');
  const before = JSON.stringify(store.rows);
  await assert.rejects(
    writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1200', gas: '' }, versions(s), 'submit'),
    (e: WorkflowError) => e.kind === 'validation' && /Natural Gas/.test(e.message),
  );
  assert.equal(JSON.stringify(store.rows), before, 'no partial write on a refused submit');
  assert.equal(deriveRequestState(REQ, store.rows).portions.find((p) => p.division.id === 'generation')!.status, 'Draft');
});

test('submit persists every owned attribute, stamps submitter, locks; gate waits for all divisions', async () => {
  const store = memoryStore();
  let s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1200' }, {}, 'draft');
  s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1300', gas: '100' }, versions(s), 'submit', () => '2026-10-15T12:00:00Z');
  const genRows = s.rows.filter((r) => rowDivisionId(r) === 'generation');
  assert.equal(genRows.length, 2, 'Natural Gas row created on submit');
  assert.ok(genRows.every((r) => r.myapp_submissionstatus === 'Submitted' && r.myapp_submittedby === 'gen@x' && r.myapp_submittedon === '2026-10-15T12:00:00Z'));
  assert.equal(valueOf(s, 'steam', 'generation'), '1300');
  assert.equal(s.overall, 'In Progress', 'BD&E has not submitted');

  await assert.rejects(writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'locked');
  await assert.rejects(writeDivisionPortion(store, REQ, GEN, 'gen@x', {}, versions(s), 'submit'), (e: WorkflowError) => e.kind === 'locked');

  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '200' }, versions(s), 'draft');
  assert.equal(s.overall, 'In Progress', 'a BD&E draft does not count');
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { solar: '30' }, versions(s), 'submit');
  assert.equal(s.overall, 'Pending DG Admin Review');
  assert.equal(valueOf(s, 'gas', 'generation'), '100', 'Generation value untouched by BD&E');
  assert.equal(valueOf(s, 'gas', 'bd&e'), '200');
});

test('unrelated division (TP) cannot write and is not part of the gate', async () => {
  const store = memoryStore();
  await assert.rejects(writeDivisionPortion(store, REQ, { id: 'tp', name: 'TP' }, 'tp@x', { steam: '1' }, {}, 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
  assert.equal(DATASET.divisions.some((d) => d.id === 'tp'), false);
});

test('concurrent edit from another session is rejected and newer data kept', async () => {
  const store = memoryStore();
  const first = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1' }, {}, 'draft');
  const stale = versions(first);
  await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '2' }, stale, 'draft');
  await assert.rejects(writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '3' }, stale, 'draft'), (e: WorkflowError) => e.kind === 'conflict');
  assert.equal(store.rows[0].myapp_attributevalue, '2');
});

test('invalid division mapping blocks the gate even when all known divisions submit', async () => {
  const bad = buildDatasets([map('x', 'X', 'Generation / Gneration')], DIVS)[0];
  const s = await writeDivisionPortion(memoryStore(), { info: REQ.info, dataset: bad }, GEN, 'gen@x', { x: '5' }, {}, 'submit');
  assert.equal(s.overall, 'In Progress');
  assert.match(s.issues.join(' '), /Gneration/);
});

async function readyStore() {
  const store = memoryStore();
  let s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1', gas: '100' }, {}, 'submit');
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '200', solar: '3' }, versions(s), 'submit');
  assert.equal(s.overall, 'Pending DG Admin Review');
  return store;
}

const snapshot = (rows: ValueRow[]) => JSON.stringify(rows.map((r) => [r.myapp_attributemapid, r.myapp_divisionname, r.myapp_attributevalue, r.myapp_submissionstatus, r.modifiedon]));
const clar = (s: RequestState, mapId: string, divisionId: string) => s.clarifications.filter((c) => c.mapId === mapId && c.divisionId === divisionId).at(-1);

// ---------- Decisions ----------

test('approval is one review-log row with reviewer, time and reason; values untouched', async () => {
  const store = await readyStore();
  const before = snapshot(store.rows);
  const s = await writeDecision(store, REQ, 'admin@x', 'Approved', ' Looks good ', () => '2026-10-15T13:00:00Z');
  assert.equal(s.overall, 'Approved');
  assert.deepEqual(s.review, { status: 'Approved', by: 'admin@x', on: '2026-10-15T13:00:00Z', comments: 'Looks good' });
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].myapp_approvalid, `${KEY}:DECISION`, 'linked to the request key, not the dataset name');
  assert.equal(store.entries[0].myapp_requestkey, KEY);
  assert.equal(store.entries[0].myapp_ownedby, 'Generation / BD&E', 'owned by lists every division owning the dataset');
  assert.equal(snapshot(store.rows), before, 'submitted values are not modified by the decision');
});

test('a second or conflicting decision is refused', async () => {
  const store = await readyStore();
  await writeDecision(store, REQ, 'admin@x', 'Approved', '');
  await assert.rejects(writeDecision(store, REQ, 'admin2@x', 'Rejected', ''), (e: WorkflowError) => e.kind === 'locked');
  await assert.rejects(writeDecision(store, REQ, 'admin@x', 'Approved', ''), (e: WorkflowError) => e.kind === 'locked');
  assert.equal(store.entries.length, 1);
});

test('concurrent decisions: the alternate key rejects the second insert', async () => {
  const store = await readyStore();
  const results = await Promise.allSettled([
    writeDecision(store, REQ, 'a@x', 'Approved', ''),
    writeDecision(store, REQ, 'b@x', 'Rejected', 'Concurrent rejection'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(store.entries.filter((e) => e.myapp_entrytype === 'Decision').length, 1);
});

test('rejection keeps all values locked and records the required reason', async () => {
  const store = await readyStore();
  const s = await writeDecision(store, REQ, 'admin@x', 'Rejected', 'Figures do not reconcile');
  assert.equal(s.overall, 'Rejected');
  assert.equal(s.review?.comments, 'Figures do not reconcile');
  await assert.rejects(writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '9' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'locked');
});

test('no decision before every division submits', async () => {
  const store = memoryStore();
  await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1', gas: '2' }, {}, 'submit');
  await assert.rejects(writeDecision(store, REQ, 'admin@x', 'Approved', ''), (e: WorkflowError) => e.kind === 'locked');
  await assert.rejects(writeDecision(store, REQ, 'admin@x', 'Rejected', ''), (e: WorkflowError) => e.kind === 'locked');
  assert.equal(deriveRequestState(REQ, store.rows, store.entries).overall, 'In Progress');
});

// ---------- Comments ----------

test('comments are appended with author and time; earlier comments are kept', async () => {
  const store = await readyStore();
  await writeComment(store, REQ, 'admin@x', 'First look done', () => '2026-10-15T11:00:00.000Z');
  const s = await writeComment(store, REQ, 'admin2@x', 'Checked with finance', () => '2026-10-15T12:00:00.000Z');
  assert.deepEqual(s.comments.map((c) => [c.text, c.by, c.on]), [
    ['First look done', 'admin@x', '2026-10-15T11:00:00.000Z'],
    ['Checked with finance', 'admin2@x', '2026-10-15T12:00:00.000Z'],
  ]);
  await assert.rejects(writeComment(store, REQ, 'admin@x', '   '), (e: WorkflowError) => e.kind === 'validation');
  assert.equal(s.overall, 'Pending DG Admin Review', 'comments do not change the request status');
});

// ---------- Clarifications ----------

test('clarification targets one division value of a shared attribute and keeps values locked', async () => {
  const store = await readyStore();
  const before = snapshot(store.rows);
  const s = await writeClarificationRequest(store, REQ, 'admin@x', 'gas', 'bd&e', 'Why 200?');
  const c = clar(s, 'gas', 'bd&e')!;
  assert.deepEqual([c.attributeName, c.divisionName, c.submittedValue, c.question, c.status, c.askedBy],
    ['Natural Gas', 'BD&E', '200', 'Why 200?', 'Pending Response', 'admin@x']);
  assert.equal(c.key, `${KEY}:CLR:gas:bd&e:1`);
  assert.equal(clar(s, 'gas', 'generation'), undefined, 'the Generation value of the same attribute is not targeted');
  assert.equal(snapshot(store.rows), before, 'no value changed or unlocked');
  await assert.rejects(writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '250' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'locked');
});

test('clarification question is mandatory and needs a submitted value', async () => {
  const store = await readyStore();
  await assert.rejects(writeClarificationRequest(store, REQ, 'admin@x', 'gas', 'bd&e', '  '), (e: WorkflowError) => e.kind === 'validation');
  const partial = memoryStore();
  await writeDivisionPortion(partial, REQ, GEN, 'gen@x', { steam: '1' }, {}, 'draft');
  await assert.rejects(writeClarificationRequest(partial, REQ, 'admin@x', 'steam', 'generation', 'Q'), (e: WorkflowError) => e.kind === 'validation');
  await assert.rejects(writeClarificationRequest(store, REQ, 'admin@x', 'solar', 'generation', 'Q'), (e: WorkflowError) => e.kind === 'forbidden');
});

test('only one open clarification per attribute and division', async () => {
  const store = await readyStore();
  await writeClarificationRequest(store, REQ, 'admin@x', 'gas', 'bd&e', 'Q1');
  await assert.rejects(writeClarificationRequest(store, REQ, 'admin@x', 'gas', 'bd&e', 'Q2'), (e: WorkflowError) => e.kind === 'conflict');
  // The other division's value of the same shared attribute can be asked about separately.
  const s = await writeClarificationRequest(store, REQ, 'admin@x', 'gas', 'generation', 'Q3');
  assert.equal(s.clarifications.length, 2);
});

test('respond then resolve: history kept, approval blocked until resolved', async () => {
  const store = await readyStore();
  let s = await writeClarificationRequest(store, REQ, 'admin@x', 'gas', 'bd&e', 'Why 200?');
  let c = clar(s, 'gas', 'bd&e')!;
  await assert.rejects(writeDecision(store, REQ, 'admin@x', 'Approved', ''), (e: WorkflowError) => e.kind === 'validation');
  await assert.rejects(writeClarificationResolve(store, REQ, 'admin@x', c.id, c.modifiedon), (e: WorkflowError) => e.kind === 'validation');

  // Wrong division cannot answer; the right one can, once.
  await assert.rejects(writeClarificationResponse(store, REQ, GEN, 'gen@x', c.id, 'not ours', c.modifiedon), (e: WorkflowError) => e.kind === 'forbidden');
  await assert.rejects(writeClarificationResponse(store, REQ, BDE, 'bde@x', c.id, ' ', c.modifiedon), (e: WorkflowError) => e.kind === 'validation');
  s = await writeClarificationResponse(store, REQ, BDE, 'bde@x', c.id, 'Includes imports', c.modifiedon);
  c = clar(s, 'gas', 'bd&e')!;
  assert.deepEqual([c.status, c.response, c.respondedBy], ['Responded', 'Includes imports', 'bde@x']);
  await assert.rejects(writeClarificationResponse(store, REQ, BDE, 'bde@x', c.id, 'again', c.modifiedon), (e: WorkflowError) => e.kind === 'conflict');
  await assert.rejects(writeDecision(store, REQ, 'admin@x', 'Approved', ''), (e: WorkflowError) => e.kind === 'validation');

  // A stale resolve is refused; a current one succeeds.
  await assert.rejects(writeClarificationResolve(store, REQ, 'admin@x', c.id, 'stale'), (e: WorkflowError) => e.kind === 'conflict');
  s = await writeClarificationResolve(store, REQ, 'admin@x', c.id, c.modifiedon);
  c = clar(s, 'gas', 'bd&e')!;
  assert.deepEqual([c.status, c.question, c.response, c.resolvedBy], ['Resolved', 'Why 200?', 'Includes imports', 'admin@x'], 'question and answer preserved');

  // A follow-up is a new record; the first is kept.
  s = await writeClarificationRequest(store, REQ, 'admin@x', 'gas', 'bd&e', 'Follow-up?');
  assert.deepEqual(s.clarifications.filter((x) => x.mapId === 'gas').map((x) => [x.key, x.status]), [
    [`${KEY}:CLR:gas:bd&e:1`, 'Resolved'],
    [`${KEY}:CLR:gas:bd&e:2`, 'Pending Response'],
  ]);
  const f = clar(s, 'gas', 'bd&e')!;
  s = await writeClarificationResponse(store, REQ, BDE, 'bde@x', f.id, 'Yes', f.modifiedon);
  const r = clar(s, 'gas', 'bd&e')!;
  s = await writeClarificationResolve(store, REQ, 'admin@x', r.id, r.modifiedon);

  s = await writeDecision(store, REQ, 'admin@x', 'Approved', '');
  assert.equal(s.overall, 'Approved');
  assert.equal(s.rows.find((x) => x.myapp_attributemapid === 'gas' && rowDivisionId(x) === 'bd&e')?.myapp_attributevalue, '200', 'original value preserved');
});

test('rejection is allowed with open clarifications; afterwards the clarification log is closed', async () => {
  const store = await readyStore();
  let s = await writeClarificationRequest(store, REQ, 'admin@x', 'steam', 'generation', 'Source?');
  const c = clar(s, 'steam', 'generation')!;
  s = await writeDecision(store, REQ, 'admin@x', 'Rejected', 'Unclear sources');
  assert.equal(s.overall, 'Rejected');
  await assert.rejects(writeClarificationResponse(store, REQ, GEN, 'gen@x', c.id, 'late', c.modifiedon), (e: WorkflowError) => e.kind === 'locked');
  await assert.rejects(writeClarificationRequest(store, REQ, 'admin@x', 'gas', 'bd&e', 'Q'), (e: WorkflowError) => e.kind === 'locked');
  await writeComment(store, REQ, 'admin@x', 'Note after decision');
});

// ---------- Request creation ----------

const OTHER = buildDatasets([{ ...map('coal', 'Coal', 'Generation'), myapp_datasetnumber: 7, myapp_datasetname: 'Fuel Use' }], DIVS)[0];
const BDE_ONLY = buildDatasets([{ ...map('wind', 'Wind', 'BD&E'), myapp_datasetnumber: 8, myapp_datasetname: 'Wind' }], DIVS)[0];

test('create: one request per selected dataset, each with its own unique Request ID, recorded on a request row', async () => {
  const store = memoryStore({ seed: false });
  const a = await createRequest(store, DATASET, GEN, 'gen@x', undefined, () => '2026-10-21T08:00:00Z');
  const b = await createRequest(store, OTHER, GEN, 'gen@x');
  assert.deepEqual([a.requestKey, b.requestKey], ['REQ_0001', 'REQ_0002']);
  const row = store.requestRows[0];
  assert.deepEqual(
    [row.myapp_requestid, row.myapp_datasetid, row.myapp_submittedby, row.myapp_submittedon, row.myapp_divisionid, row.myapp_attributevalue, row.myapp_reviewcomments, row.myapp_reviewstatus],
    ['REQ_0001', '2', 'gen@x', '2026-10-21T08:00:00Z', 'Generation', 'Generation / BD&E', 'steam,gas', 'In Progress'],
  );
  assert.equal(store.rows.length, 0, 'creating a request writes no values');
  const info = (await refOf(store, 'REQ_0001')).info;
  assert.deepEqual([info.requestedBy, info.requestingDivision, info.selectedAttributes, info.legacy], ['gen@x', 'Generation', ['steam', 'gas'], undefined]);
});

test('create: Request IDs continue after every ID already used (value rows, review log)', async () => {
  const store = memoryStore({ seed: false });
  store.rows.push({ myapp_tbl_moei_requestid: 'old', myapp_requestid: 'REQ_0006', myapp_datasetid: '9', myapp_attributemapid: 'x', myapp_divisionname: 'Generation' });
  store.entries.push({ myapp_tbl_moei_dgadminapprovalid: 'e0', myapp_requestkey: 'REQ_0011', myapp_datasetname: 'x' });
  assert.equal((await createRequest(store, DATASET, GEN, 'gen@x')).requestKey, 'REQ_0012');
});

test('create: two creates at the same moment never share a Request ID (the alternate key refuses the second, which takes the next ID)', async () => {
  const store = memoryStore({ seed: false });
  const [a, b] = await Promise.all([createRequest(store, DATASET, GEN, 'gen@x', ['steam']), createRequest(store, OTHER, GEN, 'gen@x')]);
  assert.deepEqual([a.requestKey, b.requestKey].sort(), ['REQ_0001', 'REQ_0002']);
  assert.equal(store.requestRows.length, 2);
  // The ID list read before the insert can already be out of date: the key refuses the taken ID and the next one is used.
  const stale = memoryStore();
  const real = stale.loadUsedRequestKeys;
  let calls = 0;
  stale.loadUsedRequestKeys = async () => (calls++ === 0 ? [] : real());
  assert.equal((await createRequest(stale, OTHER, GEN, 'gen@x')).requestKey, 'REQ_0002');
  assert.deepEqual(stale.requestRows.map((r) => r.myapp_requestid), ['REQ_0001', 'REQ_0002']);
});

test('create: two creates at the same moment for the same attribute: the later request is flagged and never reaches review', async () => {
  const store = memoryStore({ seed: false });
  const [a, b] = await Promise.all([
    createRequest(store, DATASET, GEN, 'gen@x', ['gas']),
    createRequest(store, DATASET, BDE, 'bde@x', ['gas']),
  ]);
  const siblings = requestsFromRows(store.requestRows, [DATASET]);
  const [first, later] = [a, b].map((c) => c.requestKey).sort();
  const firstState = deriveRequestState(await refOf(store, first), store.rows, store.entries, siblings);
  const laterRef = await refOf(store, later);
  const laterState = deriveRequestState(laterRef, store.rows, store.entries, siblings);
  assert.equal(firstState.issues.length, 0, 'the earlier request is unaffected');
  assert.match(laterState.issues.join(' '), new RegExp(`already part of request ${first}`));
  let s = await writeDivisionPortion(store, laterRef, GEN, 'gen@x', { gas: '1' }, {}, 'submit');
  s = await writeDivisionPortion(store, laterRef, BDE, 'bde@x', { gas: '2' }, versions(s), 'submit');
  assert.equal(s.overall, 'In Progress', 'the duplicate stays out of DG Admin review');
});

test('create: an attribute already in an open request cannot be requested again; other attributes of the dataset can', async () => {
  const store = memoryStore({ seed: false });
  const first = await createRequest(store, DATASET, GEN, 'gen@x', ['steam']);
  await assert.rejects(createRequest(store, DATASET, GEN, 'gen@x', ['steam', 'gas']),
    (e: WorkflowError) => e.kind === 'conflict' && /Steam Turbines/.test(e.message) && new RegExp(first.requestKey).test(e.message));
  const second = await createRequest(store, DATASET, BDE, 'bde@x', ['gas', 'solar']);
  assert.notEqual(second.requestKey, first.requestKey, 'a second open request for the same dataset with different attributes');
  assert.equal(store.requestRows.length, 2);
});

test('create: a request with no stored selection holds every attribute of the dataset', async () => {
  const store = memoryStore();
  await assert.rejects(createRequest(store, DATASET, BDE, 'bde@x', ['solar']), (e: WorkflowError) => e.kind === 'conflict' && new RegExp(KEY).test(e.message));
  assert.equal(store.requestRows.length, 1);
});

test('create: an unmapped division cannot create a request for the dataset', async () => {
  const store = memoryStore({ seed: false });
  await assert.rejects(createRequest(store, BDE_ONLY, GEN, 'gen@x'), (e: WorkflowError) => e.kind === 'forbidden');
  await assert.rejects(createRequest(store, OTHER, { id: 'tp', name: 'TP' }, 'tp@x'), (e: WorkflowError) => e.kind === 'forbidden');
  assert.equal(store.requestRows.length, 0);
});

test('create: approved attributes stay taken; a rejected request frees its attributes for a new request', async () => {
  const approvedStore = await readyStore();
  await writeDecision(approvedStore, REQ, 'admin@x', 'Approved', '');
  assert.equal(approvedStore.requestRows[0].myapp_reviewstatus, 'Approved', 'the status is recorded on the request row');
  await assert.rejects(createRequest(approvedStore, DATASET, GEN, 'gen@x'), (e: WorkflowError) => e.kind === 'conflict');

  const store = await readyStore();
  await writeDecision(store, REQ, 'admin@x', 'Rejected', 'Wrong year');
  const next = await createRequest(store, DATASET, GEN, 'gen@x');
  assert.equal(next.requestKey, 'REQ_0002');
  const s = await writeDivisionPortion(store, await refOf(store, next.requestKey), GEN, 'gen@x', { steam: '5' }, {}, 'draft');
  assert.equal(s.rows.length, 1, 'the new request starts empty; the earlier values stay with the first request');
});

test('create: a decision whose request-row update failed still frees or holds attributes by the decision itself', async () => {
  const store = await readyStore();
  store.failRequestUpdates = true;
  const decided = await writeDecision(store, REQ, 'admin@x', 'Rejected', 'Wrong year');
  assert.equal(decided.overall, 'Rejected', 'the decision stands even though the request row could not be updated');
  assert.equal(store.requestRows[0].myapp_reviewstatus, 'Pending Review');
  store.failRequestUpdates = false;
  assert.equal((await createRequest(store, DATASET, BDE, 'bde@x')).requestKey, 'REQ_0002', 'the recorded Rejected decision frees the attributes');
});

test('request row status follows the derived status as divisions submit', async () => {
  const store = memoryStore();
  let s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1', gas: '2' }, {}, 'submit');
  assert.equal(store.requestRows[0].myapp_reviewstatus, 'In Progress');
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '3', solar: '4' }, versions(s), 'submit');
  assert.equal(s.overall, 'Pending DG Admin Review');
  assert.equal(store.requestRows[0].myapp_reviewstatus, 'Pending Review', 'stored as a short label (the column holds 20 characters)');
});

test('Scenario D: three divisions, two submitted, third still draft: stays In Progress', async () => {
  const three = buildDatasets([map('x1', 'X1', 'Generation'), map('x2', 'X2', 'BD&E'), map('x3', 'X3', 'TP')], DIVS)[0];
  const ref = { info: REQ.info, dataset: three };
  const store = memoryStore();
  const TP = three.divisions.find((d) => d.name === 'TP')!;
  let s = await writeDivisionPortion(store, ref, GEN, 'gen@x', { x1: '1' }, {}, 'submit');
  s = await writeDivisionPortion(store, ref, BDE, 'bde@x', { x2: '2' }, versions(s), 'submit');
  s = await writeDivisionPortion(store, ref, TP, 'tp@x', { x3: '3' }, versions(s), 'draft');
  assert.equal(s.overall, 'In Progress');
  await assert.rejects(writeDecision(store, ref, 'admin@x', 'Approved', ''), (e: WorkflowError) => e.kind === 'locked');
});

test('shared draft visibility: each division reads the other division draft value from the same request', async () => {
  const store = memoryStore();
  await writeDivisionPortion(store, REQ, GEN, 'gen@x', { gas: '100' }, {}, 'draft');
  const fromBde = deriveRequestState(REQ, await store.loadValueRows(KEY));
  assert.equal(valueOf(fromBde, 'gas', 'generation'), '100', 'BD&E sees Generation draft');
  assert.equal(fromBde.rows.find((r) => rowDivisionId(r) === 'generation')!.myapp_submissionstatus, 'Draft');
  assert.equal(fromBde.rows.some(isRequestRow), false, 'the request row is not a value');
  await assert.rejects(writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '999', steam: '1' }, versions(fromBde), 'draft'), (e: WorkflowError) => e.kind === 'forbidden', 'BD&E cannot write Generation attributes');
  assert.equal(valueOf(deriveRequestState(REQ, store.rows), 'gas', 'generation'), '100');
});

test('duplicate value rows are refused by the store key and reported as a conflict', async () => {
  const store = memoryStore();
  const s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1' }, {}, 'draft');
  // Simulate another session creating the same value between our read and our write.
  const realLoad = store.loadValueRows;
  store.loadValueRows = async (key) => (await realLoad(key)).filter(isRequestRow);
  await assert.rejects(writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '2' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'conflict');
  store.loadValueRows = realLoad;
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].myapp_attributevalue, '1');
});

test('writes refuse a request that does not exist', async () => {
  const store = memoryStore();
  const ghost = { info: { ...REQ.info, key: 'REQ_9999' }, dataset: DATASET };
  await assert.rejects(writeDivisionPortion(store, ghost, GEN, 'gen@x', { steam: '1' }, {}, 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
  await assert.rejects(writeDecision(store, ghost, 'admin@x', 'Approved', ''), (e: WorkflowError) => e.kind === 'forbidden');
  const elsewhere = { info: REQ.info, dataset: OTHER };
  await assert.rejects(writeDivisionPortion(store, elsewhere, GEN, 'gen@x', { coal: '1' }, {}, 'draft'), (e: WorkflowError) => e.kind === 'integrity');
  assert.equal(store.rows.length, 0);
});

// ---------- Requests created before request rows existed (value rows only) ----------

test('older request with value rows only: rebuilt from them, covering the saving division\'s attributes and the shared ones', async () => {
  const store = memoryStore({ seed: false });
  store.rows.push({ myapp_tbl_moei_requestid: 'v1', myapp_requestid: 'REQ_0005', myapp_datasetid: '2', myapp_attributemapid: 'steam', myapp_divisionname: 'Generation',
    myapp_attributevalue: '1', myapp_submissionstatus: 'Draft', createdon: '2026-10-16T08:00:00Z', modifiedon: '2026-10-16T08:00:00Z' });
  const ref = await refOf(store, 'REQ_0005');
  assert.deepEqual([ref.info.legacy, ref.info.requestedBy, ref.info.requestingDivision, ref.info.createdOn], [true, undefined, undefined, '2026-10-16T08:00:00Z'], 'who raised it is not invented');
  assert.deepEqual(ref.info.selectedAttributes, ['steam', 'gas'], 'every Generation attribute (owned and shared), never BD&E-only Solar PV');
  let s = await writeDivisionPortion(store, ref, GEN, 'gen@x', { steam: '1', gas: '2' }, versions(deriveRequestState(ref, store.rows)), 'submit');
  assert.deepEqual(s.portions.map((p) => [p.division.name, p.status]), [['Generation', 'Submitted'], ['BD&E', 'Pending']], 'BD&E still owes the shared Natural Gas');
  assert.equal(s.overall, 'In Progress');
  s = await writeDivisionPortion(store, ref, BDE, 'bde@x', { gas: '3' }, versions(s), 'submit');
  assert.equal(s.overall, 'Pending DG Admin Review');
  assert.equal(store.requestRows.length, 0, 'nothing is written to record the older request');
  await assert.rejects(createRequest(store, DATASET, GEN, 'gen@x', ['steam']), (e: WorkflowError) => e.kind === 'conflict', 'its attributes are taken');
  assert.equal((await createRequest(store, DATASET, BDE, 'bde@x', ['solar'])).requestKey, 'REQ_0006', 'Solar PV is free; numbering continues');
});

// ---------- Attribute selection ----------

test('selection: a shared attribute brings the other division into the request', async () => {
  const store = memoryStore({ seed: false });
  const r = await createRequest(store, DATASET, GEN, 'gen@x', ['gas']);
  assert.equal(store.requestRows[0].myapp_reviewcomments, 'gas');
  assert.equal(store.requestRows[0].myapp_attributevalue, 'Generation / BD&E');
  const s = deriveRequestState(await refOf(store, r.requestKey), []);
  assert.deepEqual(s.dataset.attributes.map((a) => a.mapId), ['gas'], 'the request covers only the selected attribute');
  assert.deepEqual(s.portions.map((p) => p.division.name), ['Generation', 'BD&E']);
});

test('selection: own-only attributes keep other divisions out of the request and the gate', async () => {
  const store = memoryStore({ seed: false });
  const r = await createRequest(store, DATASET, GEN, 'gen@x', ['steam']);
  assert.equal(store.requestRows[0].myapp_attributevalue, 'Generation');
  const ref = await refOf(store, r.requestKey);
  const s = await writeDivisionPortion(store, ref, GEN, 'gen@x', { steam: '1200' }, {}, 'submit');
  assert.equal(s.overall, 'Pending DG Admin Review', 'only Generation takes part, so its submit completes the request');
  await assert.rejects(writeDivisionPortion(store, ref, BDE, 'bde@x', { solar: '1' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'locked' || e.kind === 'forbidden');
});

test('selection: values outside the selected attributes are refused', async () => {
  const store = memoryStore({ seed: false });
  const r = await createRequest(store, DATASET, GEN, 'gen@x', ['steam']);
  await assert.rejects(writeDivisionPortion(store, await refOf(store, r.requestKey), GEN, 'gen@x', { gas: '5' }, {}, 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
});

test('selection: needs at least one attribute, one of the caller division, and known attributes', async () => {
  const store = memoryStore({ seed: false });
  await assert.rejects(createRequest(store, DATASET, GEN, 'gen@x', []), (e: WorkflowError) => e.kind === 'validation');
  await assert.rejects(createRequest(store, DATASET, GEN, 'gen@x', ['solar']), (e: WorkflowError) => e.kind === 'validation' && /your division/.test(e.message));
  await assert.rejects(createRequest(store, DATASET, GEN, 'gen@x', ['steam', 'not-a-map-id']), (e: WorkflowError) => e.kind === 'validation');
  assert.equal(store.requestRows.length, 0);
});

test('selection: the attribute list is frozen at creation, so later mapping changes do not alter the request', async () => {
  const store = memoryStore({ seed: false });
  const r = await createRequest(store, DATASET, GEN, 'gen@x', ['gas', 'steam']);
  assert.equal(store.requestRows[0].myapp_reviewcomments, 'steam,gas', 'every selected attribute stored explicitly, in dataset order');
  await createRequest(store, OTHER, GEN, 'gen@x');
  assert.equal(store.requestRows[1].myapp_reviewcomments, 'coal', 'no selection given = the division\'s current attributes, stored');
  // A BD&E attribute is added to the mapping after the request was created.
  const grown = buildDatasets([map('steam', 'Steam Turbines', 'Generation'), map('gas', 'Natural Gas', 'Generation / BD&E'), map('solar', 'Solar PV', 'BD&E'), map('coal2', 'Coal - Testing', 'BD&E')], DIVS)[0];
  const ref = await refOf(store, r.requestKey, grown);
  let s = await writeDivisionPortion(store, ref, GEN, 'gen@x', { steam: '1', gas: '2' }, {}, 'submit');
  s = await writeDivisionPortion(store, ref, BDE, 'bde@x', { gas: '3' }, versions(s), 'submit');
  assert.deepEqual(s.dataset.attributes.map((a) => a.mapId), ['steam', 'gas'], 'the new attribute is not part of this request');
  assert.equal(s.overall, 'Pending DG Admin Review');
});

test('gate: a division with a Draft value or an unsubmitted attribute keeps the request out of review', async () => {
  const store = memoryStore();
  let s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1', gas: '2' }, {}, 'submit');
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '3', solar: '4' }, versions(s), 'draft');
  assert.equal(s.overall, 'In Progress');
  const bde = s.portions.find((p) => p.division.id === 'bd&e')!;
  assert.deepEqual([bde.status, bde.submittedCount, bde.total, bde.outstanding], ['Draft', 0, 2, ['Natural Gas', 'Solar PV']]);
  assert.equal(store.requestRows[0].myapp_reviewstatus, 'In Progress', 'Dataverse status stays In Progress');
  await assert.rejects(writeDecision(store, REQ, 'admin@x', 'Approved', ''), (e: WorkflowError) => e.kind === 'locked' && /BD&E has submitted 0 of 2/.test(e.message));
  // The BD&E draft stays editable.
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '5' }, versions(s), 'draft');
  assert.equal(valueOf(s, 'gas', 'bd&e'), '5');
});

test('gate: a submitted blank value (older data) is incomplete, blocks review and can be completed by its division', async () => {
  const store = await readyStore();
  const row = store.rows.find((x) => x.myapp_attributemapid === 'solar')!;
  row.myapp_attributevalue = '';
  let s = deriveRequestState(REQ, store.rows, store.entries);
  assert.equal(s.overall, 'In Progress');
  assert.match(s.issues.join(' '), /BD&E's submission is incomplete \(Solar PV\)/);
  await assert.rejects(writeDecision(store, REQ, 'admin@x', 'Rejected', 'x'), (e: WorkflowError) => e.kind === 'locked');
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { solar: '7' }, versions(s), 'submit');
  assert.equal(s.overall, 'Pending DG Admin Review');
  assert.equal(store.requestRows[0].myapp_reviewstatus, 'Pending Review');
  await assert.rejects(writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '9' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'locked', 'non-blank submitted values stay locked');
});


// ---------- 16 October 2026: attribute visibility, dashboard and My Datasets (Section 17.6) ----------

test('17.6-1/2 Generation sees the dataset and only its own and shared attributes, never BD&E-only ones', () => {
  const view = datasetForDivision(DATASET, GEN.id);
  assert.deepEqual(view.attributes.map((a) => a.name), ['Steam Turbines', 'Natural Gas'], 'Solar PV (BD&E only) is hidden');
  assert.deepEqual(view.divisions.map((d) => d.name), ['Generation', 'BD&E'], 'BD&E appears only because Natural Gas is shared');
  assert.deepEqual(datasetForDivision(DATASET, BDE.id).attributes.map((a) => a.name), ['Natural Gas', 'Solar PV']);
  assert.equal(datasetForDivision(DATASET, 'tp').attributes.length, 0, 'an unrelated division sees nothing');
});

test('17.6-2 create refuses an attribute mapped only to another division and creates nothing', async () => {
  const store = memoryStore({ seed: false });
  await assert.rejects(createRequest(store, DATASET, GEN, 'gen@x', ['steam', 'solar']),
    (e: WorkflowError) => e.kind === 'validation' && /Solar PV/.test(e.message));
  assert.equal(store.requestRows.length, 0);
  await createRequest(store, DATASET, GEN, 'gen@x');
  assert.equal(store.requestRows[0].myapp_reviewcomments, 'steam,gas', 'default = owned + shared attributes only');
});

test('17.6-3/4 shared Natural Gas: separate values; a Generation draft is visible to BD&E read-only, BD&E keeps its own', async () => {
  const store = memoryStore();
  let s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { gas: '100' }, {}, 'draft');
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '200' }, versions(s), 'draft');
  const bde = requestForDivision(s, BDE.id);
  assert.equal(valueOf(bde, 'gas', GEN.id), '100', 'BD&E sees the Generation draft value');
  assert.equal(valueOf(bde, 'gas', BDE.id), '200', 'BD&E keeps its own value');
  // BD&E can only ever write its own row; the Generation value is untouched.
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '250' }, versions(s), 'draft');
  assert.equal(valueOf(s, 'gas', GEN.id), '100');
  assert.equal(valueOf(s, 'gas', BDE.id), '250');
  await assert.rejects(writeDivisionPortion(store, REQ, BDE, 'bde@x', { steam: '9' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
});

test('17.6-5 values and clarifications of attributes exclusive to another division are not exposed', async () => {
  const store = memoryStore();
  let s = await writeDivisionPortion(store, REQ, GEN, 'gen@x', { steam: '1', gas: '100' }, {}, 'draft');
  s = await writeDivisionPortion(store, REQ, BDE, 'bde@x', { gas: '200', solar: '55' }, versions(s), 'draft');
  const gen = requestForDivision(s, GEN.id);
  assert.deepEqual(gen.dataset.attributes.map((a) => a.mapId), ['steam', 'gas']);
  assert.equal(gen.rows.some((r) => r.myapp_attributemapid === 'solar'), false, 'the BD&E-only draft value is hidden');
  assert.equal(JSON.stringify(gen).includes('Solar PV'), false, 'Solar PV is not named anywhere in the Generation view');
  assert.equal(gen.overall, s.overall, 'the overall status is unchanged');
  const bdePortion = gen.portions.find((p) => p.division.id === BDE.id)!;
  assert.equal(bdePortion.total, 1, 'BD&E progress counts only the attributes Generation can see');
  const bde = requestForDivision(s, BDE.id);
  assert.equal(bde.rows.some((r) => r.myapp_attributemapid === 'steam'), false, 'Generation-only values are hidden from BD&E');
});

test('17.6-5 a division with no visible attribute in the request has no portion (it cannot open it)', async () => {
  const store = memoryStore({ seed: false });
  const r = await createRequest(store, DATASET, GEN, 'gen@x', ['steam']);
  const s = deriveRequestState(await refOf(store, r.requestKey), store.rows, store.entries);
  assert.equal(requestForDivision(s, BDE.id).portions.length, 0);
  assert.equal(requestForDivision(s, GEN.id).portions.length, 1);
});

test('17.6-6/7 My Datasets lists each approved dataset once; drafts, submissions and pending review do not count', async () => {
  const store = await readyStore();
  const pending = deriveRequestState(REQ, store.rows, store.entries);
  assert.equal(pending.overall, 'Pending DG Admin Review');
  assert.equal(approvedDatasets([pending]).length, 0, 'pending review is not owned');
  const approved = await writeDecision(store, REQ, 'boss@x', 'Approved', 'ok');
  const again = { ...approved, key: 'REQ_0009' };
  const owned = approvedDatasets([approved, again, approved]);
  assert.equal(owned.length, 1, 'one dataset, however many approved requests point to it');
  assert.deepEqual(owned[0].requests.map((r) => r.key).sort(), ['REQ_0001', 'REQ_0009']);
  const rejected = { ...approved, key: 'REQ_0010', overall: 'Rejected' as const, review: { ...approved.review!, status: 'Rejected' as const } };
  assert.equal(approvedDatasets([rejected]).length, 0, 'a rejected request does not make a dataset owned');
});

// ---------- Shared attribute brings the other division in, with only that attribute (17 Oct 2026) ----------

test('Generation requests a and b (b shared with BD&E): BD&E gets that request with only b; c and d are not created until BD&E asks', async () => {
  const mapD1 = (id: string, attr: string, division: string): MapRow => ({ ...map(id, attr, division), myapp_datasetnumber: 1, myapp_datasetname: 'Dataset 1' });
  const D1 = buildDatasets([mapD1('a', 'A', 'Generation'), mapD1('b', 'B', 'Generation / BD&E'), mapD1('c', 'C', 'BD&E'), mapD1('d', 'D', 'BD&E')], DIVS)[0];
  const store = memoryStore({ seed: false });
  const created = await createRequest(store, D1, GEN, 'gen@x', ['a', 'b']);
  const ref = await refOf(store, created.requestKey, D1);
  const state = () => deriveRequestState(ref, store.rows, store.entries, requestsFromRows(store.requestRows, [D1]));

  assert.equal(store.requestRows.length, 1, 'one request; nothing is auto-created for c and d');
  assert.deepEqual(requestForDivision(state(), BDE.id).dataset.attributes.map((a) => a.mapId), ['b'], 'BD&E sees only the shared attribute');
  assert.deepEqual(requestForDivision(state(), GEN.id).dataset.attributes.map((a) => a.mapId), ['a', 'b']);
  assert.deepEqual(state().portions.map((p) => [p.division.name, p.total]), [['Generation', 2], ['BD&E', 1]], 'BD&E owes one value: b');

  // BD&E can still request c and d itself; b is not offered again.
  assert.deepEqual(requestableAttributes(D1, BDE.id, [state()]).map((a) => a.mapId), ['c', 'd']);
  assert.deepEqual(requestableAttributes(D1, GEN.id, [state()]).map((a) => a.mapId), []);
  await assert.rejects(createRequest(store, D1, BDE, 'bde@x', ['b']), (e: WorkflowError) => e.kind === 'conflict');

  // The shared request reaches DG Admin once Generation (a, b) and BD&E (b) have submitted.
  let s = await writeDivisionPortion(store, ref, GEN, 'gen@x', { a: '1', b: '100' }, {}, 'submit');
  assert.equal(s.overall, 'In Progress');
  s = await writeDivisionPortion(store, ref, BDE, 'bde@x', { b: '200' }, versions(s), 'submit');
  assert.equal(s.overall, 'Pending DG Admin Review');
  await assert.rejects(writeDivisionPortion(store, ref, BDE, 'bde@x', { c: '5' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'forbidden' || e.kind === 'locked', 'c is not part of this request');

  // When BD&E asks for c and d, that is a separate request that Generation is not part of.
  const own = await createRequest(store, D1, BDE, 'bde@x', ['c', 'd']);
  const bdeOnly = deriveRequestState(await refOf(store, own.requestKey, D1), store.rows, store.entries, requestsFromRows(store.requestRows, [D1]));
  assert.deepEqual(bdeOnly.portions.map((p) => p.division.name), ['BD&E']);
  assert.equal(requestForDivision(bdeOnly, GEN.id).portions.length, 0, 'Generation does not see it');
  assert.equal(store.requestRows.length, 2);
});

test('older request raised by Generation that stored BD&E-only attributes: BD&E sees and owes only the shared attribute (REQ_0004 case)', async () => {
  const mapD3 = (id: string, attr: string, division: string): MapRow => ({ ...map(id, attr, division), myapp_datasetnumber: 3, myapp_datasetname: 'Final Energy Consumption' });
  const D3 = buildDatasets([mapD3('elec', 'Electricity', 'Generation'), mapD3('ng', 'Natural Gas', 'Generation / BD&E'), mapD3('coal', 'Coal - Testing', 'BD&E'), mapD3('bio', 'Biomass and Waste', 'BD&E')], DIVS)[0];
  const store = memoryStore({ seed: false });
  // Stored before the selection rule: every attribute, BD&E-only ones included.
  store.requestRows.push(requestRow('REQ_0004', D3, ['elec', 'ng', 'coal', 'bio'], 'Generation', '2026-10-16T06:33:00Z'));
  const ref = await refOf(store, 'REQ_0004', D3);
  let s = await writeDivisionPortion(store, ref, GEN, 'gen@x', { elec: '5', ng: '100' }, {}, 'submit');

  assert.deepEqual(s.dataset.attributes.map((a) => a.mapId), ['elec', 'ng'], 'the request covers only attributes mapped to Generation');
  assert.deepEqual(requestForDivision(s, BDE.id).dataset.attributes.map((a) => a.name), ['Natural Gas'], 'BD&E sees only Natural Gas');
  assert.deepEqual(s.portions.map((p) => [p.division.name, p.total]), [['Generation', 2], ['BD&E', 1]]);
  await assert.rejects(writeDivisionPortion(store, ref, BDE, 'bde@x', { coal: '1' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
  s = await writeDivisionPortion(store, ref, BDE, 'bde@x', { ng: '200' }, versions(s), 'submit');
  assert.deepEqual(s.issues, [], 'no data issues');
  assert.equal(s.overall, 'Pending DG Admin Review', 'BD&E submitting Natural Gas completes the request');
  // Coal and Biomass are free for BD&E to request itself.
  assert.deepEqual(requestableAttributes(D3, BDE.id, [s]).map((a) => a.mapId), ['coal', 'bio']);
  const own = await createRequest(store, D3, BDE, 'bde@x', ['coal', 'bio']);
  assert.equal(own.kind, 'created');
});

test('older request: values already saved for another division\'s exclusive attribute stay visible (REQ_0003 case)', async () => {
  const store = memoryStore({ seed: false });
  // Raised by BD&E but stored Generation-only Steam Turbines, which Generation has already submitted.
  store.requestRows.push(requestRow('REQ_0003', DATASET, ['steam', 'gas', 'solar'], 'BD&E', '2026-10-15T11:43:00Z'));
  const ref = await refOf(store, 'REQ_0003');
  const before = deriveRequestState(ref, store.rows, store.entries, requestsFromRows(store.requestRows, [DATASET]));
  assert.deepEqual(before.dataset.attributes.map((a) => a.mapId), ['gas', 'solar'], 'without saved values Steam Turbines is not part of a BD&E request');
  store.rows.push({ myapp_tbl_moei_requestid: 'old1', myapp_requestid: 'REQ_0003', myapp_datasetid: '2', myapp_attributemapid: 'steam', myapp_divisionname: 'Generation',
    myapp_attributevalue: '100', myapp_submissionstatus: 'Submitted', modifiedon: '2026-10-15T12:00:00Z' });
  const after = deriveRequestState(ref, store.rows, store.entries, requestsFromRows(store.requestRows, [DATASET]));
  assert.deepEqual(after.dataset.attributes.map((a) => a.mapId), ['steam', 'gas', 'solar'], 'the submitted Generation value is kept, never hidden');
  await assert.rejects(createRequest(store, DATASET, GEN, 'gen@x', ['steam']), (e: WorkflowError) => e.kind === 'conflict', 'and it is not requested a second time');
});
