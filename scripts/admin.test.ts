// Unit tests for the Admin Centre rules (src/data/admin.ts) and role-based navigation.
// Fixtures are test-only and are never used by the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDatasetPlan, datasetUsage, designationChoices, isKnownRole, nextUserId, roleChoices, divisionChoices, draftFromDataset, MAX_ATTRIBUTES, nextDatasetNumber, planDatasetSave, REFERENCE_SLOTS,
  validateDataset, validateUser, DatasetSaveError, type AttributeDraft, type DatasetDraft, type DatasetStore, type UserDraft,
} from '../src/data/admin.ts';
import { landingFor, navItemsFor } from '../src/components/nav.ts';
import { buildDatasets, datasetForDivision, divisionsFromUsers, resolveUser } from '../src/data/workflow.ts';
import type { MapRow, RequestInfo, UserRow, ValueRow } from '../src/data/types.ts';

let uid = 0;
const user = (mail: string, designation: string, role = 'BusinessDivision', statecode = 0): UserRow => ({
  myapp_tbl_moei_userdetailsid: `u${++uid}`, myapp_username: mail.split('@')[0], myapp_userid: `ID${uid}`, myapp_usermailid: mail,
  myapp_userdesignation: designation, myapp_userrole: role, statecode,
});
const USERS = [user('gen@x.com', 'Generation'), user('bde@x.com', 'BD&E'), user('dg@x.com', 'Admin', 'DG Admin'), user('it@x.com', 'IT', 'Admin')];
const DIVISIONS = divisionChoices(USERS);
const map = (id: string, attr: string, division: string, n = 1): MapRow => ({
  myapp_tbl_moei_datasetandbusinessmapid: id, myapp_datasetnumber: n, myapp_datasetname: 'Installed Capacity', myapp_attributename: attr, myapp_businessdivision: division, statecode: 0,
});
const MAP_ROWS = [map('steam', 'Steam Turbines', 'Generation'), map('gas', 'Natural Gas', 'Generation / BD&E'), map('solar', 'Solar PV', 'BD&E')];
const DATASETS = buildDatasets(MAP_ROWS, divisionsFromUsers(USERS));
let k = 0;
const attr = (name: string, divisions: string[], extra: Partial<AttributeDraft> = {}): AttributeDraft =>
  ({ key: `a${++k}`, name, description: '', unit: 'GWh', divisions, classification: '1', valueType: '0', comments: '', ...extra });
const draft = (attributes: AttributeDraft[], extra: Partial<DatasetDraft> = {}): DatasetDraft => ({ number: '40', name: 'Wind Generation', description: 'Wind output', attributes, ...extra });
const ctx = { datasets: DATASETS, references: [], divisions: DIVISIONS };

// ---------- Roles and navigation ----------

test('roles: DG Admin gets Dashboard, Review and Admin Centre; Admin gets only the Admin Centre; divisions never', () => {
  const admin = resolveUser(USERS, 'it@x.com');
  assert.equal(admin.kind === 'ok' && admin.isSystemAdmin, true);
  assert.equal(admin.kind === 'ok' && admin.isAdmin, false, 'Admin is not DG Admin');
  const dg = resolveUser(USERS, 'dg@x.com');
  assert.equal(dg.kind === 'ok' && dg.isAdmin && !dg.isSystemAdmin, true, 'DG Admin is not Admin');
  const keys = (s: Parameters<typeof navItemsFor>[0]) => navItemsFor(s).map((n) => n.key);
  assert.deepEqual(keys({ isAdmin: false, isSystemAdmin: true, division: null }), ['admin']);
  assert.deepEqual(keys({ isAdmin: true, isSystemAdmin: false, division: null }), ['dashboard', 'reviews', 'admin']);
  assert.deepEqual(keys({ isAdmin: false, isSystemAdmin: false, division: { id: 'generation', name: 'Generation' } }), ['dashboard', 'requests'], 'BusinessDivision never sees Admin Centre');
  assert.equal(resolveUser([user('odd@x.com', 'X', 'Superuser')], 'odd@x.com').kind, 'invalid', 'unknown roles still cannot sign in');
});

