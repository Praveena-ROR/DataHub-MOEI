// Pure business rules. No Dataverse calls here so the rules can be unit tested
// (see scripts/*.test.ts) and reused by every write path.
import type {
  Attribute,
  Clarification,
  ClarificationStatus,
  Dataset,
  Division,
  DivisionPortion,
  DivisionStatus,
  MapRow,
  OverallStatus,
  RequestComment,
  RequestInfo,
  RequestRef,
  RequestState,
  ReviewEntryRow,
  ReviewStatus,
  UserRow,
  ValueRow,
} from './types.ts';

/** Dataverse column limit for myapp_attributevalue. */
export const VALUE_MAX_LENGTH = 100;

const VALUE_TYPES: Record<number, string> = { 0: 'Single', 1: 'LOVs', 2: 'Multiple' };
const CLASSIFICATIONS: Record<number, string> = { 0: 'Confidential', 1: 'Open', 2: 'Sensitive' };

export const normalize = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// ---------- Users, roles and divisions (myapp_tbl_moei_userdetails) ----------

/** Role values recognised in myapp_userrole (compared ignoring case and spaces). */
export const UserRoles = { DgAdmin: 'DG Admin', Division: 'BusinessDivision', Admin: 'Admin' } as const;
const roleKey = (s: string | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase();
/** `admin` = DG Admin (review and decisions); `system` = Admin (Admin Centre: datasets, attributes, users). */
export type RoleKind = 'admin' | 'system' | 'division' | 'unknown';
/** Who may use the Admin Centre (datasets, attributes, mappings, users): DG Admin and Admin. */
export const canManage = (session: { isAdmin: boolean; isSystemAdmin?: boolean }) => session.isAdmin || !!session.isSystemAdmin;
export const managesAdminCentre = (role: string | undefined) => roleOf(role) === 'admin' || roleOf(role) === 'system';

export const roleOf = (role: string | undefined): RoleKind => {
  const k = roleKey(role);
  return k === roleKey(UserRoles.DgAdmin) ? 'admin' : k === roleKey(UserRoles.Admin) ? 'system' : k === roleKey(UserRoles.Division) ? 'division' : 'unknown';
};

/** Division identity: the normalised division name shared by user rows, mapping text and value rows. */
export const toDivision = (name: string): Division => ({ id: normalize(name), name: name.replace(/\s+/g, ' ').trim() });

/** "<role> - <designation>" as recorded on the user record, e.g. "DG Admin - Admin". */
export const roleLabelOf = (row: UserRow) => [row.myapp_userrole?.trim(), row.myapp_userdesignation?.trim()].filter(Boolean).join(' - ');

/** Mail column may hold one address or a ; or , separated list. */
export const mailboxAddresses = (mail: string | undefined) =>
  (mail ?? '').split(/[;,\s]+/).map(normalize).filter(Boolean);

export type UserResolution =
  | { kind: 'ok'; division: Division | null; isAdmin: boolean; isSystemAdmin?: boolean; name?: string; userId?: string; roleLabel?: string; role?: string; designation?: string }
  | { kind: 'none' }
  | { kind: 'inactive' }
  | { kind: 'multiple'; count: number }
  | { kind: 'invalid'; reason: string };

/**
 * Resolve the signed-in user against myapp_tbl_moei_userdetails by exact
 * (case-insensitive) match of their sign-in address on myapp_usermailid.
 * Exactly one active record is required. Never guesses from names or substrings.
 */
export function resolveUser(rows: UserRow[], upn: string): UserResolution {
  const me = normalize(upn);
  if (!me) return { kind: 'none' };
  const matches = rows.filter((r) => mailboxAddresses(r.myapp_usermailid).includes(me));
  const active = matches.filter((r) => r.statecode === 0);
  if (active.length === 0) return matches.length ? { kind: 'inactive' } : { kind: 'none' };
  if (active.length > 1) return { kind: 'multiple', count: active.length };
  const row = active[0];
  const role = roleOf(row.myapp_userrole);
  const name = row.myapp_username?.trim() || undefined;
  // Shown as-is on the entry screen and profile card.
  const details = { ...(row.myapp_userid?.trim() && { userId: row.myapp_userid.trim() }), ...(row.myapp_userrole?.trim() && { role: row.myapp_userrole.trim() }), ...(row.myapp_userdesignation?.trim() && { designation: row.myapp_userdesignation.trim() }) };
  if (role === 'admin') {
    // Non-division roles are shown as "<role> - <designation>", both taken from the record.
    const roleLabel = roleLabelOf(row);
    return { kind: 'ok', division: null, isAdmin: true, ...(name && { name }), ...(roleLabel && { roleLabel }), ...details };
  }
  if (role === 'system') {
    // Admin manages datasets, attributes and users; it is not DG Admin and has no division.
    const roleLabel = roleLabelOf(row);
    return { kind: 'ok', division: null, isAdmin: false, isSystemAdmin: true, ...(name && { name }), ...(roleLabel && { roleLabel }), ...details };
  }
  if (role === 'division') {
    const divisionName = row.myapp_userdesignation?.trim();
    if (!divisionName) return { kind: 'invalid', reason: 'Your user record has no division assigned.' };
    return { kind: 'ok', division: toDivision(divisionName), isAdmin: false, ...(name && { name }), ...details };
  }
  return { kind: 'invalid', reason: `Your user record has an unrecognised role ("${row.myapp_userrole ?? ''}").` };
}

/** Divisions with at least one active division user — the valid targets for mapping text. */
export function divisionsFromUsers(rows: UserRow[]): Division[] {
  const out = new Map<string, Division>();
  for (const r of rows) {
    if (r.statecode !== 0 || roleOf(r.myapp_userrole) !== 'division' || !r.myapp_userdesignation?.trim()) continue;
    const d = toDivision(r.myapp_userdesignation);
    if (!out.has(d.id)) out.set(d.id, d);
  }
  return [...out.values()];
}

/** Split the mapping's free-text division (e.g. "Generation / BD&E"). */
export const splitDivisionText = (text: string | undefined) =>
  (text ?? '').split(/[/;,|]/).map((t) => t.trim()).filter(Boolean);

/** Match a mapping token to a known division by exact (normalised) name. */
export const matchDivision = (token: string, divisions: Division[]): Division | null =>
  divisions.find((d) => d.id === normalize(token)) ?? null;

/** Division key of a value row (stored in myapp_divisionname). */
export const rowDivisionId = (row: ValueRow) => normalize(row.myapp_divisionname);

// ---------- Datasets ----------

/** Dataset ID shown to users: the mapping's dataset number as DS-001, DS-018, ... (the bare key when there is no number). */
export const datasetId = (d: Pick<Dataset, 'number' | 'key'>) => (d.number != null ? `DS-${String(d.number).padStart(3, '0')}` : d.key);

export const datasetKeyOf = (row: MapRow) =>
  row.myapp_datasetnumber != null ? String(row.myapp_datasetnumber) : `name:${normalize(row.myapp_datasetname)}`;

/** Does this mapping row include the given division? (exact token match) */
export const mapRowIncludesDivision = (row: MapRow, division: Division) =>
  splitDivisionText(row.myapp_businessdivision).some((t) => normalize(t) === division.id);

const attributeIssues = (name: string, tokenCount: number, unresolved: string[]) => [
  ...(tokenCount === 0 ? [`Attribute "${name}" has no business division mapping.`] : []),
  ...(unresolved.length ? [`Attribute "${name}" maps to division(s) with no active user in tbl_MOEI_UserDetails: ${unresolved.join(', ')}.`] : []),
];

/** Group active mapping rows into datasets keyed by the stable dataset number. */
export function buildDatasets(mapRows: MapRow[], knownDivisions: Division[]): Dataset[] {
  const groups = new Map<string, MapRow[]>();
  for (const row of mapRows) {
    if (row.statecode !== 0) continue;
    const key = datasetKeyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const datasets: Dataset[] = [];
  for (const [key, rows] of groups) {
    const issues: string[] = [];
    const warnings: string[] = [];
    // Dataset names are not always identical across rows; use the most common one.
    const nameCounts = new Map<string, number>();
    for (const r of rows) {
      const n = (r.myapp_datasetname ?? '').replace(/\s+/g, ' ').trim();
      if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    }
    const names = [...nameCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (names.length > 1) warnings.push(`Mapping rows use different dataset names: ${names.map((n) => `"${n[0]}"`).join(', ')}.`);
    if (key.startsWith('name:')) warnings.push('Mapping rows have no dataset number; dataset is identified by name.');

    const seenAttr = new Set<string>();
    const attributes: Attribute[] = rows.map((r) => {
      const tokens = splitDivisionText(r.myapp_businessdivision);
      const divisions: Division[] = [];
      const unresolved: string[] = [];
      for (const t of tokens) {
        const d = matchDivision(t, knownDivisions);
        if (!d) unresolved.push(t);
        else if (!divisions.some((x) => x.id === d.id)) divisions.push(d);
      }
      const name = (r.myapp_attributename ?? '').replace(/\s+/g, ' ').trim() || '(unnamed attribute)';
      issues.push(...attributeIssues(name, tokens.length, unresolved));
      if (seenAttr.has(normalize(name))) warnings.push(`Attribute "${name}" appears more than once in the mapping.`);
      seenAttr.add(normalize(name));
      return {
        mapId: r.myapp_tbl_moei_datasetandbusinessmapid,
        name,
        description: r.myapp_attributedescription?.trim() || undefined,
        unit: r.myapp_unit?.trim() || undefined,
        valueType: r.myapp_attributevaluetype != null ? VALUE_TYPES[r.myapp_attributevaluetype] : undefined,
        classification: r.myapp_attributeclassification != null ? CLASSIFICATIONS[r.myapp_attributeclassification] : undefined,
        divisions,
        unresolved,
      };
    });

    const divisions: Division[] = [];
    for (const a of attributes) for (const d of a.divisions) if (!divisions.some((x) => x.id === d.id)) divisions.push(d);

    const descr = rows.map((r) => r.myapp_datasetdescription?.trim()).find(Boolean);
    const classifications = [...new Set(attributes.map((a) => a.classification).filter((c): c is string => !!c))].sort();
    datasets.push({
      key,
      number: rows[0].myapp_datasetnumber ?? undefined,
      name: names[0]?.[0] ?? '(unnamed dataset)',
      description: descr,
      attributes,
      classifications,
      divisions,
      issues,
      warnings,
    });
  }
  return datasets.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.name.localeCompare(b.name));
}

const latest = (dates: (string | undefined)[]) =>
  dates.filter((d): d is string => !!d).sort().at(-1);

/** Attributes the division owns within a dataset. */
export const attributesFor = (dataset: Dataset, divisionId: string) =>
  dataset.attributes.filter((a) => a.divisions.some((d) => d.id === divisionId));

const rowKey = (mapId: string | undefined, divisionId: string) => `${mapId}|${divisionId}`;

// ---------- DG Admin review log (myapp_tbl_moei_dgadminapproval) ----------

/** Maximum length of comments, questions, responses and reasons (column limits). */
export const TEXT_MAX_LENGTH = 2000;

/** Unique entry keys stored in myapp_approvalid (an alternate key in Dataverse). */
export const EntryKeys = {
  decision: (key: string) => `${key}:DECISION`,
  clarification: (key: string, mapId: string, divisionId: string, n: number) => `${key}:CLR:${mapId}:${divisionId}:${n}`,
  comment: (key: string, stamp: string) => `${key}:CMT:${stamp}`,
};

const isType = (e: ReviewEntryRow, type: string) => normalize(e.myapp_entrytype) === normalize(type);
const CLARIFICATION_STATUSES: ClarificationStatus[] = ['Pending Response', 'Responded', 'Resolved'];

export function toClarification(e: ReviewEntryRow): Clarification {
  const status = CLARIFICATION_STATUSES.find((s) => normalize(s) === normalize(e.myapp_status)) ?? 'Pending Response';
  return {
    id: e.myapp_tbl_moei_dgadminapprovalid,
    key: e.myapp_approvalid ?? '',
    mapId: e.myapp_attributemapid ?? '',
    attributeName: e.myapp_attributename ?? '',
    divisionId: normalize(e.myapp_divisionname),
    divisionName: e.myapp_divisionname ?? '',
    submittedValue: e.myapp_submittedvalue ?? '',
    question: e.myapp_comments ?? '',
    status,
    askedBy: e.myapp_reviewedby,
    askedOn: e.myapp_reviewedon || e.createdon,
    response: e.myapp_response,
    respondedBy: e.myapp_respondedby,
    respondedOn: e.myapp_respondedon,
    resolvedBy: e.myapp_resolvedby,
    resolvedOn: e.myapp_resolvedon,
    modifiedon: e.modifiedon,
  };
}

/** Open clarifications block approval; only Resolved ones are closed. */
export const isOpen = (c: Clarification) => c.status !== 'Resolved';

// ---------- Requests ----------

/** Divisions owning the dataset, e.g. "Generation / BD&E". */
export const divisionListText = (dataset: Dataset) => dataset.divisions.map((d) => d.name).join(' / ');

/**
 * Request rows. There is no separate request table: each request has one row in
 * tbl_MOEI_requests that records the request itself, with the marker in both
 * myapp_attributemapid and myapp_divisionname. The table's alternate key
 * (myapp_requestid, myapp_attributemapid, myapp_divisionname) therefore allows
 * only one request row per Request ID, so two requests never share an ID.
 * On the request row:
 *   myapp_requestid       Request ID (REQ_0001, ...)
 *   myapp_datasetid/name  the dataset
 *   myapp_submittedby/on  who raised it and when
 *   myapp_divisionid      the requesting division
 *   myapp_reviewcomments  mapping IDs of the selected attributes, comma separated
 *   myapp_attributevalue  participating divisions, for people browsing the table
 *   myapp_reviewstatus    overall status as last recorded (the app re-derives it)
 */
export const RequestRows = { marker: 'REQUEST', label: 'Request' } as const;
export const isRequestRow = (r: Pick<ValueRow, 'myapp_attributemapid'>) => r.myapp_attributemapid === RequestRows.marker;

const REQUEST_KEY = /^REQ_(\d+)$/i;
/** The next Request ID after every ID already used: REQ_ and the number, at least four digits. */
export const nextRequestKey = (used: (string | undefined)[]) =>
  `REQ_${String(Math.max(0, ...used.map((k) => Number(REQUEST_KEY.exec((k ?? '').trim())?.[1] ?? 0))) + 1).padStart(4, '0')}`;

/** Status as stored on the request row (myapp_reviewstatus holds at most 20 characters). */
const STORED_STATUS: Record<OverallStatus, string> = { 'In Progress': 'In Progress', 'Pending DG Admin Review': 'Pending Review', Approved: 'Approved', Rejected: 'Rejected' };
export const storedStatus = (status: OverallStatus) => STORED_STATUS[status];
const statusFromStored = (value: string | undefined) => (Object.keys(STORED_STATUS) as OverallStatus[]).find((k) => normalize(STORED_STATUS[k]) === normalize(value));

const splitIds = (text: string | undefined) => (text ?? '').split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);

/** The request recorded on a request row. */
export const requestInfoFromRow = (row: ValueRow): RequestInfo => ({
  key: (row.myapp_requestid ?? '').trim(),
  datasetKey: row.myapp_datasetid,
  requestedBy: row.myapp_submittedby?.trim() || undefined,
  requestingDivision: row.myapp_divisionid?.trim() || undefined,
  selectedAttributes: splitIds(row.myapp_reviewcomments),
  status: statusFromStored(row.myapp_reviewstatus) ?? (row.myapp_reviewstatus || undefined),
  createdOn: row.myapp_submittedon || row.createdon,
  rowId: row.myapp_tbl_moei_requestid,
});

/**
 * The requests in a set of tbl_MOEI_requests rows (request rows and value rows
 * mixed). A Request ID with a request row is read from it. A Request ID with
 * value rows only was created before request rows existed; who raised it and its
 * selection are not recorded anywhere. Every attribute of a request is mapped to
 * the division that raised it, so that division is one mapped to every attribute
 * with a saved value; the request covers all attributes of those divisions (as a
 * request created without a selection does) plus every saved attribute. This
 * does not change as other divisions save their shared values. When no division
 * is mapped to all saved attributes (older requests stored other divisions'
 * attributes), it covers the attributes of every division that saved values.
 * Who raised it stays unknown.
 */
export function requestsFromRows(rows: ValueRow[], datasets: Dataset[]): RequestInfo[] {
  const groups = new Map<string, ValueRow[]>();
  for (const r of rows) {
    const key = (r.myapp_requestid ?? '').trim();
    if (key) groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: RequestInfo[] = [];
  for (const [key, group] of groups) {
    const requestRow = group.find(isRequestRow);
    if (requestRow) {
      out.push(requestInfoFromRow(requestRow));
      continue;
    }
    const datasetKey = group[0].myapp_datasetid;
    const dataset = datasets.find((d) => d.key === datasetKey);
    const ids = new Set(group.map((r) => r.myapp_attributemapid).filter((id): id is string => !!id));
    const saved = dataset?.attributes.filter((a) => ids.has(a.mapId)) ?? [];
    const requesters = saved.reduce<Set<string> | null>((acc, a) => new Set(a.divisions.map((d) => d.id).filter((id) => !acc || acc.has(id))), null);
    const divisions = requesters?.size ? requesters : new Set(group.map(rowDivisionId));
    for (const a of dataset?.attributes ?? []) if (a.divisions.some((d) => divisions.has(d.id))) ids.add(a.mapId);
    const inDataset = dataset?.attributes.map((a) => a.mapId).filter((id) => ids.has(id)) ?? [];
    out.push({
      key,
      datasetKey,
      selectedAttributes: [...inDataset, ...[...ids].filter((id) => !inDataset.includes(id))],
      createdOn: group.map((r) => r.createdon).filter((d): d is string => !!d).sort()[0],
      legacy: true,
    });
  }
  return out;
}

/** Use the recorded DG Admin decision as each request's status (the request row may lag behind). */
export const withDecisions = (requests: RequestInfo[], entries: ReviewEntryRow[]): RequestInfo[] =>
  requests.map((r) => {
    const decision = entries.find((e) => e.myapp_requestkey === r.key && isType(e, 'Decision'));
    const status = decision && (['Approved', 'Rejected'] as const).find((x) => normalize(x) === normalize(decision.myapp_status));
    return status ? { ...r, status } : r;
  });

/**
 * Can this division start a new request for the dataset? The dataset must still
 * be mapped to the division and have attributes, and the selection (when given)
 * must be attributes of the dataset mapped to the division.
 */
export function assertCanCreateRequest(dataset: Dataset, divisionId: string, attributeIds?: string[]) {
  if (!dataset.divisions.some((d) => d.id === divisionId)) {
    throw new WorkflowError('forbidden', `${dataset.name} is not mapped to your division.`);
  }
  if (dataset.attributes.length === 0) throw new WorkflowError('validation', `${dataset.name} has no mapped attributes.`);
  if (attributeIds) {
    if (attributeIds.length === 0) throw new WorkflowError('validation', `Select at least one attribute of ${dataset.name}.`);
    const unknown = attributeIds.filter((id) => !dataset.attributes.some((a) => a.mapId === id));
    if (unknown.length) throw new WorkflowError('validation', `Some selected attributes are no longer part of ${dataset.name}. Reload and select again.`);
    // Only attributes mapped to the caller's division (its own or shared with it) may be selected.
    const foreign = dataset.attributes.filter((a) => attributeIds.includes(a.mapId) && !a.divisions.some((d) => d.id === divisionId));
    if (foreign.length) throw new WorkflowError('validation', `You can only select ${dataset.name} attributes mapped to your division. Not mapped to your division: ${foreign.map((a) => a.name).join(', ')}.`);
  }
}

/**
 * Mapping IDs a request covers: its stored selection (the whole dataset when
 * none is stored), limited to attributes mapped to the division that raised it.
 * Another division takes part only through attributes it shares with the
 * requesting division, never with its own exclusive attributes (it requests
 * those itself). Older requests stored such attributes; an attribute that
 * already has saved values in the request (`rows`) is kept, so entered data is
 * never hidden. Requests without a known requesting division keep their selection.
 */
export function requestAttributeIds(info: RequestInfo, dataset: Dataset, rows: ValueRow[] = []): string[] {
  const ids = info.selectedAttributes;
  const base = ids.length ? ids : dataset.attributes.map((a) => a.mapId);
  const requester = normalize(info.requestingDivision);
  if (!requester || !dataset.attributes.some((a) => a.divisions.some((d) => d.id === requester))) return base;
  const saved = new Set(rows.filter((r) => info.key && r.myapp_requestid === info.key && !isRequestRow(r)).map((r) => r.myapp_attributemapid));
  return base.filter((id) => {
    const a = dataset.attributes.find((x) => x.mapId === id);
    // Unknown IDs are kept so the "no longer in the mapping" check below still reports them.
    return !a || a.divisions.some((d) => d.id === requester) || saved.has(id);
  });
}

/** A request holds its attributes unless DG Admin rejected it (rejected attributes can be requested again). */
const holdsAttributes = (r: RequestInfo) => normalize(r.status) !== normalize('Rejected');

const createdBefore = (a: RequestInfo, b: RequestInfo) =>
  (a.createdOn ?? '') < (b.createdOn ?? '') || ((a.createdOn ?? '') === (b.createdOn ?? '') && a.key < b.key);

export interface AttributeConflict {
  mapId: string;
  attributeName: string;
  requestKey: string;
}

/**
 * Attributes from `mapIds` that another request for the same dataset already
 * covers (in progress, pending review or approved). With `current` given, only
 * requests created before it count, so of two overlapping requests the later one is flagged.
 */
export function attributeConflicts(mapIds: string[], dataset: Dataset, siblings: RequestInfo[], current?: RequestInfo, rows: ValueRow[] = []): AttributeConflict[] {
  const out: AttributeConflict[] = [];
  for (const h of siblings) {
    if (h.datasetKey !== dataset.key || !holdsAttributes(h) || !h.key) continue;
    if (current && (h.key === current.key || !createdBefore(h, current))) continue;
    const covered = new Set(requestAttributeIds(h, dataset, rows));
    for (const id of mapIds) {
      if (covered.has(id) && !out.some((c) => c.mapId === id)) {
        out.push({ mapId: id, attributeName: dataset.attributes.find((a) => a.mapId === id)?.name ?? id, requestKey: h.key });
      }
    }
  }
  return out;
}

/**
 * The part of the dataset a request covers: its selected attributes and the
 * divisions mapped to them. A division takes part in the request only when one
 * of the selected attributes is mapped to it (e.g. a shared attribute brings in
 * every division that shares it). Requests without a selection cover the whole dataset.
 */
export function scopeDataset(dataset: Dataset, info: RequestInfo, rows: ValueRow[] = []): Dataset {
  const ids = requestAttributeIds(info, dataset, rows);
  if (info.selectedAttributes.length === 0 && ids.length === dataset.attributes.length) return dataset;
  const attributes = dataset.attributes.filter((a) => ids.includes(a.mapId));
  const divisions: Division[] = [];
  for (const a of attributes) for (const d of a.divisions) if (!divisions.some((x) => x.id === d.id)) divisions.push(d);
  const issues = attributes.flatMap((a) => attributeIssues(a.name, a.divisions.length + a.unresolved.length, a.unresolved));
  const missing = ids.length - attributes.length;
  if (missing > 0) issues.push(`${missing} attribute(s) selected for this request are no longer in the dataset mapping.`);
  const classifications = [...new Set(attributes.map((a) => a.classification).filter((c): c is string => !!c))].sort();
  return { ...dataset, attributes, divisions, classifications, issues };
}

/**
 * Derive division portions and the overall status from the value rows and the
 * DG Admin review log. This is the single submission gate used by every screen
 * and write path.
 */
export function deriveRequestState(request: RequestRef, allRows: ValueRow[], allEntries: ReviewEntryRow[] = [], siblings: RequestInfo[] = []): RequestState {
  const { info } = request;
  const dataset = scopeDataset(request.dataset, info, allRows);
  const key = info.key.trim();
  const rows = key ? allRows.filter((r) => r.myapp_requestid === key && !isRequestRow(r)) : [];
  const entries = key ? allEntries.filter((e) => e.myapp_requestkey === key) : [];
  const issues = [...dataset.issues];
  if (!key) issues.push('This request has no Request ID yet.');
  if (info.datasetKey && info.datasetKey !== request.dataset.key) issues.push('This request belongs to a different dataset.');
  for (const r of rows) {
    if (r.myapp_datasetid !== dataset.key) issues.push(`A saved value for "${r.myapp_attribute ?? 'unknown attribute'}" belongs to a different dataset.`);
  }

  // Duplicate value rows for the same attribute and division.
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = rowKey(r.myapp_attributemapid, rowDivisionId(r));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, n] of counts) {
    if (n > 1) {
      const [mapId, divId] = k.split('|');
      const attr = dataset.attributes.find((a) => a.mapId === mapId)?.name ?? mapId;
      const div = dataset.divisions.find((d) => d.id === divId)?.name ?? divId;
      issues.push(`Duplicate values exist for "${attr}" (${div}).`);
    }
  }
  // Rows that no longer match the mapping (attribute removed or re-assigned).
  for (const r of rows) {
    const attr = dataset.attributes.find((a) => a.mapId === r.myapp_attributemapid);
    if (!attr || !attr.divisions.some((d) => d.id === rowDivisionId(r))) {
      issues.push(`A saved value for "${r.myapp_attribute ?? 'unknown attribute'}" (${r.myapp_divisionname ?? 'unknown division'}) no longer matches the dataset mapping.`);
    }
  }

  const portions: DivisionPortion[] = dataset.divisions.map((division) => {
    const own = rows.filter((r) => rowDivisionId(r) === division.id);
    const owned = attributesFor(dataset, division.id);
    const submittedRows = own.filter((r) => r.myapp_submissionstatus === 'Submitted');
    // A value counts only when it is Submitted and not blank; a Draft or a blank value keeps the division outstanding.
    const done = (a: Attribute) => own.some((r) => r.myapp_attributemapid === a.mapId && r.myapp_submissionstatus === 'Submitted' && !!(r.myapp_attributevalue ?? '').trim());
    const outstanding = owned.filter((a) => !done(a)).map((a) => a.name);
    const complete = owned.length > 0 && outstanding.length === 0;
    const status: DivisionStatus = own.length === 0 ? 'Pending' : complete ? 'Submitted' : 'Draft';
    if (!complete && submittedRows.length > 0) {
      issues.push(`${division.name}'s submission is incomplete (${outstanding.join(', ')}). ${division.name} must complete these values and select Submit again.`);
    }
    return {
      division,
      status,
      complete,
      total: owned.length,
      submittedCount: owned.length - outstanding.length,
      outstanding,
      submittedBy: submittedRows[0]?.myapp_submittedby,
      submittedOn: latest(submittedRows.map((r) => r.myapp_submittedon)),
      lastUpdated: latest(own.map((r) => r.modifiedon)),
    };
  });

  const decisionRows = entries.filter((e) => isType(e, 'Decision'));
  const decisionValues = new Set(decisionRows.map((e) => normalize(e.myapp_status)));
  let review: RequestState['review'];
  if (decisionValues.size > 1) issues.push('Conflicting DG Admin decisions are recorded on this request.');
  else if (decisionRows.length > 0) {
    const d = decisionRows[0];
    const status = (['Approved', 'Rejected'] as const).find((x) => normalize(x) === normalize(d.myapp_status));
    if (status) review = { status, by: d.myapp_reviewedby, on: d.myapp_reviewedon || d.createdon, comments: d.myapp_comments };
    else issues.push(`An unrecognised DG Admin decision ("${d.myapp_status ?? ''}") is recorded on this request.`);
  }

  // An attribute already covered by an earlier request for the dataset (two creates at the same moment) is a duplicate.
  if (!review) {
    for (const c of attributeConflicts(dataset.attributes.map((a) => a.mapId), request.dataset, siblings, info)) {
      issues.push(`"${c.attributeName}" is already part of request ${c.requestKey}. Ask an administrator to close this duplicate request.`);
    }
  }

  const byDate = (a?: string, b?: string) => (a ?? '').localeCompare(b ?? '');
  const clarifications = entries.filter((e) => isType(e, 'Clarification')).map(toClarification).sort((a, b) => byDate(a.askedOn, b.askedOn));
  const comments: RequestComment[] = entries
    .filter((e) => isType(e, 'Comment'))
    .map((e) => ({ id: e.myapp_tbl_moei_dgadminapprovalid, text: e.myapp_comments ?? '', by: e.myapp_reviewedby, on: e.myapp_reviewedon || e.createdon }))
    .sort((a, b) => byDate(a.on, b.on));

  const allSubmitted = portions.length > 0 && portions.every((p) => p.complete);
  let overall: OverallStatus;
  if (review) overall = review.status;
  // Any data-integrity problem keeps the request out of the review queue.
  else if (allSubmitted && issues.length === 0) overall = 'Pending DG Admin Review';
  else overall = 'In Progress';

  return {
    key, info, dataset, rows, portions, overall, review, clarifications, comments, issues,
    warnings: dataset.warnings,
    lastUpdated: latest([...rows.map((r) => r.modifiedon), ...entries.map((e) => e.modifiedon)]),
  };
}

