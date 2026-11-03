// Dataverse integration test: runs src/data/operations.ts against the live
// tbl_MOEI_requests and tbl_MOEI_DGAdminApproval tables through the Web API,
// using the real mapping and user-details rows. The test request is created for
// a dataset key "ITEST-..." that no real dataset uses, so it never blocks or
// touches real requests. It takes the next free REQ_ number like any request;
// every row it creates is deleted at the end, which frees that number again.
// WRITES TO LIVE DATAVERSE: run only when that is intended.
//
// Usage (PowerShell): $env:DATAVERSE_URL='https://<org>.crm.dynamics.com'; npm run test:integration
// Optional: $env:ITEST_DATASET='2' (a dataset number with at least two divisions)
// Requires Azure CLI signed in as a user who can read/write the tables.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  createRequest,
  loadState,
  writeClarificationRequest,
  writeClarificationResolve,
  writeClarificationResponse,
  writeComment,
  writeDecision,
  writeDivisionPortion,
  type RequestStore,
} from '../src/data/operations.ts';
import { attributesFor, buildDatasets, divisionsFromUsers, EntryKeys, isRequestRow, requestsFromRows, resolveUser, rowDivisionId, WorkflowError } from '../src/data/workflow.ts';
import { REQUIRED_REQUEST_COLUMNS, REQUIRED_REVIEW_COLUMNS } from '../src/data/schema.ts';
import type { Dataset, Division, MapRow, RequestRef, RequestState, ReviewEntryRow, UserRow, ValueRow } from '../src/data/types.ts';

const orgUrl = (process.env.DATAVERSE_URL ?? '').replace(/\/$/, '');
const datasetNumber = Number(process.env.ITEST_DATASET ?? 2);
if (!/^https:\/\/[\w.-]+\.dynamics\.com$/.test(orgUrl)) throw new Error('Set DATAVERSE_URL to the Dataverse org URL, e.g. https://org.crm.dynamics.com');
if (!Number.isInteger(datasetNumber)) throw new Error('ITEST_DATASET must be a dataset number');

const token = execSync(`az account get-access-token --resource ${orgUrl} --query accessToken -o tsv`).toString().trim();
const api = `${orgUrl}/api/data/v9.2`;
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' };

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${api}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const isDuplicate = (e: unknown) => e instanceof Error && /duplicate|already exists|0x80060892/i.test(e.message);

/** POST and return the new row ID; an alternate-key violation becomes WorkflowError('conflict') like the app's store. */
async function insert(entitySet: string, row: object): Promise<string> {
  const res = await fetch(`${api}/${entitySet}`, { method: 'POST', headers, body: JSON.stringify(row) });
  if (!res.ok) {
    const err = new Error(`create ${entitySet} -> ${res.status} ${await res.text()}`);
    throw isDuplicate(err) ? new WorkflowError('conflict', err.message) : err;
  }
  return /\(([0-9a-f-]{36})\)/.exec(res.headers.get('OData-EntityId') ?? '')![1];
}

const TEST_DATASET_KEY = `ITEST-${Date.now()}`;
const created = { requests: [] as string[], reviews: [] as string[] };
const valueSelect = ['myapp_tbl_moei_requestid', ...REQUIRED_REQUEST_COLUMNS, 'modifiedon', 'createdon'].join(',');
const entrySelect = ['myapp_tbl_moei_dgadminapprovalid', ...REQUIRED_REVIEW_COLUMNS, 'modifiedon', 'createdon'].join(',');
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