test('sign-in lands on the screen for the role on the user record', () => {
  assert.deepEqual(landingFor({ isAdmin: false, isSystemAdmin: false, division: { id: 'generation', name: 'Generation' } }), { key: 'dashboard', label: 'Division Dashboard' });
  assert.deepEqual(landingFor({ isAdmin: true, isSystemAdmin: false, division: null }), { key: 'dashboard', label: 'DG Admin Dashboard' });
  assert.deepEqual(landingFor({ isAdmin: false, isSystemAdmin: true, division: null }), { key: 'admin', label: 'Admin Centre' });
  const r = resolveUser(USERS, 'GEN@X.COM');
  assert.equal(r.kind === 'ok' && r.userId, USERS.find((u) => u.myapp_usermailid === 'gen@x.com')!.myapp_userid, 'User ID comes from the record');
});

test('division list comes from active BusinessDivision users; other divisions cannot be mapped', () => {
  assert.deepEqual(DIVISIONS.map((d) => [d.name, d.selectable]), [['BD&E', true], ['Generation', true]]);
  assert.deepEqual(divisionChoices([...USERS, user('old@x.com', 'TP', 'BusinessDivision', 1)]).map((d) => d.name), ['BD&E', 'Generation'], 'inactive users add no division');
});

// ---------- Dataset validation ----------

test('create: one attribute and many attributes validate; the dataset number defaults to the next free one', () => {
  assert.deepEqual(validateDataset(draft([attr('Onshore', ['Generation'])]), ctx), {});
  assert.deepEqual(validateDataset(draft(Array.from({ length: 12 }, (_, i) => attr(`Turbine ${i + 1}`, ['Generation']))), ctx), {});
  assert.equal(nextDatasetNumber(DATASETS, [{ myapp_tbl_moei_datasetwithattributesid: 'r', myapp_recordnumber: 31, statecode: 0 }]), 32);
});

test('create: duplicates, missing fields, unmappable divisions and the 45-attribute limit are refused', () => {
  const e = validateDataset(draft([attr('A', ['Generation']), attr(' a ', ['BD&E']), attr('', []), attr('T', ['TP'])], { number: '1', name: 'installed capacity' }), ctx);
  assert.match(e.number, /already used/);
  assert.match(e.name, /already exists/);
  const [, second, third, fourth] = Object.keys(e).filter((x) => x.startsWith('attr:')).map((x) => x);
  assert.ok(second && third && fourth);
  assert.ok(Object.entries(e).some(([key, v]) => key.endsWith(':name') && /more than one attribute/.test(v)), 'duplicate attribute names');
  assert.ok(Object.entries(e).some(([key, v]) => key.endsWith(':divisions') && /at least one/.test(v)), 'no division');
  assert.ok(Object.entries(e).some(([key, v]) => key.endsWith(':divisions') && /TP/.test(v)), 'division without users');
  const many = validateDataset(draft(Array.from({ length: MAX_ATTRIBUTES + 1 }, (_, i) => attr(`A${i}`, ['Generation']))), ctx);
  assert.match(many.attributes, new RegExp(`at most ${MAX_ATTRIBUTES}`));
  assert.equal(REFERENCE_SLOTS.length, 45);
  assert.match(validateDataset(draft([attr('A', ['Generation'])], { number: '0' }), ctx).number, /whole number/);
});

// ---------- Saving to both tables ----------

test('save plan: one mapping row per attribute (shared = every division), reference row with names in slot order', () => {
  const d = draft([attr('Onshore', ['Generation']), attr('Offshore', ['Generation', 'BD&E'], { classification: '', unit: '' })]);
  const plan = planDatasetSave(d, { mapRows: [] });
  assert.equal(plan.create.length, 2);
  assert.deepEqual(plan.create[1].fields, {
    myapp_datasetnumber: 40, myapp_datasetname: 'Wind Generation', myapp_datasetdescription: 'Wind output', myapp_attributename: 'Offshore',
    myapp_attributedescription: null, myapp_unit: null, myapp_businessdivision: 'Generation / BD&E', myapp_attributeclassification: null,
    myapp_attributevaluetype: 0, myapp_comments: null,
  });
  assert.equal(plan.reference!.id, undefined);
  assert.equal(plan.reference!.fields.myapp_recordnumber, 40);
  assert.equal(plan.reference!.fields.myapp_steamturbinesoutput, 'Onshore', 'Attribute 1');
  assert.equal(plan.reference!.fields.myapp_gasturbinesopencycleoutput, 'Offshore', 'Attribute 2');
  assert.equal(plan.reference!.fields.myapp_attribute45, null, 'unused slots are cleared');
});

