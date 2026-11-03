// Application services: identity, user/role resolution, the dataset catalogue,
// requests, division drafts/submissions and the DG Admin review log (comments,
// clarifications, decisions). Every write re-resolves the signed-in user and
// re-reads Dataverse state before validating with the workflow rules.
import { getContext } from '@microsoft/power-apps/app';
import { createRecord, DataverseError, odataString, readTableColumns, retrieveAll, Tables, updateRecord, type SchemaTable } from './dataverse.ts';
import {
  checkColumns,
  classifyProbeError,
  REQUIRED_REQUEST_COLUMNS,
  REQUIRED_REVIEW_COLUMNS,
  REQUIRED_USER_COLUMNS,
  type SchemaCheck,
} from './schema.ts';
import {
  AdminValidationError, applyDatasetPlan, DatasetSaveError, datasetUsage, divisionChoices, draftFromDataset, nextDatasetNumber, nextUserId, planDatasetSave, REFERENCE_SLOTS, userFields, validateDataset, validateUser,
  type DatasetDraft, type DatasetStore, type ReferenceRow, type UserDraft,
} from './admin.ts';
import type { Attribute, Dataset, Division, MapRow, RequestInfo, RequestRef, RequestState, ReviewEntryRow, ReviewStatus, Session, UserIdentity, UserRow, ValueRow } from './types.ts';
import {
  createRequest,
  loadState,
  writeClarificationRequest,
  writeClarificationResolve,
  writeClarificationResponse,
  writeDecision,
  writeDivisionPortion,
  type CreateResult,
  type RequestStore,
} from './operations.ts';
import { buildDatasets, canManage, datasetForDivision, deriveRequestState, divisionsFromUsers, roleOf, splitDivisionText, mapRowIncludesDivision, normalize, requestableAttributes, requestForDivision, requestsFromRows, resolveUser, roleLabelOf, withDecisions, WorkflowError } from './workflow.ts';

const USER_COLUMNS = ['myapp_tbl_moei_userdetailsid', 'myapp_username', 'myapp_userid', 'myapp_usermailid', 'myapp_userdesignation', 'myapp_userrole', 'statecode'];
const MAP_COLUMNS = [
  'myapp_tbl_moei_datasetandbusinessmapid', 'myapp_datasetnumber', 'myapp_datasetname', 'myapp_datasetdescription',
  'myapp_attributename', 'myapp_attributedescription', 'myapp_unit', 'myapp_businessdivision',
  'myapp_attributevaluetype', 'myapp_attributeclassification', 'myapp_comments', 'statecode',
];
const VALUE_COLUMNS = ['myapp_tbl_moei_requestid', ...REQUIRED_REQUEST_COLUMNS, 'modifiedon', 'createdon'];
const ENTRY_COLUMNS = ['myapp_tbl_moei_dgadminapprovalid', ...REQUIRED_REVIEW_COLUMNS, 'modifiedon', 'createdon'];

const orFilter = (column: string, values: string[]) => values.map((v) => `${column} eq ${odataString(v)}`).join(' or ');

// ---------- Identity and access ----------

export type AccessResult =
  | { kind: 'ok'; session: Session }
  | { kind: 'no-identity' }
  | { kind: 'no-user'; user: UserIdentity }
  | { kind: 'inactive-user'; user: UserIdentity }
  | { kind: 'multiple-users'; user: UserIdentity; count: number }
  | { kind: 'invalid-user'; user: UserIdentity; reason: string }
  | { kind: 'schema-missing'; user: UserIdentity; table: string; columns: string[] }
  | { kind: 'schema-unavailable'; user: UserIdentity; table: string };

/**
 * The verified sign-in address, and nothing else, from the Power Apps host.
 * The host authenticates the user before the app loads and every Dataverse call
 * runs under that sign-in, so this address can't be typed in or spoofed from the
 * app. It is only the lookup key: name, User ID, role and designation all come
 * from tbl_MOEI_UserDetails (myapp_usermailid). Never replace this with an
 * address the user enters; an email match on its own is not authentication.
 */
