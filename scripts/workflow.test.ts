// Unit tests for the business rules in src/data/workflow.ts.
// Run: npm test   (uses Node's built-in test runner with type stripping)
// Fixtures are test-only and are never used by the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanCreateRequest,
  assertReviewable,
  buildDatasets,
  canDivisionEdit,
  deriveRequestState,
  divisionsFromUsers,
  missingRequiredValues,
  nextRequestKey,
  planClarification,
  planDivisionWrite,
  RequestRows,
  requestInfoFromRow,
  requestsFromRows,
  resolveUser,
  storedStatus,
  validateReason,
  withDecisions,
  WorkflowError,
} from '../src/data/workflow.ts';
import type { Dataset, MapRow, RequestInfo, ReviewEntryRow, UserRow, ValueRow } from '../src/data/types.ts';

let uid = 0;
const user = (mail: string, designation: string, role = 'BusinessDivision', statecode = 0): UserRow => ({
  myapp_tbl_moei_userdetailsid: `u${++uid}`,
  myapp_username: mail.split('@')[0],
  myapp_usermailid: mail,
  myapp_userdesignation: designation,
  myapp_userrole: role,
  statecode,
});
const USERS = [
  user('one@x.com', 'Division 1'),
  user('two@x.com', 'Division 2'),
  user('two.b@x.com', 'Division 2'),
  user('three@x.com', 'Division 3'),
  user('boss@x.com', 'Admin', 'DG Admin'),
];
const DIVS = divisionsFromUsers(USERS);
const map = (id: string, attr: string, division: string, n = 1): MapRow => ({
  myapp_tbl_moei_datasetandbusinessmapid: id,
  myapp_datasetnumber: n,
  myapp_datasetname: 'Dataset A',
  myapp_attributename: attr,
  myapp_businessdivision: division,
  statecode: 0,
});
const NAMES: Record<string, string> = { d1: 'Division 1', d2: 'Division 2', d3: 'Division 3' };
let seq = 0;
/** Value row for division d1/d2/d3 (stored by name in myapp_divisionname). */
const row = (mapId: string, div: string, value: string, status = 'Draft', extra: Partial<ValueRow> = {}): ValueRow => ({
  myapp_tbl_moei_requestid: `r${++seq}`,
  myapp_requestid: 'REQ-1',
  myapp_datasetid: '1',
  myapp_attributemapid: mapId,
  myapp_divisionname: NAMES[div],
  myapp_attributevalue: value,
  myapp_submissionstatus: status,
  modifiedon: `2026-10-15T00:00:0${seq % 10}Z`,
  ...extra,
});
const versions = (rows: ValueRow[]) => Object.fromEntries(rows.map((r) => [r.myapp_tbl_moei_requestid, r.modifiedon]));
const D1 = 'division 1';
const D2 = 'division 2';
const D3 = 'division 3';

// Scenario A: split attributes. Scenario B: shared "Natural Gas".
const SPLIT = [map('a1', 'Attribute 1', 'Division 1'), map('a2', 'Attribute 2', 'Division 1'), map('a3', 'Attribute 3', 'Division 2'), map('a4', 'Attribute 4', 'Division 2')];
const SHARED = [map('ng', 'Natural Gas', 'Division 1 / Division 2')];
const dsSplit = () => buildDatasets(SPLIT, DIVS)[0];
const dsShared = () => buildDatasets(SHARED, DIVS)[0];
/** Request REQ-1 for dataset 1 (test fixture). */
const info = (ds: Dataset, extra: Partial<RequestInfo> = {}): RequestInfo => ({
  key: 'REQ-1', datasetKey: ds.key, selectedAttributes: [], ...extra,
});
const derive = (ds: Dataset, rows: ValueRow[], entries: ReviewEntryRow[] = [], extra: Partial<RequestInfo> = {}) =>
  deriveRequestState({ info: info(ds, extra), dataset: ds }, rows, entries);

// ---------- User details: identity, role, division ----------