test('a new shared attribute is visible to exactly the divisions it is mapped to', () => {
  const plan = planDatasetSave(draft([attr('Onshore', ['Generation']), attr('Offshore', ['Generation', 'BD&E']), attr('Hybrid', ['BD&E'])]), { mapRows: [] });
  const rows: MapRow[] = plan.create.map((c, i) => ({ myapp_tbl_moei_datasetandbusinessmapid: `n${i}`, ...c.fields, myapp_datasetdescription: c.fields.myapp_datasetdescription ?? undefined, myapp_attributedescription: undefined, myapp_unit: c.fields.myapp_unit ?? undefined, myapp_attributeclassification: c.fields.myapp_attributeclassification ?? undefined, myapp_attributevaluetype: c.fields.myapp_attributevaluetype ?? undefined, myapp_comments: undefined, statecode: 0 }));
  const ds = buildDatasets(rows, divisionsFromUsers(USERS))[0];
  assert.deepEqual(datasetForDivision(ds, 'generation').attributes.map((a) => a.name), ['Onshore', 'Offshore']);
  assert.deepEqual(datasetForDivision(ds, 'bd&e').attributes.map((a) => a.name), ['Offshore', 'Hybrid']);
  assert.deepEqual(ds.issues, [], 'no mapping issues');
});

/** Memory stand-in for the two dataset tables, with optional failure injection. */
function memoryDatasetStore(fail: { createMappingAt?: number; createReference?: boolean; deactivate?: boolean } = {}) {
  const mappings: (Record<string, unknown> & { id: string; statecode: number })[] = [];
  const references: Record<string, unknown>[] = [];
  let creates = 0;
  const store: DatasetStore = {
    createMapping: async (f) => {
      if (fail.createMappingAt === ++creates) throw new Error('network');
      mappings.push({ id: `m${mappings.length + 1}`, statecode: 0, ...f });
    },
    findNewMapping: async (n, name, known) => mappings.find((m) => m.statecode === 0 && m.myapp_datasetnumber === n && m.myapp_attributename === name && !known.has(m.id))?.id,
    updateMapping: async (id, f) => { Object.assign(mappings.find((m) => m.id === id)!, f); },
    deactivateMapping: async (id) => { if (fail.deactivate) throw new Error('denied'); mappings.find((m) => m.id === id)!.statecode = 1; },
    createReference: async (f) => { if (fail.createReference) throw new Error('reference denied'); references.push(f); },
    updateReference: async () => {},
  };
  return { store, mappings, references, active: () => mappings.filter((m) => m.statecode === 0) };
}

test('save: writes every mapping row and the reference row', async () => {
  const mem = memoryDatasetStore();
  const plan = planDatasetSave(draft([attr('Onshore', ['Generation']), attr('Offshore', ['Generation', 'BD&E'])]), { mapRows: [] });
  await applyDatasetPlan(mem.store, plan, { datasetNumber: 40, isNew: true, known: new Set() });
  assert.equal(mem.active().length, 2);
  assert.equal(mem.references.length, 1);
  assert.equal(mem.references[0].myapp_gasturbinesopencycleoutput, 'Offshore');
});

test('partial failure on a new dataset: rows already written are withdrawn, nothing stays visible', async () => {
  const mem = memoryDatasetStore({ createReference: true });
  const plan = planDatasetSave(draft([attr('Onshore', ['Generation']), attr('Offshore', ['Generation'])]), { mapRows: [] });
  await assert.rejects(applyDatasetPlan(mem.store, plan, { datasetNumber: 40, isNew: true, known: new Set() }), (e: DatasetSaveError) => /nothing was kept/.test(e.message) && e.kept.length === 0);
  assert.equal(mem.active().length, 0, 'both mapping rows were deactivated again');

  const mid = memoryDatasetStore({ createMappingAt: 2 });
  await assert.rejects(applyDatasetPlan(mid.store, plan, { datasetNumber: 40, isNew: true, known: new Set() }));
  assert.equal(mid.active().length, 0, 'the first row is withdrawn when the second fails');

  const stuck = memoryDatasetStore({ createReference: true, deactivate: true });
  await assert.rejects(applyDatasetPlan(stuck.store, plan, { datasetNumber: 40, isNew: true, known: new Set() }), (e: DatasetSaveError) => e.kept.length === 2 && /Remove/.test(e.message), 'rows that cannot be withdrawn are reported');
});