export async function readIdentity(): Promise<UserIdentity | null> {
  const ctx = await getContext();
  const upn = ctx.user?.userPrincipalName?.trim();
  if (!upn) return null;
  return { fullName: upn, upn };
}

/** Candidate user records for this address (narrowed server-side, matched exactly client-side). */
async function loadUserRowsFor(upn: string): Promise<UserRow[]> {
  return retrieveAll<UserRow>(Tables.users, { select: USER_COLUMNS, filter: `contains(myapp_usermailid,${odataString(upn)})` });
}

/** Divisions that have an active division user. Reads no addresses. */
async function loadKnownDivisions(): Promise<Division[]> {
  const rows = await retrieveAll<UserRow>(Tables.users, {
    select: ['myapp_userdesignation', 'myapp_userrole', 'statecode'],
    filter: 'statecode eq 0',
  });
  return divisionsFromUsers(rows);
}

/** Display names (myapp_username) and role labels for the given sign-in addresses. */
async function loadPeople(upns: (string | undefined)[]): Promise<{ names: Record<string, string>; roles: Record<string, string> }> {
  const wanted = [...new Set(upns.filter((u): u is string => !!u).map(normalize))];
  const names: Record<string, string> = {};
  const roles: Record<string, string> = {};
  for (let i = 0; i < wanted.length; i += 20) {
    const rows = await retrieveAll<UserRow>(Tables.users, {
      select: ['myapp_username', 'myapp_usermailid', 'myapp_userrole', 'myapp_userdesignation'],
      filter: orFilter('myapp_usermailid', wanted.slice(i, i + 20)),
    });
    for (const r of rows) {
      if (!r.myapp_usermailid) continue;
      const key = normalize(r.myapp_usermailid);
      if (r.myapp_username) names[key] = r.myapp_username.trim();
      const role = roleLabelOf(r);
      if (role) roles[key] = role;
    }
  }
  return { names, roles };
}

const peopleIn = (s: RequestState) => [
  s.info.requestedBy,
  ...s.portions.map((p) => p.submittedBy),
  s.review?.by,
  ...s.clarifications.flatMap((c) => [c.askedBy, c.respondedBy, c.resolvedBy]),
];

/** Attach user-details display names and roles; a lookup failure only falls back to addresses. */
async function withNames(states: RequestState[]): Promise<RequestState[]> {
  try {
    const { names, roles } = await loadPeople(states.flatMap(peopleIn));
    return states.map((s) => ({ ...s, names, roles }));
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[names] lookup failed', e);
    return states;
  }
}

/**
 * Confirm the required columns exist on a table. Reads the table's column
 * metadata; if the host can't return metadata, falls back to a query selecting
 * the required columns. Only a definite "column not found" counts as missing —
 * connection or permission failures are reported as unavailable.
 */