test('1 identity: user maps to exactly one division by exact mail match on the user record', () => {
  const r = resolveUser(USERS, 'TWO.B@x.com');
  assert.deepEqual(r, { kind: 'ok', division: { id: D2, name: 'Division 2' }, isAdmin: false, name: 'two.b', role: 'BusinessDivision', designation: 'Division 2' }, 'display name is myapp_username');
});

test('2 missing user record or substring match is rejected', () => {
  assert.equal(resolveUser(USERS, 'nobody@x.com').kind, 'none');
  assert.equal(resolveUser(USERS, 'one@x.co').kind, 'none');
  assert.equal(resolveUser(USERS, '').kind, 'none');
});

test('2b duplicate active records are blocked; inactive records never grant access', () => {
  assert.deepEqual(resolveUser([...USERS, user('one@x.com', 'Division 4')], 'one@x.com'), { kind: 'multiple', count: 2 });
  assert.equal(resolveUser([user('gone@x.com', 'Division 1', 'BusinessDivision', 1)], 'gone@x.com').kind, 'inactive');
  // An inactive duplicate does not block the active record.
  const r = resolveUser([...USERS, user('one@x.com', 'Division 4', 'BusinessDivision', 1)], 'one@x.com');
  assert.equal(r.kind === 'ok' && r.division?.name, 'Division 1');
});

test('2c unknown role or division user without a division is rejected', () => {
  assert.equal(resolveUser([user('a@x.com', 'Division 1', 'Viewer')], 'a@x.com').kind, 'invalid');
  assert.equal(resolveUser([user('a@x.com', '  ')], 'a@x.com').kind, 'invalid');
});

test('8 DG Admin comes from the role on the user record and is never a steward division', () => {
  assert.deepEqual(resolveUser(USERS, 'boss@x.com'), { kind: 'ok', division: null, isAdmin: true, name: 'boss', roleLabel: 'DG Admin - Admin', role: 'DG Admin', designation: 'Admin' }, 'role label is <role> - <designation>');
  assert.equal(resolveUser([user('b@x.com', 'Admin', ' dg  admin ')], 'b@x.com').kind, 'ok', 'role compared ignoring case/spaces');
  assert.equal(DIVS.some((d) => d.name === 'Admin'), false, 'admin designation is not a division');
  const ds = buildDatasets([map('x', 'X', 'Admin')], DIVS)[0];
  assert.equal(ds.divisions.length, 0);
  assert.equal(ds.issues.length > 0, true);
});

test('division list comes only from active division users', () => {
  const divs = divisionsFromUsers([...USERS, user('old@x.com', 'Retired Division', 'BusinessDivision', 1)]);
  assert.deepEqual(divs.map((d) => d.name).sort(), ['Division 1', 'Division 2', 'Division 3']);
});

// ---------- Datasets, gate, locking ----------

test('3 different attributes: each division edits only its own; gate waits for both', () => {
  const ds = dsSplit();
  assert.deepEqual(ds.divisions.map((d) => d.name), ['Division 1', 'Division 2']);
  let state = derive(ds, []);
  assert.throws(() => planDivisionWrite(state, D1, { a3: '5' }, {}, 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
  const plan = planDivisionWrite(state, D1, { a1: '10', a2: '20' }, {}, 'submit');
  assert.deepEqual(plan.create.map((c) => c.attribute.mapId), ['a1', 'a2']);

  const d1Submitted = [row('a1', 'd1', '10', 'Submitted'), row('a2', 'd1', '20', 'Submitted')];
  state = derive(ds, d1Submitted);
  assert.equal(state.portions.find((p) => p.division.id === D1)!.status, 'Submitted');
  assert.equal(state.portions.find((p) => p.division.id === D2)!.status, 'Pending');
  assert.equal(state.overall, 'In Progress');

  state = derive(ds, [...d1Submitted, row('a3', 'd2', '7', 'Draft')]);
  assert.equal(state.overall, 'In Progress', 'a draft is not a submission');

  state = derive(ds, [...d1Submitted, row('a3', 'd2', '7', 'Submitted'), row('a4', 'd2', '8', 'Submitted')]);
  assert.equal(state.overall, 'Pending DG Admin Review');
});

test('4 shared attribute: separate values per division, neither overwrites the other', () => {
  const ds = dsShared();
  assert.deepEqual(ds.attributes[0].divisions.map((d) => d.id), [D1, D2]);
  const rows = [row('ng', 'd1', '100'), row('ng', 'd2', '200')];
  const state = derive(ds, rows);
  const plan = planDivisionWrite(state, D1, { ng: '150' }, versions(rows), 'draft');
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].row.myapp_divisionname, 'Division 1', 'only Division 1 row is touched');
  assert.equal(plan.create.length, 0);

  const d1Done = derive(ds, [row('ng', 'd1', '100', 'Submitted'), row('ng', 'd2', '200')]);
  assert.equal(d1Done.overall, 'In Progress', 'Division 1 submitting does not count for Division 2');
  assert.equal(canDivisionEdit(d1Done, D2), true);
  assert.equal(canDivisionEdit(d1Done, D1), false);
});