test('retrying an edit after a partial failure does not duplicate attributes', () => {
  // An earlier attempt created "Offshore" before failing; the form still has it as new (no mapId).
  const existing: MapRow[] = [map('steam', 'Steam Turbines', 'Generation', 40), map('m9', 'Offshore', 'Generation', 40)];
  const plan = planDatasetSave(draft([attr('Steam Turbines', ['Generation'], { mapId: 'steam', unit: '' }), attr('Offshore', ['Generation'], { unit: '' })]), { mapRows: existing });
  assert.equal(plan.create.length, 0, 'the saved row is matched by name');
  assert.deepEqual(plan.deactivate, []);
});

// ---------- Editing and protection of existing data ----------

const ds1 = DATASETS[0];
const request = (key: string, selection: string[], extra: Partial<RequestInfo> = {}): RequestInfo => ({
  key, datasetKey: '1', selectedAttributes: selection, requestingDivision: 'Generation', ...extra,
});

test('usage: attributes in any request (any status) or with saved values are locked', () => {
  const values: ValueRow[] = [{ myapp_tbl_moei_requestid: 'v', myapp_requestid: 'REQ_9', myapp_datasetid: '1', myapp_attributemapid: 'solar', myapp_divisionname: 'BD&E' }];
  const usage = datasetUsage(ds1, [request('REQ_1', ['steam', 'gas'], { status: 'Rejected' })], values);
  assert.deepEqual(usage.requests, ['REQ_1']);
  assert.deepEqual([...usage.lockedAttributes].sort(), ['gas', 'solar', 'steam']);
  const requestRow: ValueRow = { myapp_tbl_moei_requestid: 'r', myapp_requestid: 'REQ_1', myapp_datasetid: '1', myapp_attributemapid: 'REQUEST', myapp_divisionname: 'REQUEST' };
  assert.equal(datasetUsage(ds1, [], [requestRow]).lockedAttributes.size, 0, 'a request row is not a saved value');
});

test('edit: unused attributes can change or be removed; used ones keep name, unit and divisions and cannot be removed', () => {
  const original = draftFromDataset(ds1, MAP_ROWS);
  const usage = datasetUsage(ds1, [request('REQ_1', ['steam'])], []);
  const editCtx = { ...ctx, original: { dataset: ds1, draft: original, usage } };
  const [steam, gas, solar] = original.attributes;
  // Unused: rename gas, move solar to Generation, add a new attribute — allowed.
  const ok = { ...original, attributes: [steam, { ...gas, name: 'Natural Gas (LNG)' }, { ...solar, divisions: ['Generation'] }, attr('Wind', ['BD&E'])] };
  assert.deepEqual(validateDataset(ok, editCtx), {});
  const plan = planDatasetSave(ok, { mapRows: MAP_ROWS });
  assert.equal(plan.create.length, 1);
  assert.deepEqual(plan.update.map((u) => u.mapId).sort(), ['gas', 'solar']);
  // Used: steam cannot be renamed, re-mapped or removed.
  const renamed = validateDataset({ ...original, attributes: [{ ...steam, name: 'Steam', divisions: ['BD&E'] }, gas, solar] }, editCtx);
  assert.match(renamed[`attr:${steam.key}:name`], /cannot be changed/);
  assert.match(renamed[`attr:${steam.key}:divisions`], /cannot be changed/);
  assert.match(validateDataset({ ...original, attributes: [gas, solar] }, editCtx).attributes, /Steam Turbines is used by a request/);
  // Removing an unused attribute deactivates its row (never deletes).
  assert.deepEqual(planDatasetSave({ ...original, attributes: [steam, gas] }, { mapRows: MAP_ROWS }).deactivate, ['solar']);
  assert.match(validateDataset({ ...original, number: '7' }, editCtx).number, /cannot be changed|already used/);
});

// ---------- Users ----------

const userDraft = (extra: Partial<UserDraft> = {}): UserDraft => ({ name: 'New Person', userId: 'BD100', mail: 'new@x.com', role: 'BusinessDivision', designation: 'Generation', active: true, ...extra });
const mapped = new Set(['generation', 'bd&e']);
const uctx = (selfId?: string) => ({ users: USERS, divisions: DIVISIONS, mappedDivisions: mapped, selfId });