/** Whether the division may still change its own values. */
export function canDivisionEdit(state: RequestState, divisionId: string): boolean {
  if (state.review || state.overall === 'Approved' || state.overall === 'Rejected' || state.overall === 'Pending DG Admin Review') return false;
  const portion = state.portions.find((p) => p.division.id === divisionId);
  return !!portion && !portion.complete;
}

export class WorkflowError extends Error {
  readonly kind: 'forbidden' | 'locked' | 'conflict' | 'integrity' | 'validation';
  constructor(kind: WorkflowError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface PlannedWrite {
  create: { attribute: Attribute; value: string }[];
  update: { row: ValueRow; value: string }[];
}

/**
 * Attributes owned by the division that would be blank after this write. Every
 * owned attribute needs a value before the division can submit; drafts may be
 * partial. Values already submitted (locked) are not re-checked.
 */
export function missingRequiredValues(state: RequestState, divisionId: string, values: Record<string, string>): Attribute[] {
  return attributesFor(state.dataset, divisionId).filter((a) => {
    const row = state.rows.find((r) => r.myapp_attributemapid === a.mapId && rowDivisionId(r) === divisionId);
    if (row?.myapp_submissionstatus === 'Submitted' && (row.myapp_attributevalue ?? '').trim()) return false;
    const value = Object.prototype.hasOwnProperty.call(values, a.mapId) ? values[a.mapId] : row?.myapp_attributevalue;
    return !(value ?? '').trim();
  });
}

/**
 * Validate and plan a division write against freshly loaded Dataverse state.
 * Rejects writes to attributes the division does not own, locked portions,
 * blank required values on submit, stale rows (edited elsewhere since the form
 * was loaded) and duplicates.
 */
export function planDivisionWrite(
  state: RequestState,
  divisionId: string,
  values: Record<string, string>,
  loadedVersions: Record<string, string | undefined>,
  mode: 'draft' | 'submit',
): PlannedWrite {
  const portion = state.portions.find((p) => p.division.id === divisionId);
  if (!portion) throw new WorkflowError('forbidden', 'Your division is not mapped to any attribute of this dataset.');
  if (!canDivisionEdit(state, divisionId)) throw new WorkflowError('locked', 'Your division has already submitted this dataset, or it is under DG Admin review. Values can no longer be changed.');
  if (state.issues.some((i) => i.startsWith('Duplicate values'))) throw new WorkflowError('integrity', 'Duplicate values were found for this dataset. Ask an administrator to remove the duplicates before saving.');

  const owned = attributesFor(state.dataset, divisionId);
  for (const mapId of Object.keys(values)) {
    if (!owned.some((a) => a.mapId === mapId)) throw new WorkflowError('forbidden', 'You can only change values for attributes mapped to your division.');
  }

  if (mode === 'submit') {
    const missing = missingRequiredValues(state, divisionId, values);
    if (missing.length) {
      throw new WorkflowError('validation', `Enter a value for every attribute before submitting. Missing: ${missing.map((a) => a.name).join(', ')}.`);
    }
  }

  const plan: PlannedWrite = { create: [], update: [] };
  for (const attribute of owned) {
    const row = state.rows.find((r) => r.myapp_attributemapid === attribute.mapId && rowDivisionId(r) === divisionId);
    const submittedRow = row?.myapp_submissionstatus === 'Submitted';
    const has = Object.prototype.hasOwnProperty.call(values, attribute.mapId);
    const value = (has ? values[attribute.mapId] : row?.myapp_attributevalue ?? '').trim();
    if (value.length > VALUE_MAX_LENGTH) throw new WorkflowError('validation', `"${attribute.name}" is longer than ${VALUE_MAX_LENGTH} characters.`);

    if (row) {
      if (loadedVersions[row.myapp_tbl_moei_requestid] !== row.modifiedon) {
        throw new WorkflowError('conflict', `"${attribute.name}" was changed in another session since you opened this dataset. Reload to see the latest values.`);
      }
      if (submittedRow) {
        const stored = (row.myapp_attributevalue ?? '').trim();
        if (stored) {
          // Submitted values are locked; only a blank (incomplete) submitted value may still be completed.
          if (has && value !== stored) throw new WorkflowError('locked', `"${attribute.name}" was already submitted and cannot be changed.`);
          continue;
        }
        if (mode === 'submit' || value) plan.update.push({ row, value });
        continue;
      }
      if (mode === 'submit' || value !== (row.myapp_attributevalue ?? '').trim()) plan.update.push({ row, value });
    } else if (mode === 'submit' || value) {
      // Drafts only create rows for entered values; submit records every owned attribute.
      plan.create.push({ attribute, value });
    }
  }
  return plan;
}

const requireText = (text: string, what: string) => {
  const t = text.trim();
  if (!t) throw new WorkflowError('validation', `Enter ${what}.`);
  if (t.length > TEXT_MAX_LENGTH) throw new WorkflowError('validation', `Keep ${what} to ${TEXT_MAX_LENGTH} characters or fewer.`);
  return t;
};

const assertUndecided = (state: RequestState) => {
  if (state.review || state.overall === 'Approved' || state.overall === 'Rejected') {
    throw new WorkflowError('locked', 'A DG Admin decision has already been recorded for this request.');
  }
};

/**
 * DG Admin may decide only when every participating division has submitted and
 * there are no mapping problems; approval also needs every clarification resolved.
 * One decision per request (also enforced by the myapp_approvalid alternate key).
 */
/**
 * Plain-language reasons the request can't go to DG Admin review yet, one per
 * outstanding division (plus data issues). Empty when every participating
 * division has submitted every value.
 */
export function outstandingReasons(state: RequestState): string[] {
  const out = state.portions.filter((p) => !p.complete).map((p) => {
    if (p.outstanding.length === 0) return notFinished(p.division.name);
    if (p.status === 'Pending') return `${p.division.name} has not started (${p.total} value${p.total === 1 ? '' : 's'} to submit).`;
    return `${p.division.name} has submitted ${p.submittedCount} of ${p.total} value${p.total === 1 ? '' : 's'}; still outstanding: ${p.outstanding.join(', ')}.`;
  });
  return [...out, ...state.issues.filter((i) => !/submission is incomplete/.test(i))];
}

/** Sentence used when a division's outstanding attributes are hidden from the viewer. */
const notFinished = (name: string) => `${name} has not submitted all of its values yet.`;

const uniqueDivisions = (attributes: Attribute[]) => {
  const out: Division[] = [];
  for (const a of attributes) for (const d of a.divisions) if (!out.some((x) => x.id === d.id)) out.push(d);
  return out;
};

/**
 * Remove notes that name an attribute or division the viewer may not see,
 * replacing them with one neutral sentence so progress is still explained.
 */
const withoutHidden = (notes: string[], hiddenTerms: string[], replacement: string) => {
  const kept = notes.filter((n) => !hiddenTerms.some((t) => t && n.includes(t)));
  return kept.length < notes.length ? [...kept, replacement] : kept;
};

/**
 * The dataset as a business division sees it: only attributes mapped to the
 * division (owned, or shared with it). Attributes owned exclusively by other
 * divisions are removed, together with any note that names them.
 */
export function datasetForDivision(dataset: Dataset, divisionId: string): Dataset {
  const attributes = attributesFor(dataset, divisionId);
  const hidden = dataset.attributes.filter((a) => !attributes.includes(a)).map((a) => a.name);
  return {
    ...dataset,
    attributes,
    divisions: uniqueDivisions(attributes),
    classifications: [...new Set(attributes.map((a) => a.classification).filter((c): c is string => !!c))].sort(),
    issues: withoutHidden(dataset.issues, hidden, 'Some attributes of other divisions have mapping problems.'),
    warnings: withoutHidden(dataset.warnings, hidden, 'Some attributes of other divisions have mapping notes.'),
  };
}

/**
 * A request as a business division sees it. Attributes and values are limited
 * to attributes mapped to the division; for a shared attribute every mapped
 * division's value is kept (drafts included, read-only for others). Values of
 * attributes exclusive to other divisions, and clarifications addressed to other
 * divisions, are removed. The overall status is kept as derived from the full
 * request, and other divisions' progress is summarised without naming hidden attributes.
 */
export function requestForDivision(state: RequestState, divisionId: string): RequestState {
  const dataset = datasetForDivision(state.dataset, divisionId);
  const visible = new Set(dataset.attributes.map((a) => a.mapId));
  const hiddenAttrs = state.dataset.attributes.filter((a) => !visible.has(a.mapId)).map((a) => a.name);
  const hiddenDivs = state.portions.filter((p) => !dataset.divisions.some((d) => d.id === p.division.id)).map((p) => p.division.name);
  const portions = state.portions
    .filter((p) => dataset.divisions.some((d) => d.id === p.division.id))
    .map((p) => {
      if (p.division.id === divisionId) return p;
      const names = new Set(attributesFor(dataset, p.division.id).map((a) => a.name));
      const outstanding = p.outstanding.filter((n) => names.has(n));
      const total = names.size;
      return { ...p, total, outstanding, submittedCount: Math.max(0, total - outstanding.length) };
    });
  const othersPending = state.portions.some((p) => !p.complete && hiddenDivs.includes(p.division.name));
  const issues = withoutHidden(state.issues, [...hiddenAttrs, ...hiddenDivs], 'Some values from other divisions need attention before DG Admin review.');
  return {
    ...state,
    dataset,
    rows: state.rows.filter((r) => visible.has(r.myapp_attributemapid ?? '')),
    portions,
    clarifications: state.clarifications.filter((c) => c.divisionId === divisionId),
    issues: othersPending && !state.review ? [...issues, 'Other participating divisions are still completing their part.'] : issues,
    warnings: withoutHidden(state.warnings, hiddenAttrs, 'Some attributes of other divisions have mapping notes.'),
  };
}

export function assertReviewable(state: RequestState, decision: ReviewStatus) {
  assertUndecided(state);
  // Re-checked here, not only via the derived status: every division complete, no data issues.
  const reasons = outstandingReasons(state);
  if (reasons.length) throw new WorkflowError('locked', `This request can't be reviewed yet. ${reasons.join(' ')}`);
  if (state.overall !== 'Pending DG Admin Review') throw new WorkflowError('locked', 'This request is not awaiting DG Admin review.');
  const open = state.clarifications.filter(isOpen);
  if (open.length) {
    throw new WorkflowError('validation', `Resolve every clarification before ${decision === 'Approved' ? 'approving' : 'rejecting'}. ${open.length} clarification${open.length === 1 ? ' is' : 's are'} still open.`);
  }
}

export interface PlannedClarification {
  approvalId: string;
  attribute: Attribute;
  divisionName: string;
  submittedValue: string;
  question: string;
}

/**
 * Validate a clarification request for one attribute value of one division.
 * The value must be submitted. A new question (or a follow-up to an answered
 * one) is refused while an earlier question is still awaiting the division's
 * response. Submitted values are never changed or unlocked.
 */
export function planClarification(state: RequestState, mapId: string, divisionId: string, question: string): PlannedClarification {
  assertUndecided(state);
  const attribute = state.dataset.attributes.find((a) => a.mapId === mapId);
  if (!attribute) throw new WorkflowError('forbidden', 'This attribute is not part of the request.');
  const division = attribute.divisions.find((d) => d.id === divisionId);
  if (!division) throw new WorkflowError('forbidden', `${attribute.name} is not mapped to that division.`);
  const row = state.rows.find((r) => r.myapp_attributemapid === mapId && rowDivisionId(r) === divisionId);
  if (row?.myapp_submissionstatus !== 'Submitted') throw new WorkflowError('validation', `${division.name} has not submitted a value for ${attribute.name} yet.`);
  const existing = state.clarifications.filter((c) => c.mapId === mapId && c.divisionId === divisionId);
  if (existing.some((c) => c.status === 'Pending Response')) {
    throw new WorkflowError('conflict', `${division.name} has not answered the earlier question on ${attribute.name} yet. Wait for the response before asking again.`);
  }
  return {
    approvalId: EntryKeys.clarification(state.key, mapId, divisionId, existing.length + 1),
    attribute,
    divisionName: division.name,
    submittedValue: row.myapp_attributevalue ?? '',
    question: requireText(question, 'a clarification question'),
  };
}

const findClarification = (state: RequestState, id: string) => {
  const c = state.clarifications.find((x) => x.id === id);
  if (!c) throw new WorkflowError('forbidden', 'This clarification was not found on the request.');
  return c;
};

/** The responsible division answers a pending clarification once; the answer is kept. */
export function planClarificationResponse(state: RequestState, id: string, divisionId: string, response: string, loadedVersion: string | undefined) {
  const c = findClarification(state, id);
  if (c.divisionId !== divisionId) throw new WorkflowError('forbidden', 'Only the division responsible for this value can respond.');
  assertUndecided(state);
  if (c.modifiedon !== loadedVersion || c.status !== 'Pending Response') {
    throw new WorkflowError('conflict', 'This clarification was already answered or changed. Reload to see the latest.');
  }
  return { clarification: c, response: requireText(response, 'a response') };
}

/** DG Admin closes a responded clarification. */
export function planClarificationResolve(state: RequestState, id: string, loadedVersion: string | undefined) {
  const c = findClarification(state, id);
  assertUndecided(state);
  if (c.status === 'Pending Response') throw new WorkflowError('validation', 'This clarification has not been answered yet.');
  if (c.modifiedon !== loadedVersion || c.status !== 'Responded') {
    throw new WorkflowError('conflict', 'This clarification was already resolved or changed. Reload to see the latest.');
  }
  return c;
}

/** Request-level DG Admin comment; earlier comments are never changed. */
export const validateComment = (text: string) => requireText(text, 'a comment');

/** Decision reason: required to reject, optional approval comment. */
export function validateReason(text: string, decision: ReviewStatus) {
  const t = text.trim();
  if (decision === 'Rejected' && !t) throw new WorkflowError('validation', 'Enter the reason for rejecting this request.');
  if (t.length > TEXT_MAX_LENGTH) throw new WorkflowError('validation', `Keep the reason to ${TEXT_MAX_LENGTH} characters or fewer.`);
  return t;
}

// ---------- Business-division dashboard ----------

export interface ApprovedDataset {
  dataset: Dataset;
  /** Approved requests for the dataset, latest decision first. */
  requests: RequestState[];
}

/**
 * Datasets the division owns: those with at least one of its requests whose
 * final status is Approved. A mapping, draft, submission or pending review does
 * not count. Each dataset appears once, however many approved requests it has.
 */
export function approvedDatasets(requests: RequestState[]): ApprovedDataset[] {
  const out = new Map<string, ApprovedDataset>();
  for (const r of requests) {
    if (r.overall !== 'Approved' || !r.review) continue;
    const entry = out.get(r.dataset.key) ?? { dataset: r.dataset, requests: [] };
    if (!entry.requests.some((x) => x.key === r.key)) entry.requests.push(r);
    out.set(r.dataset.key, entry);
  }
  for (const e of out.values()) {
    e.requests.sort((a, b) => (b.review?.on ?? '').localeCompare(a.review?.on ?? ''));
    e.dataset = e.requests[0].dataset;
  }
  return [...out.values()].sort((a, b) => (a.dataset.number ?? Infinity) - (b.dataset.number ?? Infinity) || a.dataset.name.localeCompare(b.dataset.name));
}

/**
 * Attributes of the dataset the division can still put in a new request: those
 * mapped to it (owned or shared) that no in-progress, pending or approved request
 * covers. A shared attribute requested by another division is therefore not
 * offered again (the division takes part in that request instead); its other
 * attributes stay available until the division requests them itself.
 */
export function requestableAttributes(dataset: Dataset, divisionId: string, requests: RequestState[]): Attribute[] {
  const held = new Set(requests
    .filter((r) => r.info.datasetKey === dataset.key && r.overall !== 'Rejected')
    .flatMap((r) => requestAttributeIds(r.info, dataset, r.rows)));
  return attributesFor(dataset, divisionId).filter((a) => !held.has(a.mapId));
}