const store: RequestStore = {
  loadValueRows: async (key) =>
    (await call('GET', `myapp_tbl_moei_requests?$select=${valueSelect}&$filter=statecode eq 0 and myapp_requestid eq ${lit(key)}`)).value as ValueRow[],
  loadDatasetRows: async (key) =>
    (await call('GET', `myapp_tbl_moei_requests?$select=${valueSelect}&$filter=statecode eq 0 and myapp_datasetid eq ${lit(key)}`)).value as ValueRow[],
  loadUsedRequestKeys: async () => [
    ...((await call('GET', 'myapp_tbl_moei_requests?$select=myapp_requestid')).value as ValueRow[]).map((r) => r.myapp_requestid ?? ''),
    ...((await call('GET', 'myapp_tbl_moei_dgadminapprovals?$select=myapp_requestkey')).value as ReviewEntryRow[]).map((e) => e.myapp_requestkey ?? ''),
  ],
  create: async (row) => { created.requests.push(await insert('myapp_tbl_moei_requests', row)); },
  update: async (id, changes) => { await call('PATCH', `myapp_tbl_moei_requests(${id})`, changes); },
  loadEntries: async (key) =>
    (await call('GET', `myapp_tbl_moei_dgadminapprovals?$select=${entrySelect}&$filter=myapp_requestkey eq ${lit(key)}`)).value as ReviewEntryRow[],
  createEntry: async (row) => { created.reviews.push(await insert('myapp_tbl_moei_dgadminapprovals', row)); },
  updateEntry: async (id, changes) => { await call('PATCH', `myapp_tbl_moei_dgadminapprovals(${id})`, changes); },
};

let requestKey = '';
after(async () => {
  // Remove every row this run created (and any stray rows under the test request key).
  const values = new Set([...created.requests, ...(requestKey ? (await store.loadValueRows(requestKey)).map((r) => r.myapp_tbl_moei_requestid) : [])]);
  const entries = new Set([...created.reviews, ...(requestKey ? (await store.loadEntries(requestKey)).map((e) => e.myapp_tbl_moei_dgadminapprovalid) : [])]);
  for (const id of values) await call('DELETE', `myapp_tbl_moei_requests(${id})`);
  for (const id of entries) await call('DELETE', `myapp_tbl_moei_dgadminapprovals(${id})`);
  const left = requestKey ? (await store.loadValueRows(requestKey)).length + (await store.loadEntries(requestKey)).length : 0;
  console.log(`cleanup: deleted ${values.size} value row(s) and ${entries.size} review-log row(s); ${left} remaining`);
});

let dataset: Dataset;
let ref: RequestRef;
const versions = (s: RequestState) => Object.fromEntries(s.rows.map((r) => [r.myapp_tbl_moei_requestid, r.modifiedon]));
const valueOf = (s: RequestState, mapId: string, divId: string) =>
  s.rows.find((r) => r.myapp_attributemapid === mapId && rowDivisionId(r) === divId)?.myapp_attributevalue;

test('live request creation: one request row with the next REQ_ number; an attribute in only one open request', async () => {
  const [d1, d2] = dataset.divisions;
  // A division can select only attributes mapped to it (owned and shared).
  const first = await createRequest(store, dataset, d1, 'itest-d1', attributesFor(dataset, d1.id).map((a) => a.mapId));
  requestKey = first.requestKey;
  assert.match(requestKey, /^REQ_\d{4,}$/);
  const rows = await store.loadValueRows(requestKey);
  assert.equal(rows.length, 1);
  assert.equal(isRequestRow(rows[0]), true, 'creating a request writes only its request row');
  const [info] = requestsFromRows(rows, [dataset]);
  assert.deepEqual([info.datasetKey, info.requestedBy, info.requestingDivision, info.status], [TEST_DATASET_KEY, 'itest-d1', d1.name, 'In Progress']);
  console.log(`created request ${requestKey}`);

  // An attribute already in the open request (the shared one) cannot be requested again by the other division.
  const shared = attributesFor(dataset, d2.id).filter((a) => a.divisions.some((d) => d.id === d1.id));
  if (shared.length) {
    await assert.rejects(createRequest(store, dataset, d2, 'itest-d2', shared.map((a) => a.mapId)), (e: WorkflowError) => e.kind === 'conflict');
  }
  // The alternate key refuses a second request row with the same Request ID.
  await assert.rejects(insert('myapp_tbl_moei_requests', {
    myapp_requestid: requestKey, myapp_datasetid: TEST_DATASET_KEY, myapp_attributemapid: rows[0].myapp_attributemapid, myapp_divisionname: rows[0].myapp_divisionname,
  }), (e: WorkflowError) => e.kind === 'conflict');
  ref = { info, dataset };
});