async function checkTableSchema(table: SchemaTable, required: readonly string[]): Promise<SchemaCheck> {
  try {
    const columns = await readTableColumns(table);
    if (columns && columns.length > 0) return checkColumns(columns, required);
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[schema] ${table} metadata read failed, probing instead`, e);
  }
  try {
    await retrieveAll(Tables[table], { select: [...required], top: 1 });
    return { kind: 'ready' };
  } catch (e) {
    if (import.meta.env.DEV) console.error(`[schema] ${table} probe failed`, e);
    return classifyProbeError(e instanceof Error ? e.message : String(e), required);
  }
}

const TABLE_LABELS: Record<SchemaTable, string> = {
  users: 'tbl_MOEI_UserDetails',
  requests: 'tbl_MOEI_requests',
  reviews: 'tbl_MOEI_DGAdminApproval',
};
const SCHEMA_CHECKS: [SchemaTable, readonly string[]][] = [
  ['users', REQUIRED_USER_COLUMNS],
  ['requests', REQUIRED_REQUEST_COLUMNS],
  ['reviews', REQUIRED_REVIEW_COLUMNS],
];

async function resolveUserAccess(identity: UserIdentity): Promise<AccessResult> {
  const resolution = resolveUser(await loadUserRowsFor(identity.upn), identity.upn);
  switch (resolution.kind) {
    case 'none': return { kind: 'no-user', user: identity };
    case 'inactive': return { kind: 'inactive-user', user: identity };
    case 'multiple': return { kind: 'multiple-users', user: identity, count: resolution.count };
    case 'invalid': return { kind: 'invalid-user', user: identity, reason: resolution.reason };
    case 'ok': {
      // Display name and User ID come from tbl_MOEI_UserDetails (myapp_username, myapp_userid) only.
      const user = { ...identity, fullName: resolution.name ?? identity.upn, ...(resolution.userId && { userId: resolution.userId }) };
      return { kind: 'ok', session: { user, division: resolution.division, isAdmin: resolution.isAdmin, isSystemAdmin: !!resolution.isSystemAdmin, roleLabel: resolution.roleLabel, role: resolution.role, designation: resolution.designation } };
    }
  }
}

/** Entry-screen check: signed-in identity, required schema, then exactly one active user record. */
export async function resolveAccess(): Promise<AccessResult> {
  const user = await readIdentity();
  if (!user) return { kind: 'no-identity' };
  for (const [table, required] of SCHEMA_CHECKS) {
    const schema = await checkTableSchema(table, required);
    if (schema.kind === 'missing') return { kind: 'schema-missing', user, table: TABLE_LABELS[table], columns: schema.columns };
    if (schema.kind === 'unavailable') return { kind: 'schema-unavailable', user, table: TABLE_LABELS[table] };
  }
  return resolveUserAccess(user);
}

/** Re-resolve identity, role and division for a write; never trusts the session held in React state. */
async function currentSession(): Promise<Session> {
  let access: AccessResult;
  try {
    const user = await readIdentity();
    access = user ? await resolveUserAccess(user) : { kind: 'no-identity' };
  } catch (e) {
    throw e instanceof DataverseError ? e : new WorkflowError('forbidden', 'Your access could not be verified. Reload the app and try again.');
  }
  if (access.kind !== 'ok') throw new WorkflowError('forbidden', 'Your access could not be verified. Reload the app and try again.');
  return access.session;
}

async function requireAdmin(action: string): Promise<Session> {
  const session = await currentSession();
  if (!session.isAdmin) throw new WorkflowError('forbidden', `Only DG Admin users can ${action}.`);
  return session;
}

/** Admin Centre loads and writes: the caller is re-resolved from tbl_MOEI_UserDetails and must be DG Admin or Admin. */
async function requireSystemAdmin(action: string): Promise<Session> {
  const session = await currentSession();
  if (!canManage(session)) throw new WorkflowError('forbidden', `Only DG Admin and Admin users can ${action}.`);
  return session;
}

/** Division loads and writes, and the Business Division Assistant (assistantServices.ts): the caller must be a business division user. */
export async function requireDivision(action: string): Promise<{ session: Session; division: Division }> {
  const session = await currentSession();
  if (!session.division) throw new WorkflowError('forbidden', `Only business division users can ${action}.`);
  return { session, division: session.division };
}

// ---------- Data loading ----------

async function loadMapRows(keys?: string[]): Promise<MapRow[]> {
  if (!keys) return retrieveAll<MapRow>(Tables.mappings, { select: MAP_COLUMNS, filter: 'statecode eq 0' });
  const numbers = keys.filter((k) => /^\d+$/.test(k));
  const rows: MapRow[] = [];
  // Chunk to keep the OData filter short.
  for (let i = 0; i < numbers.length; i += 25) {
    const chunk = numbers.slice(i, i + 25);
    rows.push(...(await retrieveAll<MapRow>(Tables.mappings, {
      select: MAP_COLUMNS,
      filter: `statecode eq 0 and (${chunk.map((n) => `myapp_datasetnumber eq ${n}`).join(' or ')})`,
    })));
  }
  return rows;
}

async function loadByKeys<T>(table: string, column: string, select: string[], keys?: string[]): Promise<T[]> {
  if (!keys) return retrieveAll<T>(table, { select, filter: 'statecode eq 0' });
  const unique = [...new Set(keys.filter(Boolean))];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += 25) {
    rows.push(...(await retrieveAll<T>(table, { select, filter: `statecode eq 0 and (${orFilter(column, unique.slice(i, i + 25))})` })));
  }
  return rows;
}
/** tbl_MOEI_requests rows (request rows and value rows) of the given requests, or of every request. */
const loadValueRows = (requestKeys?: string[]) => loadByKeys<ValueRow>(Tables.requests, 'myapp_requestid', VALUE_COLUMNS, requestKeys);
/** tbl_MOEI_requests rows (request rows and value rows) of the given datasets, or of every dataset. */
const loadDatasetRows = (datasetKeys?: string[]) => loadByKeys<ValueRow>(Tables.requests, 'myapp_datasetid', VALUE_COLUMNS, datasetKeys);
const loadEntries = (requestKeys?: string[]) => loadByKeys<ReviewEntryRow>(Tables.reviews, 'myapp_requestkey', ENTRY_COLUMNS, requestKeys);

/** Every Request ID already used, active or not, so a new ID is never reused. */
async function loadUsedRequestKeys(): Promise<string[]> {
  const [rows, entries] = await Promise.all([
    retrieveAll<Pick<ValueRow, 'myapp_requestid'>>(Tables.requests, { select: ['myapp_requestid'] }),
    retrieveAll<Pick<ReviewEntryRow, 'myapp_requestkey'>>(Tables.reviews, { select: ['myapp_requestkey'] }),
  ]);
  return [...rows.map((r) => r.myapp_requestid ?? ''), ...entries.map((e) => e.myapp_requestkey ?? '')];
}

/** Derive the state of each request whose dataset is known. */
function statesFor(found: RequestInfo[], datasets: Dataset[], values: ValueRow[], entries: ReviewEntryRow[]): RequestState[] {
  const byKey = new Map(datasets.map((d) => [d.key, d]));
  const requests = withDecisions(found, entries);
  return requests
    .filter((r) => r.key && byKey.has(r.datasetKey))
    .map((r) => deriveRequestState({ info: r, dataset: byKey.get(r.datasetKey)! }, values, entries, requests.filter((x) => x.datasetKey === r.datasetKey)))
    .sort((a, b) => (b.info.createdOn ?? '').localeCompare(a.info.createdOn ?? ''));
}

/**
 * DG Admin sees the whole request. A division user sees only attributes mapped
 * to their division (owned or shared), every mapped division's value for those
 * (drafts included, read-only), and only clarifications addressed to them.
 */
function forViewer(state: RequestState, session: Session): RequestState {
  if (session.isAdmin) return state;
  return requestForDivision(state, session.division?.id ?? '');
}

const isMember = (session: Session, dataset: Dataset) => !!session.division && dataset.divisions.some((d) => d.id === session.division!.id);

/** Datasets with at least one attribute mapped to the division. */
async function loadDivisionDatasets(division: Division): Promise<Dataset[]> {
  // Server-side narrowing by division text, then exact token match client-side.
  const candidates = await retrieveAll<MapRow>(Tables.mappings, {
    select: MAP_COLUMNS,
    filter: `statecode eq 0 and contains(myapp_businessdivision,${odataString(division.name)})`,
  });
  const keys = [...new Set(candidates.filter((r) => mapRowIncludesDivision(r, division)).map((r) => (r.myapp_datasetnumber != null ? String(r.myapp_datasetnumber) : '')))].filter(Boolean);
  if (keys.length === 0) return [];
  return buildDatasets(await loadMapRows(keys), await loadKnownDivisions()).filter((d) => d.divisions.some((x) => x.id === division.id));
}

export interface CatalogueItem {
  /** The dataset limited to attributes mapped to the division (owned and shared). */
  dataset: Dataset;
  /** The division's attributes not yet in a request that is in progress, pending review or approved. */
  available: Attribute[];
}

export interface DivisionWorkspace {
  /** Datasets with at least one attribute mapped to the division: the Create New Request choices. */
  catalogue: CatalogueItem[];
  /** Requests the division takes part in (one of its attributes is in the request), newest first. */
  requests: RequestState[];
}

/** Dataset catalogue and requests for the signed-in division user. */
export async function loadDivisionWorkspace(session: Session): Promise<DivisionWorkspace> {
  const division = session.division;
  if (!division) return { catalogue: [], requests: [] };
  const datasets = await loadDivisionDatasets(division);
  if (datasets.length === 0) return { catalogue: [], requests: [] };
  const values = await loadDatasetRows(datasets.map((d) => d.key));
  const requests = requestsFromRows(values, datasets);
  const entries = requests.length ? await loadEntries(requests.map((r) => r.key)) : [];
  const all = (await withNames(statesFor(requests, datasets, values, entries))).map((s) => forViewer(s, session));
  const catalogue = datasets.map((dataset) => {
    const own = datasetForDivision(dataset, division.id);
    return { dataset: own, available: requestableAttributes(dataset, division.id, all) };
  });
  return { catalogue, requests: all.filter((r) => r.portions.some((p) => p.division.id === division.id)) };
}

async function loadDataset(key: string): Promise<Dataset> {
  const datasets = buildDatasets(await loadMapRows([key]), await loadKnownDivisions());
  const dataset = datasets.find((d) => d.key === key);
  if (!dataset) throw new WorkflowError('forbidden', 'This dataset was not found in the dataset mapping.');
  return dataset;
}

async function loadRequestRef(requestKey: string): Promise<RequestRef> {
  const rows = requestKey ? await loadValueRows([requestKey]) : [];
  const datasetKey = rows[0]?.myapp_datasetid;
  if (!datasetKey) throw new WorkflowError('forbidden', `Request ${requestKey} was not found.`);
  const dataset = await loadDataset(datasetKey);
  const info = requestsFromRows(rows, [dataset]).find((r) => r.key === requestKey);
  if (!info) throw new WorkflowError('forbidden', `Request ${requestKey} was not found.`);
  return { info, dataset };
}

// ---------- Store backed by the Power Apps SDK ----------

/** Run a create; an alternate-key violation becomes a conflict the operations understand. */
async function createOnce(table: string, row: object) {
  try {
    await createRecord(table, row);
  } catch (e) {
    if (e instanceof DataverseError && /duplicate|already exists|0x80060892/i.test(e.message)) {
      throw new WorkflowError('conflict', 'Someone else recorded this at the same time. Reload to see the latest.');
    }
    throw e;
  }
}

const sdkStore: RequestStore = {
  loadValueRows: (key) => loadValueRows([key]),
  loadDatasetRows: (key) => loadDatasetRows([key]),
  loadUsedRequestKeys,
  create: (row) => createOnce(Tables.requests, row),
  update: (id, changes) => updateRecord(Tables.requests, id, changes),
  loadEntries: (key) => loadEntries([key]),
  createEntry: (row) => createOnce(Tables.reviews, row),
  updateEntry: (id, changes) => updateRecord(Tables.reviews, id, changes),
};

const named = async (session: Session, state: RequestState) => forViewer((await withNames([state]))[0], session);

/** Load one request, enforcing that the caller may see it (a participating division or DG Admin). */
export async function loadRequest(session: Session, requestKey: string): Promise<RequestState> {
  const ref = await loadRequestRef(requestKey);
  if (!isMember(session, ref.dataset) && !session.isAdmin) throw new WorkflowError('forbidden', 'Your division does not take part in this request.');
  const state = await named(session, await loadState(sdkStore, ref));
  // A division sees a request only when one of its attributes is part of it.
  if (!session.isAdmin && !state.portions.some((p) => p.division.id === session.division?.id)) {
    throw new WorkflowError('forbidden', 'Your division does not take part in this request.');
  }
  return state;
}

// ---------- Request creation ----------

export interface CreateOutcome {
  datasetKey: string;
  datasetName: string;
  result?: CreateResult;
  error?: string;
}

/**
 * Create one request per selected dataset for the caller's division, covering
 * the selected attributes. Every division mapped to a selected attribute takes
 * part (a shared attribute brings in the other division too). Datasets and
 * attributes are re-checked against the mapping and the caller's division.
 */
export async function createRequests(items: { datasetKey: string; attributeIds: string[] }[]): Promise<CreateOutcome[]> {
  const { session, division } = await requireDivision('create requests');
  const allowed = new Map((await loadDivisionDatasets(division)).map((d) => [d.key, d]));
  const out: CreateOutcome[] = [];
  for (const { datasetKey, attributeIds } of items) {
    const dataset = allowed.get(datasetKey);
    if (!dataset) {
      out.push({ datasetKey, datasetName: datasetKey, error: 'This dataset is not mapped to your division.' });
      continue;
    }
    try {
      out.push({ datasetKey, datasetName: dataset.name, result: await createRequest(sdkStore, dataset, division, session.user.upn, attributeIds) });
    } catch (e) {
      out.push({ datasetKey, datasetName: dataset.name, error: e instanceof Error ? e.message : 'The request could not be created.' });
    }
  }
  return out;
}

// ---------- Division drafts, submissions and clarification responses ----------

/**
 * Save the current division's draft or submit its portion. Only rows owned by
 * the caller's division are created or updated; other divisions are untouched.
 */
export async function saveDivisionPortion(
  requestKey: string,
  values: Record<string, string>,
  loadedVersions: Record<string, string | undefined>,
  mode: 'draft' | 'submit',
): Promise<RequestState> {
  const { session, division } = await requireDivision('enter dataset values');
  const ref = await loadRequestRef(requestKey);
  return named(session, await writeDivisionPortion(sdkStore, ref, division, session.user.upn, values, loadedVersions, mode));
}

/** The responsible division answers a clarification. Submitted values are not changed. */
export async function respondToClarification(requestKey: string, clarificationId: string, response: string, loadedVersion: string | undefined): Promise<RequestState> {
  const { session, division } = await requireDivision('respond to clarifications');
  const ref = await loadRequestRef(requestKey);
  return named(session, await writeClarificationResponse(sdkStore, ref, division, session.user.upn, clarificationId, response, loadedVersion));
}

// ---------- DG Admin ----------

export interface AdminOverview {
  datasets: Dataset[];
  divisions: Division[];
  requests: RequestState[];
}

/** Every dataset, division and request, for the DG Admin dashboard and review queue. */
export async function loadAdminOverview(): Promise<AdminOverview> {
  await requireAdmin('open the DG Admin pages');
  const [mapRows, divisions, values, entries] = await Promise.all([loadMapRows(), loadKnownDivisions(), loadValueRows(), loadEntries()]);
  const datasets = buildDatasets(mapRows, divisions);
  const requests = requestsFromRows(values, datasets);
  return { datasets, divisions, requests: await withNames(statesFor(requests, datasets, values, entries)) };
}

export async function recordDecision(requestKey: string, decision: ReviewStatus, reason: string): Promise<RequestState> {
  const session = await requireAdmin('approve or reject requests');
  return named(session, await writeDecision(sdkStore, await loadRequestRef(requestKey), session.user.upn, decision, reason));
}

export async function requestClarification(requestKey: string, mapId: string, divisionId: string, question: string): Promise<RequestState> {
  const session = await requireAdmin('request clarifications');
  return named(session, await writeClarificationRequest(sdkStore, await loadRequestRef(requestKey), session.user.upn, mapId, divisionId, question));
}

export async function resolveClarification(requestKey: string, clarificationId: string, loadedVersion: string | undefined): Promise<RequestState> {
  const session = await requireAdmin('resolve clarifications');
  return named(session, await writeClarificationResolve(sdkStore, await loadRequestRef(requestKey), session.user.upn, clarificationId, loadedVersion));
}

/**
 * Fresh, complete request data for the final PDF report, read from Dataverse at
 * the moment of download. Only DG Admin, and only once a decision is recorded.
 */
export async function loadReportState(requestKey: string): Promise<RequestState> {
  const session = await requireAdmin('download request reports');
  const state = await named(session, await loadState(sdkStore, await loadRequestRef(requestKey)));
  if (!state.review) throw new WorkflowError('locked', 'The report is available once DG Admin has approved or rejected the request.');
  return state;
}

// ---------- Admin Centre (UserRole = Admin) ----------

const REFERENCE_COLUMNS = ['myapp_tbl_moei_datasetwithattributesid', 'myapp_recordnumber', 'myapp_datasetname', ...REFERENCE_SLOTS, 'statecode'];

export interface AdminCentreData {
  /** Datasets from the active mapping rows (the authoritative attribute list). */
  datasets: Dataset[];
  mapRows: MapRow[];
  /** Active tbl_MOEI_DatasetWithAttributes rows. */
  references: ReferenceRow[];
  /** Every user record, active and inactive. */
  users: UserRow[];
  /** Every request (from its request row, or rebuilt from value rows for older requests). */
  requests: RequestInfo[];
  /** Active tbl_MOEI_requests rows: request rows and value rows. */
  values: ValueRow[];
}

/** Everything the Admin Centre shows and checks against, read fresh from Dataverse. */
export async function loadAdminCentre(): Promise<AdminCentreData> {
  await requireSystemAdmin('open the Admin Centre');
  return readAdminCentre();
}

async function readAdminCentre(): Promise<AdminCentreData> {
  const [mapRows, references, users, values] = await Promise.all([
    loadMapRows(),
    retrieveAll<ReferenceRow>(Tables.references, { select: REFERENCE_COLUMNS, filter: 'statecode eq 0' }),
    retrieveAll<UserRow>(Tables.users, { select: USER_COLUMNS }),
    loadValueRows(),
  ]);
  const datasets = buildDatasets(mapRows, divisionsFromUsers(users.filter((u) => u.statecode === 0)));
  return { datasets, mapRows, references, users, requests: requestsFromRows(values, datasets), values };
}

const deactivate = (table: string, id: string) => updateRecord(table, id, { statecode: 1, statuscode: 2 });

/** The two dataset tables through the Power Apps SDK. */
const sdkDatasetStore: DatasetStore = {
  createMapping: (fields) => createRecord(Tables.mappings, fields),
  // The mapping table has no alternate key: find the row just created by dataset number and attribute name.
  findNewMapping: async (datasetNumber, name, known) => (await retrieveAll<MapRow>(Tables.mappings, {
    select: ['myapp_tbl_moei_datasetandbusinessmapid'],
    filter: `statecode eq 0 and myapp_datasetnumber eq ${datasetNumber} and myapp_attributename eq ${odataString(name)}`,
  })).map((r) => r.myapp_tbl_moei_datasetandbusinessmapid).find((id) => !known.has(id)),
  updateMapping: (id, fields) => updateRecord(Tables.mappings, id, fields),
  deactivateMapping: (id) => deactivate(Tables.mappings, id),
  createReference: (fields) => createRecord(Tables.references, fields),
  updateReference: (id, fields) => updateRecord(Tables.references, id, fields),
};

export interface DatasetSaveResult { datasetNumber: number; created: number; updated: number; removed: number }

/**
 * Create or update a dataset in both tables: one tbl_MOEI_DatasetAndBusinessMaps
 * row per attribute and the tbl_MOEI_DatasetWithAttributes row with the attribute
 * names in its 45 columns. The caller is re-checked as Admin and every rule is
 * re-validated against fresh data first; see applyDatasetPlan for partial failures.
 */
export async function saveDataset(draft: DatasetDraft, originalNumber?: number): Promise<DatasetSaveResult> {
  await requireSystemAdmin('manage datasets');
  const data = await readAdminCentre();
  const original = originalNumber != null ? data.datasets.find((d) => d.number === originalNumber) : undefined;
  // A dataset listed only in the reference table (no mapping rows yet) is completed rather than created.
  const referenceOnly = originalNumber != null && !original && data.references.some((r) => r.myapp_recordnumber === originalNumber);
  if (originalNumber != null && !original && !referenceOnly) throw new WorkflowError('conflict', 'This dataset was changed or removed by someone else. Reload and try again.');
  if (referenceOnly && Number(draft.number) !== originalNumber) throw new AdminValidationError({ number: 'The dataset number cannot be changed.' });
  const divisions = divisionChoices(data.users);
  const ctx = {
    datasets: data.datasets,
    references: data.references.filter((r) => r.myapp_recordnumber !== originalNumber),
    divisions,
    original: original && { dataset: original, draft: draftFromDataset(original, data.mapRows), usage: datasetUsage(original, data.requests, data.values) },
  };
  // A new dataset gets the next free number at the moment of saving (the form shows the expected one).
  if (!original && !referenceOnly) draft = { ...draft, number: String(nextDatasetNumber(data.datasets, data.references)) };
  const errors = validateDataset(draft, ctx);
  if (Object.keys(errors).length) throw new AdminValidationError(errors);

  const number = Number(draft.number);
  const ownRows = data.mapRows.filter((r) => r.myapp_datasetnumber === number && r.statecode === 0);
  const reference = data.references.find((r) => r.myapp_recordnumber === number);
  let plan;
  try {
    plan = planDatasetSave(draft, { mapRows: ownRows, reference }, ctx.original?.draft);
  } catch (e) {
    throw new AdminValidationError({ attributes: e instanceof Error ? e.message : 'The attributes cannot be stored in the reference table.' });
  }
  try {
    await applyDatasetPlan(sdkDatasetStore, plan, { datasetNumber: number, isNew: !original, known: new Set(data.mapRows.map((r) => r.myapp_tbl_moei_datasetandbusinessmapid)) });
  } catch (e) {
    throw e instanceof DatasetSaveError ? new WorkflowError('integrity', e.message) : e;
  }
  return { datasetNumber: number, created: plan.create.length, updated: plan.update.length, removed: plan.deactivate.length };
}

/** Create or update a user record in tbl_MOEI_UserDetails (identity → role and division; no passwords). */
export async function saveUser(input: UserDraft): Promise<{ userId: string; newDivision?: string }> {
  const session = await requireSystemAdmin('manage users');
  const data = await readAdminCentre();
  const existing = input.id ? data.users.find((u) => u.myapp_tbl_moei_userdetailsid === input.id) : undefined;
  if (input.id && !existing) throw new WorkflowError('conflict', 'This user was removed by someone else. Reload the list.');
  // User IDs are assigned by the app: the next free one for a new user, unchanged for an existing user.
  const draft: UserDraft = { ...input, userId: existing ? (existing.myapp_userid ?? input.userId) : nextUserId(data.users, input.role) };
  if (!draft.id && !draft.active) throw new AdminValidationError({ active: 'A new user is always created active.' });
  const self = data.users.find((u) => u.statecode === 0 && (u.myapp_usermailid ?? '').split(/[;,\s]+/).some((m) => normalize(m) === normalize(session.user.upn)));
  const mappedDivisions = new Set(data.mapRows.filter((r) => r.statecode === 0).flatMap((r) => splitDivisionText(r.myapp_businessdivision).map(normalize)));
  const errors = validateUser(draft, { users: data.users, divisions: divisionChoices(data.users), mappedDivisions, selfId: self?.myapp_tbl_moei_userdetailsid });
  if (Object.keys(errors).length) throw new AdminValidationError(errors);
  const fields = userFields(draft);
  // A new business division exists once this user is saved with it as their designation.
  const newDivision = draft.newDivision && roleOf(draft.role) === 'division' ? fields.myapp_userdesignation : undefined;
  if (!existing) await createRecord(Tables.users, fields);
  else {
    await updateRecord(Tables.users, existing.myapp_tbl_moei_userdetailsid, {
      ...fields,
      ...((existing.statecode === 0) !== draft.active ? { statecode: draft.active ? 0 : 1, statuscode: draft.active ? 1 : 2 } : {}),
    });
  }
  return { userId: fields.myapp_userid, newDivision };
}