test('users: add a BusinessDivision user with a division from the list; DG Admin and Admin need a designation', () => {
  assert.deepEqual(validateUser(userDraft(), uctx()), {});
  assert.deepEqual(validateUser(userDraft({ role: 'DG Admin', designation: 'Reviewer' }), uctx()), {});
  assert.deepEqual(validateUser(userDraft({ role: 'Admin', designation: 'IT' }), uctx()), {});
  assert.match(validateUser(userDraft({ designation: 'Finance' }), uctx()).designation, /Add new business division/, 'an unknown division needs the explicit "add new" choice');
  assert.deepEqual(validateUser(userDraft({ designation: 'Finance', newDivision: true }), uctx()), {}, 'a new business division may be added');
  assert.match(validateUser(userDraft({ designation: 'generation', newDivision: true }), uctx()).designation, /already exists/);
  assert.deepEqual(validateUser(userDraft({ role: 'Auditor', designation: 'Internal Audit' }), uctx()), {}, 'a new role and designation may be added');
  assert.match(validateUser(userDraft({ role: ' ' }), uctx()).role, /role/);
});

test('users: required fields, duplicate User ID and duplicate active sign-in address are refused', () => {
  const e = validateUser(userDraft({ name: ' ', userId: USERS[0].myapp_userid!, mail: 'GEN@x.com' }), uctx());
  assert.match(e.name, /Enter/);
  assert.match(e.userId, /already used/);
  assert.match(e.mail, /already has this sign-in address/);
  assert.match(validateUser(userDraft({ mail: 'a@x.com; b@x.com' }), uctx()).mail, /one valid email/);
  assert.equal(validateUser(userDraft({ mail: 'gen@x.com', active: false, id: 'other' }), uctx()).mail, undefined, 'an inactive record may share an address');
});

test('users: the last DG Admin or Admin cannot lose access, and nobody removes their own Admin Centre access', () => {
  // Only one manager: Sumit-style DG Admin.
  const dg = user('dg1@x.com', 'Admin', 'DG Admin');
  const onlyDg = [user('g@x.com', 'Generation'), dg];
  const ctxOne = { users: onlyDg, divisions: DIVISIONS, mappedDivisions: new Set<string>() };
  const demote = { id: dg.myapp_tbl_moei_userdetailsid, name: 'dg', userId: dg.myapp_userid!, mail: 'dg1@x.com', role: 'BusinessDivision', designation: 'Generation', active: true };
  assert.match(validateUser(demote, ctxOne).role, /last active DG Admin or Admin/);
  assert.match(validateUser({ ...demote, role: 'DG Admin', designation: 'Admin', active: false }, ctxOne).role, /last active/);
  assert.equal(validateUser({ ...demote, role: 'Admin', designation: 'IT' }, ctxOne).role, undefined, 'moving between DG Admin and Admin keeps access');
  // Two managers: the other may be changed, but not yourself.
  const it = user('it9@x.com', 'IT', 'Admin');
  const ctxTwo = { users: [...onlyDg, it], divisions: DIVISIONS, mappedDivisions: new Set<string>(), selfId: dg.myapp_tbl_moei_userdetailsid };
  assert.match(validateUser(demote, ctxTwo).role, /your own Admin Centre access/);
  assert.equal(validateUser({ id: it.myapp_tbl_moei_userdetailsid, name: 'it', userId: it.myapp_userid!, mail: 'it9@x.com', role: 'BusinessDivision', designation: 'Generation', active: true }, ctxTwo).role, undefined);
});

test('users: the last active user of a mapped division cannot leave it; moving divisions is otherwise allowed', () => {
  const gen = USERS[0];
  const move = { id: gen.myapp_tbl_moei_userdetailsid, name: 'gen', userId: gen.myapp_userid!, mail: 'gen@x.com', role: 'BusinessDivision', designation: 'BD&E', active: true };
  assert.match(validateUser(move, uctx()).designation, /no other active user/);
  const another = user('gen2@x.com', 'Generation');
  assert.equal(validateUser(move, { ...uctx(), users: [...USERS, another] }).designation, undefined);
});