/** Fill every attribute a division owns (required on submit). */
/** Values for every attribute of division `d` in the test request (the first division's attributes, owned and shared). */
const fill = (d: Division, prefix: string) =>
  Object.fromEntries(attributesFor(dataset, d.id).filter((a) => a.divisions.some((x) => x.id === dataset.divisions[0].id)).map((a, i) => [a.mapId, `${prefix}${i + 1}`]));

test('live user details: signed-in account resolves to one active record', async () => {
  const users = (await call('GET', 'myapp_tbl_moei_userdetailses?$select=myapp_tbl_moei_userdetailsid,myapp_username,myapp_usermailid,myapp_userdesignation,myapp_userrole,statecode')).value as UserRow[];
  const upn = execSync('az account show --query user.name -o tsv').toString().trim();
  const r = resolveUser(users, upn);
  console.log(`user details: ${users.length} rows; signed-in account resolves to`, JSON.stringify(r));
  assert.equal(r.kind, 'ok');
});

test(`live mapping: dataset ${datasetNumber} resolves to real attributes and divisions`, async () => {
  const users = (await call('GET', 'myapp_tbl_moei_userdetailses?$select=myapp_userdesignation,myapp_userrole,statecode&$filter=statecode eq 0')).value as UserRow[];
  const divisions = divisionsFromUsers(users);
  const maps = (await call('GET', `myapp_tbl_moei_datasetandbusinessmaps?$select=myapp_tbl_moei_datasetandbusinessmapid,myapp_datasetnumber,myapp_datasetname,myapp_attributename,myapp_businessdivision,myapp_unit,statecode&$filter=statecode eq 0 and myapp_datasetnumber eq ${datasetNumber}`)).value as MapRow[];
  const real = buildDatasets(maps, divisions)[0];
  assert.ok(real, 'dataset found in mapping');
  assert.equal(real.issues.length, 0, real.issues.join(' '));
  assert.ok(real.divisions.length >= 2, 'test needs a dataset with at least two divisions');
  dataset = { ...real, key: TEST_DATASET_KEY, name: `ITEST ${real.name}` };
  console.log(`dataset "${real.name}": ${real.attributes.length} attributes, divisions ${real.divisions.map((d) => d.name).join(', ')}`);
});