test('5 unrelated division never appears in the dataset or the gate', () => {
  const state = derive(dsSplit(), []);
  assert.equal(state.portions.some((p) => p.division.id === D3), false);
  assert.throws(() => planDivisionWrite(state, D3, {}, {}, 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
});

test('6 draft: blanks allowed while drafting; draft keeps editing open', () => {
  const ds = dsSplit();
  const plan = planDivisionWrite(derive(ds, []), D1, { a1: '', a2: '' }, {}, 'draft');
  assert.equal(plan.create.length + plan.update.length, 0);
  const state = derive(ds, [row('a1', 'd1', '1')]);
  assert.equal(state.portions[0].status, 'Draft');
  assert.equal(canDivisionEdit(state, D1), true);
});

test('6b required values: submit is refused while any owned attribute is blank', () => {
  const ds = dsSplit();
  const state = derive(ds, [row('a1', 'd1', '1')]);
  assert.deepEqual(missingRequiredValues(state, D1, {}).map((a) => a.mapId), ['a2']);
  assert.deepEqual(missingRequiredValues(state, D1, { a1: '  ', a2: 'x' }).map((a) => a.mapId), ['a1'], 'whitespace counts as blank');
  assert.throws(() => planDivisionWrite(state, D1, { a2: '' }, versions(state.rows), 'submit'), (e: WorkflowError) => e.kind === 'validation' && /Attribute 2/.test(e.message));
  assert.doesNotThrow(() => planDivisionWrite(state, D1, { a2: '2' }, versions(state.rows), 'submit'));
});

test('7 submitted portions are locked on the write path, including partial submits', () => {
  const ds = dsSplit();
  const done = [row('a1', 'd1', '10', 'Submitted'), row('a2', 'd1', '20', 'Submitted')];
  assert.throws(() => planDivisionWrite(derive(ds, done), D1, { a1: '11' }, versions(done), 'draft'), (e: WorkflowError) => e.kind === 'locked');

  const partial = [row('a1', 'd1', '10', 'Submitted')];
  const state = derive(ds, partial);
  assert.equal(state.portions[0].status, 'Draft');
  assert.throws(() => planDivisionWrite(state, D1, { a1: '99', a2: 'x' }, versions(partial), 'submit'), (e: WorkflowError) => e.kind === 'locked');
  const plan = planDivisionWrite(state, D1, { a2: 'x' }, versions(partial), 'submit');
  assert.deepEqual(plan.create.map((c) => c.attribute.mapId), ['a2']);
});

test('concurrency: stale form versions are rejected', () => {
  const rows = [row('a1', 'd1', '1')];
  const state = derive(dsSplit(), rows);
  assert.throws(() => planDivisionWrite(state, D1, { a1: '2' }, { [rows[0].myapp_tbl_moei_requestid]: 'old' }, 'draft'), (e: WorkflowError) => e.kind === 'conflict');
});

test('integrity: duplicates and unknown divisions block the gate', () => {
  const ds = dsShared();
  const dup = derive(ds, [row('ng', 'd1', '1', 'Submitted'), row('ng', 'd1', '2', 'Submitted'), row('ng', 'd2', '3', 'Submitted')]);
  assert.equal(dup.overall, 'In Progress');
  const bad = buildDatasets([map('z', 'Z', 'Division 1 / Gneration')], DIVS)[0];
  const s = derive(bad, [row('z', 'd1', '1', 'Submitted')]);
  assert.equal(s.overall, 'In Progress');
  assert.match(s.issues.join(' '), /Gneration/);
});

test('legacy rows with an old business-division GUID still match by division name', () => {
  const rows = [row('ng', 'd1', '500', 'Submitted', { myapp_divisionid: '2ae9eee4-a0ac-4f0b-8a0a-fe8174e8894d' })];
  const s = derive(dsShared(), rows);
  assert.equal(s.issues.length, 0);
  assert.equal(s.portions.find((p) => p.division.id === D1)!.status, 'Submitted');
});

test('DG Admin decisions: only when pending; rejection keeps values locked', () => {
  const ds = dsShared();
  const inProgress = derive(ds, [row('ng', 'd1', '1', 'Submitted')]);
  assert.throws(() => assertReviewable(inProgress, 'Approved'));
  const ready = derive(ds, [row('ng', 'd1', '1', 'Submitted'), row('ng', 'd2', '2', 'Submitted')]);
  assertReviewable(ready, 'Rejected');
  const decision: ReviewEntryRow = {
    myapp_tbl_moei_dgadminapprovalid: 'e1', myapp_approvalid: 'REQ-1:DECISION', myapp_requestkey: 'REQ-1',
    myapp_entrytype: 'Decision', myapp_datasetname: 'Dataset A', myapp_status: 'Rejected', myapp_reviewedby: 'boss@x.com',
  };
  const rejected = derive(ds, ready.rows, [decision]);
  assert.equal(rejected.overall, 'Rejected');
  assert.equal(derive(ds, ready.rows, [{ ...decision, myapp_requestkey: '9' }]).overall, 'Pending DG Admin Review', 'entries of other requests are ignored');
  const conflicting = derive(ds, ready.rows, [decision, { ...decision, myapp_tbl_moei_dgadminapprovalid: 'e2', myapp_status: 'Approved' }]);
  assert.match(conflicting.issues.join(' '), /Conflicting/);
  assert.equal(canDivisionEdit(rejected, D1), false);
  assert.throws(() => assertReviewable(rejected, 'Approved'));
});

// ---------- Requests ----------

test('requests: values and review entries belong to one Request ID, not to the dataset', () => {
  const ds = dsShared();
  const mine = row('ng', 'd1', '100', 'Submitted');
  const otherRequest = row('ng', 'd2', '999', 'Submitted', { myapp_requestid: 'REQ-2' });
  const s = derive(ds, [mine, otherRequest]);
  assert.equal(s.key, 'REQ-1');
  assert.deepEqual(s.rows.map((r) => r.myapp_attributevalue), ['100'], 'REQ-2 values are not part of REQ-1');
  assert.equal(s.portions.find((p) => p.division.id === D2)!.status, 'Pending');
  assert.equal(derive(ds, []).overall, 'In Progress', 'a new request with no values is In Progress');
});

test('requests: creation needs the dataset mapped to the division, attributes, and a selection of the division\'s attributes', () => {
  const ds = dsSplit();
  assert.doesNotThrow(() => assertCanCreateRequest(ds, D1));
  assert.doesNotThrow(() => assertCanCreateRequest(ds, D1, ['a1']));
  assert.throws(() => assertCanCreateRequest(ds, D3), (e: WorkflowError) => e.kind === 'forbidden');
  assert.throws(() => assertCanCreateRequest(ds, D1, []), (e: WorkflowError) => e.kind === 'validation');
  assert.throws(() => assertCanCreateRequest(ds, D1, ['a1', 'gone']), (e: WorkflowError) => e.kind === 'validation');
  assert.throws(() => assertCanCreateRequest(ds, D1, ['a3']), (e: WorkflowError) => e.kind === 'validation' && /Attribute 3/.test(e.message));
});

test('requests: Request IDs are REQ_ and the next number after every ID used, at least four digits', () => {
  assert.equal(nextRequestKey([]), 'REQ_0001');
  assert.equal(nextRequestKey(['REQ_0006', 'REQ_0003', undefined, 'ITEST_1', ' req_0011 ']), 'REQ_0012');
  assert.equal(nextRequestKey(['REQ_9999']), 'REQ_10000');
});

test('requests: every status fits the 20-character status column of the request row', () => {
  for (const s of ['In Progress', 'Pending DG Admin Review', 'Approved', 'Rejected'] as const) assert.ok(storedStatus(s).length <= 20, s);
  const info = requestInfoFromRow({ myapp_tbl_moei_requestid: 'r', myapp_requestid: 'REQ_0001', myapp_datasetid: '1', myapp_attributemapid: RequestRows.marker, myapp_divisionname: RequestRows.marker, myapp_reviewstatus: storedStatus('Pending DG Admin Review') });
  assert.equal(info.status, 'Pending DG Admin Review', 'read back as the full status');
});

test('requests: read from the request row, which is never a value', () => {
  const ds = dsSplit();
  const rows: ValueRow[] = [
    { myapp_tbl_moei_requestid: 'rr', myapp_requestid: 'REQ-1', myapp_datasetid: '1', myapp_attributemapid: RequestRows.marker, myapp_divisionname: RequestRows.marker,
      myapp_submittedby: 'one@x.com', myapp_submittedon: '2026-10-21T08:00:00Z', myapp_divisionid: 'Division 1', myapp_reviewcomments: 'a1, a2', myapp_reviewstatus: 'In Progress' },
    row('a1', 'd1', '5'),
  ];
  const [info] = requestsFromRows(rows, [ds]);
  assert.deepEqual(info, { key: 'REQ-1', datasetKey: '1', requestedBy: 'one@x.com', requestingDivision: 'Division 1', selectedAttributes: ['a1', 'a2'], status: 'In Progress', createdOn: '2026-10-21T08:00:00Z', rowId: 'rr' });
  const s = deriveRequestState({ info, dataset: ds }, rows);
  assert.equal(s.rows.length, 1, 'only the value row');
  assert.equal(s.issues.length, 0, 'the request row is not reported as a value outside the mapping');
});

test('requests: an older request (value rows only) is scoped by the division mapped to all its saved attributes', () => {
  const ds = buildDatasets([...SPLIT, map('ng', 'Natural Gas', 'Division 1 / Division 2')], DIVS)[0];
  const [one] = requestsFromRows([row('a1', 'd1', '5')], [ds]);
  assert.deepEqual([one.selectedAttributes, one.legacy, one.requestedBy, one.requestingDivision], [['a1', 'a2', 'ng'], true, undefined, undefined]);
  const [both] = requestsFromRows([row('a1', 'd1', '5'), row('ng', 'd2', '7')], [ds]);
  assert.deepEqual(both.selectedAttributes, ['a1', 'a2', 'ng'], 'the other division saving a shared value does not widen the request');
  const [shared] = requestsFromRows([row('ng', 'd1', '5')], [ds]);
  assert.deepEqual(shared.selectedAttributes, ['a1', 'a2', 'a3', 'a4', 'ng'], 'only a shared value saved: either division may have raised it, so both divisions\' attributes');
});

test('requests: the recorded decision is the request status (a Rejected request frees its attributes)', () => {
  const infos: RequestInfo[] = [{ key: 'REQ-1', datasetKey: '1', selectedAttributes: [], status: 'Pending DG Admin Review' }, { key: 'REQ-2', datasetKey: '1', selectedAttributes: [] }];
  const decided = withDecisions(infos, [{ myapp_tbl_moei_dgadminapprovalid: 'e', myapp_requestkey: 'REQ-1', myapp_entrytype: 'Decision', myapp_datasetname: 'x', myapp_status: 'Rejected' }]);
  assert.deepEqual(decided.map((r) => r.status), ['Rejected', undefined]);
});

test('requests: a request for another dataset is flagged and never reaches review', () => {
  const ds = dsShared();
  const s = derive(ds, [row('ng', 'd1', '1', 'Submitted'), row('ng', 'd2', '2', 'Submitted')], [], { datasetKey: '99' });
  assert.equal(s.overall, 'In Progress');
  assert.match(s.issues.join(' '), /different dataset/);
});

test('rejection needs a reason; approval comment is optional', () => {
  assert.throws(() => validateReason('  ', 'Rejected'), (e: WorkflowError) => e.kind === 'validation');
  assert.equal(validateReason(' Wrong units ', 'Rejected'), 'Wrong units');
  assert.equal(validateReason('', 'Approved'), '');
});

test('follow-up: allowed after a response, refused while the division has not answered', () => {
  const ds = dsShared();
  const rows = [row('ng', 'd1', '1', 'Submitted'), row('ng', 'd2', '2', 'Submitted')];
  const clarification = (status: string): ReviewEntryRow => ({
    myapp_tbl_moei_dgadminapprovalid: 'c1', myapp_approvalid: 'REQ-1:CLR:ng:division 2:1', myapp_requestkey: 'REQ-1', myapp_entrytype: 'Clarification',
    myapp_datasetname: 'Dataset A', myapp_status: status, myapp_attributemapid: 'ng', myapp_divisionname: 'Division 2', myapp_comments: 'Why?',
  });
  assert.throws(() => planClarification(derive(ds, rows, [clarification('Pending Response')]), 'ng', D2, 'Again?'), (e: WorkflowError) => e.kind === 'conflict');
  const plan = planClarification(derive(ds, rows, [clarification('Responded')]), 'ng', D2, 'Follow-up?');
  assert.equal(plan.approvalId, 'REQ-1:CLR:ng:division 2:2', 'follow-up is a new record keyed by the Request ID');
  const responded = derive(ds, rows, [clarification('Responded')]);
  assert.throws(() => assertReviewable(responded, 'Approved'), (e: WorkflowError) => e.kind === 'validation', 'a responded but unresolved clarification blocks approval');
});

test('dataset classifications come from the mapping attribute classification', () => {
  const ds = buildDatasets([{ ...map('a', 'A', 'Division 1'), myapp_attributeclassification: 1 }, { ...map('b', 'B', 'Division 1'), myapp_attributeclassification: 0 }], DIVS)[0];
  assert.deepEqual(ds.classifications, ['Confidential', 'Open']);
  assert.deepEqual(dsSplit().classifications, [], 'no classification is invented when the column is empty');
});

// ---------- Display formats (17 Oct 2026) ----------

test('dataset IDs are shown as DS-001 from the mapping dataset number', async () => {
  const { datasetId } = await import('../src/data/workflow.ts');
  assert.equal(datasetId({ number: 1, key: '1' }), 'DS-001');
  assert.equal(datasetId({ number: 18, key: '18' }), 'DS-018');
  assert.equal(datasetId({ number: 1234, key: '1234' }), 'DS-1234');
  assert.equal(datasetId({ number: undefined, key: 'name:fuel' }), 'name:fuel', 'no number: the key is shown');
});

test('trend chart: requests per month for each selected year; only years present in the data', async () => {
  const { monthlyCounts, yearsOf } = await import('../src/components/format.ts');
  const dates = [new Date(2026, 9, 15).toISOString(), new Date(2026, 9, 2).toISOString(), new Date(2026, 0, 31).toISOString(), new Date(2025, 11, 1).toISOString(), undefined];
  assert.deepEqual(yearsOf(dates), [2026, 2025], 'newest first, no empty years');
  const counts = monthlyCounts(dates, [2025, 2026]);
  assert.deepEqual(counts.get(2026), [1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0]);
  assert.deepEqual(counts.get(2025), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(monthlyCounts(dates, [2024]).get(2024), Array(12).fill(0));
});