test('an unchanged edit writes nothing, even when stored text has extra spaces or older dataset-name variations', () => {
  const rows: MapRow[] = [
    { ...map('cc', 'Combined  Cycle', 'Generation', 2), myapp_datasetname: 'Electricity Generation ', myapp_attributedescription: 'From  CC' },
    { ...map('st', 'Steam', 'Generation', 2), myapp_datasetname: 'Electricity Generation (old)' },
    { ...map('ng', 'Natural Gas', 'Generation / BD&E', 2), myapp_datasetname: 'Electricity Generation ' },
  ];
  const ds = buildDatasets(rows, divisionsFromUsers(USERS))[0];
  const original = draftFromDataset(ds, rows);
  const reference = { myapp_tbl_moei_datasetwithattributesid: 'ref2', myapp_recordnumber: 2, myapp_datasetname: 'Electricity Generation', myapp_steamturbinesoutput: 'Combined  Cycle', myapp_gasturbinesopencycleoutput: 'Steam', myapp_combinedcycleoutput: 'Natural Gas', statecode: 0 };
  const plan = planDatasetSave(original, { mapRows: rows, reference }, original);
  assert.deepEqual([plan.create, plan.update, plan.deactivate, plan.reference], [[], [], [], null]);
  // Renaming the dataset updates every row's dataset name; editing one description touches only that row.
  const edited = { ...original, name: 'Electricity Generation by Fuel', attributes: original.attributes.map((a) => (a.mapId === 'st' ? { ...a, description: 'Steam turbines' } : a)) };
  const p2 = planDatasetSave(edited, { mapRows: rows, reference }, original);
  assert.equal(p2.update.length, 3);
  assert.ok(p2.update.every((u) => u.fields.myapp_datasetname === 'Electricity Generation by Fuel'));
  assert.deepEqual(Object.keys(p2.update.find((u) => u.mapId === 'st')!.fields).sort(), ['myapp_attributedescription', 'myapp_datasetname']);
  assert.ok(!('myapp_attributename' in p2.update.find((u) => u.mapId === 'cc')!.fields), 'the double-spaced name is left as stored');
  assert.deepEqual(p2.reference, { id: 'ref2', fields: { myapp_datasetname: 'Electricity Generation by Fuel' } });
});

test('editing keeps the reference row layout: renamed attributes keep their column, removed ones are cleared, new ones fill free columns', () => {
  const rows: MapRow[] = [map('a', 'Alpha', 'Generation', 5), map('b', 'Beta', 'Generation', 5), map('c', 'Gamma', 'Generation', 5)];
  const ds = buildDatasets(rows, divisionsFromUsers(USERS))[0];
  const original = draftFromDataset(ds, rows);
  // The reference row lists the names in its own order, plus an old name no attribute has.
  const ref = { myapp_tbl_moei_datasetwithattributesid: 'r5', myapp_recordnumber: 5, myapp_datasetname: 'Short name', myapp_steamturbinesoutput: 'Gamma', myapp_gasturbinesopencycleoutput: 'Old', myapp_combinedcycleoutput: 'Alpha', myapp_solarthermaloutput: 'Beta', statecode: 0 };
  assert.equal(planDatasetSave(original, { mapRows: rows, reference: ref }, original).reference, null, 'unchanged: the row is left as it is');
  const [alpha, beta] = original.attributes;
  const edited = { ...original, attributes: [{ ...alpha, name: 'Alpha 2' }, beta, attr('Delta', ['Generation']), attr('Epsilon', ['Generation'])] };
  const plan = planDatasetSave(edited, { mapRows: rows, reference: ref }, original);
  assert.deepEqual(plan.reference!.fields, {
    myapp_combinedcycleoutput: 'Alpha 2',     // renamed in place
    myapp_steamturbinesoutput: 'Delta',       // Gamma removed; its column is reused by the first new attribute
    myapp_solarpvoutput: 'Epsilon',           // next free column
  });
  assert.deepEqual(plan.deactivate, ['c']);
});

test('User IDs are assigned per role (BD…, DGAD…, ADM…), and role/designation lists offer what exists', () => {
  const people = [user('a@x.com', 'Generation'), user('b@x.com', 'BD&E'), user('d@x.com', 'Admin', 'DG Admin'), user('q@x.com', 'Audit', 'Auditor')];
  people[0].myapp_userid = 'BD007'; people[1].myapp_userid = 'bd002'; people[2].myapp_userid = 'DGAD001'; people[3].myapp_userid = 'AUD004';
  assert.equal(nextUserId(people, 'BusinessDivision'), 'BD008');
  assert.equal(nextUserId(people, 'DG Admin'), 'DGAD002');
  assert.equal(nextUserId(people, 'Admin'), 'ADM001');
  assert.equal(nextUserId(people, 'Auditor'), 'AUD005', 'a new role uses its first letters');
  assert.deepEqual(roleChoices(people), ['BusinessDivision', 'DG Admin', 'Admin', 'Auditor']);
  assert.deepEqual(designationChoices(people), ['Admin', 'Audit'], 'designations of non-division users');
  assert.equal(isKnownRole('Auditor'), false, 'a role without screens is flagged in the form');
});