test('live division workflow and DG Admin review: comments, clarifications, decision', async () => {
  const [d1, d2] = dataset.divisions;
  const shared = dataset.attributes.find((a) => a.divisions.some((d) => d.id === d1.id) && a.divisions.some((d) => d.id === d2.id));
  assert.ok(shared, 'dataset has an attribute shared by the first two divisions');
  const d1Only = dataset.attributes.find((a) => a.divisions.length === 1 && a.divisions[0].id === d1.id);

  // Draft for division 1, then reload from Dataverse; division 2 sees it (read-only for them).
  let s = await writeDivisionPortion(store, ref, d1, 'itest-d1', { [shared.mapId]: '100', ...(d1Only ? { [d1Only.mapId]: '1200' } : {}) }, {}, 'draft');
  s = await loadState(store, ref);
  assert.equal(valueOf(s, shared.mapId, d1.id), '100', 'draft persisted in Dataverse and visible to every participating division');
  assert.equal(s.portions.find((p) => p.division.id === d1.id)!.status, 'Draft');
  assert.ok(s.rows.every((r) => r.myapp_requestid === requestKey), 'values are linked to the Request ID');

  // Division 2 saves its own value for the same shared attribute.
  s = await writeDivisionPortion(store, ref, d2, 'itest-d2', { [shared.mapId]: '200' }, versions(s), 'draft');
  assert.equal(valueOf(s, shared.mapId, d1.id), '100');
  assert.equal(valueOf(s, shared.mapId, d2.id), '200');

  // Division 1 cannot write division 2's attribute-only values; stale versions are refused.
  const d2Only = dataset.attributes.find((a) => a.divisions.length === 1 && a.divisions[0].id === d2.id);
  if (d2Only) await assert.rejects(writeDivisionPortion(store, ref, d1, 'itest-d1', { [d2Only.mapId]: '9' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'forbidden');
  const stale = versions(s);
  s = await writeDivisionPortion(store, ref, d1, 'itest-d1', { [shared.mapId]: '110' }, stale, 'draft');
  await assert.rejects(writeDivisionPortion(store, ref, d1, 'itest-d1', { [shared.mapId]: '120' }, stale, 'draft'), (e: WorkflowError) => e.kind === 'conflict');

  // Submit with a blank required value is refused and writes nothing.
  await assert.rejects(writeDivisionPortion(store, ref, d1, 'itest-d1', { ...fill(d1, 'v'), [shared.mapId]: '' }, versions(s), 'submit'), (e: WorkflowError) => e.kind === 'validation');
  assert.ok((await store.loadValueRows(requestKey)).filter((r) => !isRequestRow(r)).every((r) => r.myapp_submissionstatus === 'Draft'), 'nothing submitted');

  // Division 1 submits and is locked; DG Admin cannot decide yet.
  s = await writeDivisionPortion(store, ref, d1, 'itest-d1', { ...fill(d1, 'v'), [shared.mapId]: '110' }, versions(s), 'submit');
  assert.ok(s.rows.filter((r) => rowDivisionId(r) === d1.id).every((r) => r.myapp_submissionstatus === 'Submitted' && r.myapp_submittedby === 'itest-d1' && r.myapp_submittedon));
  assert.equal(s.overall, 'In Progress');
  await assert.rejects(writeDivisionPortion(store, ref, d1, 'itest-d1', { [shared.mapId]: '999' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'locked');
  await assert.rejects(writeDecision(store, ref, 'itest-admin', 'Approved', ''), (e: WorkflowError) => e.kind === 'locked');

  // Remaining divisions submit -> Pending DG Admin Review (also recorded on the request row).
  for (const d of s.portions.map((p) => p.division).filter((d) => d.id !== dataset.divisions[0].id)) {
    const values = fill(d, 'w');
    if (d.id === d2.id) values[shared.mapId] = '200';
    s = await writeDivisionPortion(store, ref, d, `itest-${d.name}`, values, versions(s), 'submit');
  }
  assert.equal(s.overall, 'Pending DG Admin Review');
  assert.equal((await store.loadValueRows(requestKey)).find(isRequestRow)?.myapp_reviewstatus, 'Pending Review', 'status recorded on the request row');
  const submittedValues = JSON.stringify(s.rows.map((r) => [r.myapp_tbl_moei_requestid, r.myapp_attributevalue, r.modifiedon]).sort());

  // Comments are appended and kept.
  await writeComment(store, ref, 'itest-admin', 'first comment');
  s = await writeComment(store, ref, 'itest-admin2', 'second comment');
  assert.deepEqual(s.comments.map((c) => [c.text, c.by]), [['first comment', 'itest-admin'], ['second comment', 'itest-admin2']]);

  // Clarification on division 2's value of the shared attribute only.
  s = await writeClarificationRequest(store, ref, 'itest-admin', shared.mapId, d2.id, 'Please explain 200');
  let c = s.clarifications.find((x) => x.mapId === shared.mapId && x.divisionId === d2.id)!;
  assert.deepEqual([c.status, c.submittedValue, c.divisionName, c.key], ['Pending Response', '200', d2.name, EntryKeys.clarification(requestKey, shared.mapId, d2.id, 1)]);
  await assert.rejects(writeClarificationRequest(store, ref, 'itest-admin', shared.mapId, d2.id, 'again'), (e: WorkflowError) => e.kind === 'conflict');
  await assert.rejects(writeDecision(store, ref, 'itest-admin', 'Approved', ''), (e: WorkflowError) => e.kind === 'validation');

  // Only division 2 can answer; DG Admin asks a follow-up, then resolves both.
  await assert.rejects(writeClarificationResponse(store, ref, d1, 'itest-d1', c.id, 'not ours', c.modifiedon), (e: WorkflowError) => e.kind === 'forbidden');
  s = await writeClarificationResponse(store, ref, d2, 'itest-d2', c.id, 'It includes imports', c.modifiedon);
  c = s.clarifications.find((x) => x.id === c.id)!;
  assert.deepEqual([c.status, c.response, c.respondedBy], ['Responded', 'It includes imports', 'itest-d2']);
  s = await writeClarificationRequest(store, ref, 'itest-admin', shared.mapId, d2.id, 'Which imports?');
  let f = s.clarifications.find((x) => x.key === EntryKeys.clarification(requestKey, shared.mapId, d2.id, 2))!;
  s = await writeClarificationResponse(store, ref, d2, 'itest-d2', f.id, 'Pipeline gas', f.modifiedon);
  for (const id of [c.id, f.id]) {
    const x = s.clarifications.find((y) => y.id === id)!;
    s = await writeClarificationResolve(store, ref, 'itest-admin', x.id, x.modifiedon);
  }
  c = s.clarifications.find((x) => x.id === c.id)!;
  f = s.clarifications.find((x) => x.id === f.id)!;
  assert.deepEqual([c.status, c.question, c.response, f.status, f.question], ['Resolved', 'Please explain 200', 'It includes imports', 'Resolved', 'Which imports?'], 'history preserved');

  // Values were never changed by the review.
  assert.equal(JSON.stringify(s.rows.map((r) => [r.myapp_tbl_moei_requestid, r.myapp_attributevalue, r.modifiedon]).sort()), submittedValues);

  // The Dataverse alternate key itself rejects a second decision row for the request.
  const rawDuplicate = { myapp_approvalid: EntryKeys.decision(requestKey), myapp_requestkey: requestKey, myapp_entrytype: 'Decision', myapp_datasetname: 'itest', myapp_status: 'Rejected' };
  created.reviews.push(await insert('myapp_tbl_moei_dgadminapprovals', rawDuplicate));
  await assert.rejects(insert('myapp_tbl_moei_dgadminapprovals', rawDuplicate), (e: WorkflowError) => e.kind === 'conflict');
  await call('DELETE', `myapp_tbl_moei_dgadminapprovals(${created.reviews.pop()})`);

  // Reject without a reason is refused; approve: one decision row, status recorded, values stay locked.
  await assert.rejects(writeDecision(store, ref, 'itest-admin', 'Rejected', ' '), (e: WorkflowError) => e.kind === 'validation');
  s = await writeDecision(store, ref, 'itest-admin', 'Approved', 'integration test');
  assert.equal(s.overall, 'Approved');
  assert.deepEqual([s.review?.by, s.review?.comments], ['itest-admin', 'integration test']);
  assert.equal((await store.loadValueRows(requestKey)).find(isRequestRow)?.myapp_reviewstatus, 'Approved', 'status recorded on the request row');
  await assert.rejects(writeDecision(store, ref, 'itest-admin', 'Rejected', 'late'), (e: WorkflowError) => e.kind === 'locked');
  await assert.rejects(writeDivisionPortion(store, ref, d2, 'itest-d2', { [shared.mapId]: '1' }, versions(s), 'draft'), (e: WorkflowError) => e.kind === 'locked');
});

test('live value key: a duplicate value row for the same request, attribute and division is refused (when the key is active)', async () => {
  const keys = (await call('GET', "EntityDefinitions(LogicalName='myapp_tbl_moei_request')/Keys?$select=SchemaName,EntityKeyIndexStatus")).value as { SchemaName: string; EntityKeyIndexStatus: string }[];
  const key = keys.find((k) => k.SchemaName.toLowerCase() === 'myapp_key_requestvalue');
  if (key?.EntityKeyIndexStatus !== 'Active') {
    console.log(`value key not active yet (${key?.EntityKeyIndexStatus ?? 'missing'}); skipping the raw duplicate check`);
    return;
  }
  const row = (await store.loadValueRows(requestKey)).find((r) => !isRequestRow(r));
  assert.ok(row);
  await assert.rejects(insert('myapp_tbl_moei_requests', {
    myapp_requestid: row.myapp_requestid, myapp_datasetid: row.myapp_datasetid, myapp_attributemapid: row.myapp_attributemapid, myapp_divisionname: row.myapp_divisionname, myapp_attributevalue: 'dup',
  }), (e: WorkflowError) => e.kind === 'conflict');
});
