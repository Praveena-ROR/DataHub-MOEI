// Write operations for requests, division portions and the DG Admin review log.
// They depend only on a small store interface, so the app (Power Apps SDK), unit
// tests (in-memory) and integration tests (Dataverse Web API) all run the same
// code. Every operation re-reads the request before validating and writing.
import type { Dataset, Division, RequestRef, RequestState, ReviewEntryRow, ReviewStatus, ValueRow } from './types.ts';
import {
  assertCanCreateRequest,
  assertReviewable,
  attributeConflicts,
  attributesFor,
  deriveRequestState,
  divisionListText,
  EntryKeys,
  nextRequestKey,
  planClarification,
  planClarificationResolve,
  planClarificationResponse,
  planDivisionWrite,
  RequestRows,
  requestsFromRows,
  scopeDataset,
  storedStatus,
  validateComment,
  validateReason,
  withDecisions,
  WorkflowError,
} from './workflow.ts';

export type NewValueRow = Omit<ValueRow, 'myapp_tbl_moei_requestid' | 'modifiedon' | 'createdon'>;
export type ValueRowChanges = Partial<Omit<ValueRow, 'myapp_tbl_moei_requestid' | 'modifiedon' | 'createdon'>>;
export type NewEntryRow = Omit<ReviewEntryRow, 'myapp_tbl_moei_dgadminapprovalid' | 'modifiedon' | 'createdon'>;
export type EntryChanges = Partial<NewEntryRow>;

/**
 * Data access used by the operations. Implementations must turn a Dataverse
 * alternate-key violation into `WorkflowError('conflict')`.
 */
export interface RequestStore {
  /** Active tbl_MOEI_requests rows of one request (myapp_requestid): its request row and value rows. */
  loadValueRows(requestKey: string): Promise<ValueRow[]>;
  /** Active tbl_MOEI_requests rows of one dataset (myapp_datasetid), request rows included. */
  loadDatasetRows(datasetKey: string): Promise<ValueRow[]>;
  /** Every Request ID already used in tbl_MOEI_requests (active or not) and the review log. */
  loadUsedRequestKeys(): Promise<string[]>;
  create(row: NewValueRow): Promise<void>;
  update(id: string, changes: ValueRowChanges): Promise<void>;
  /** tbl_MOEI_DGAdminApproval rows for the request. */
  loadEntries(requestKey: string): Promise<ReviewEntryRow[]>;
  createEntry(row: NewEntryRow): Promise<void>;
  updateEntry(id: string, changes: EntryChanges): Promise<void>;
}

const clip = (s: string | undefined, max: number) => (s ?? '').slice(0, max);
type Clock = () => string;
const isoNow: Clock = () => new Date().toISOString();

/** The dataset's requests with their recorded decisions (for overlap checks). */
async function requestsOf(store: RequestStore, dataset: Dataset) {
  const rows = await store.loadDatasetRows(dataset.key);
  const requests = requestsFromRows(rows, [dataset]);
  const entries = (await Promise.all(requests.map((r) => store.loadEntries(r.key)))).flat();
  return { rows, requests: withDecisions(requests, entries) };
}

export async function loadState(store: RequestStore, request: RequestRef): Promise<RequestState> {
  const key = request.info.key;
  const [rows, entries, siblings] = await Promise.all([
    store.loadValueRows(key),
    store.loadEntries(key),
    request.dataset.key ? requestsOf(store, request.dataset).then((r) => r.requests) : Promise.resolve([]),
  ]);
  return deriveRequestState(request, rows, entries, siblings);
}

/** Re-read the request so writes never act on a stale copy held by the caller. */
async function freshRequest(store: RequestStore, request: RequestRef): Promise<RequestRef> {
  const key = request.info.key;
  const info = key ? requestsFromRows(await store.loadValueRows(key), [request.dataset]).find((r) => r.key === key) : undefined;
  if (!info) throw new WorkflowError('forbidden', 'This request was not found.');
  // The selection is only ever read from Dataverse, never from the caller.
  if (info.datasetKey !== request.dataset.key) throw new WorkflowError('integrity', 'This request belongs to a different dataset.');
  return { info, dataset: request.dataset };
}

const loadFresh = async (store: RequestStore, request: RequestRef) => loadState(store, await freshRequest(store, request));

/**
 * Keep the status recorded on the request row in step with the derived state.
 * The app always re-derives the status, so a failure here never undoes the
 * write that preceded it. Legacy requests have no request row to update.
 */
async function syncRequest(store: RequestStore, state: RequestState): Promise<RequestState> {
  const { rowId, status } = state.info;
  if (!rowId || status === state.overall) return state;
  try {
    await store.update(rowId, { myapp_reviewstatus: storedStatus(state.overall) });
    return { ...state, info: { ...state.info, status: state.overall } };
  } catch {
    return state;
  }
}

// ---------- Request creation ----------

export type CreateResult = { kind: 'created'; requestKey: string };

/** Length of myapp_reviewcomments, which holds the selected attribute IDs. */
const SELECTION_MAX_LENGTH = 2000;

/**
 * Create one request for a dataset on behalf of the caller's division: one
 * request row in tbl_MOEI_requests (no values). The Request ID is the next free
 * REQ_nnnn; if another request takes the same ID at the same moment, the
 * alternate key refuses the second row and the next ID is tried. Several
 * requests for one dataset may exist, but an attribute can be in only one
 * request that is in progress, pending review or approved; a rejected request
 * frees its attributes.
 */
export async function createRequest(
  store: RequestStore,
  dataset: Dataset,
  division: Division,
  userUpn: string,
  attributeIds?: string[],
  now: Clock = isoNow,
): Promise<CreateResult> {
  assertCanCreateRequest(dataset, division.id, attributeIds);
  // The request's attributes are fixed at creation (in dataset order), so later
  // mapping changes never alter an existing request's submission gate.
  // No explicit selection = every attribute mapped to the caller's division (owned and shared).
  const selection = (attributeIds ? dataset.attributes.filter((a) => attributeIds.includes(a.mapId)) : attributesFor(dataset, division.id)).map((a) => a.mapId);
  const selectionText = selection.join(',');
  if (selectionText.length > SELECTION_MAX_LENGTH) throw new WorkflowError('validation', `Too many attributes are selected for one request of ${dataset.name}. Split them over two requests.`);
  const scoped = scopeDataset(dataset, { key: '', datasetKey: dataset.key, selectedAttributes: selection, requestingDivision: division.name });

  const { rows, requests } = await requestsOf(store, dataset);
  const conflicts = attributeConflicts(selection, dataset, requests, undefined, rows);
  if (conflicts.length) {
    const keys = [...new Set(conflicts.map((c) => c.requestKey))].join(', ');
    throw new WorkflowError('conflict', `${conflicts.map((c) => c.attributeName).join(', ')} ${conflicts.length === 1 ? 'is' : 'are'} already in request ${keys} for ${dataset.name}. Choose other attributes or open that request from My Requests.`);
  }

  const at = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const requestKey = nextRequestKey(await store.loadUsedRequestKeys());
    try {
      await store.create({
        myapp_requestid: requestKey,
        myapp_datasetid: dataset.key,
        myapp_datasetname: clip(dataset.name, 100),
        myapp_attribute: RequestRows.label,
        myapp_attributemapid: RequestRows.marker,
        myapp_divisionname: RequestRows.marker,
        myapp_attributevalue: clip(divisionListText(scoped), 100),
        myapp_submittedby: userUpn,
        myapp_submittedon: at,
        myapp_divisionid: clip(division.name, 100),
        myapp_reviewcomments: selectionText,
        myapp_reviewstatus: storedStatus('In Progress'),
      });
      return { kind: 'created', requestKey };
    } catch (e) {
      // Another request took this ID at the same moment: try the next one.
      if (!(e instanceof WorkflowError && e.kind === 'conflict')) throw e;
    }
  }
  throw new WorkflowError('conflict', `A Request ID for ${dataset.name} could not be assigned because other requests were being created at the same time. Try again.`);
}

// ---------- Division portions ----------

/**
 * Save the division's draft or submit its portion. Creates/updates only rows
 * owned by the caller's division. Returns the state re-read after the write.
 */
export async function writeDivisionPortion(
  store: RequestStore,
  request: RequestRef,
  division: Division,
  userUpn: string,
  values: Record<string, string>,
  loadedVersions: Record<string, string | undefined>,
  mode: 'draft' | 'submit',
  now: Clock = isoNow,
): Promise<RequestState> {
  const state = await loadFresh(store, request);
  const { dataset } = state;
  const plan = planDivisionWrite(state, division.id, values, loadedVersions, mode);
  const status = mode === 'submit' ? 'Submitted' : 'Draft';
  const stamp = mode === 'submit' ? { myapp_submittedby: userUpn, myapp_submittedon: now() } : {};

  for (const { attribute, value } of plan.create) {
    try {
      await store.create({
        myapp_requestid: state.key,
        myapp_datasetid: dataset.key,
        myapp_datasetname: clip(dataset.name, 100),
        myapp_attribute: clip(attribute.name, 100),
        myapp_divisionname: clip(division.name, 100),
        myapp_attributevalue: value,
        myapp_attributemapid: attribute.mapId,
        myapp_submissionstatus: status,
        ...stamp,
      });
    } catch (e) {
      if (e instanceof WorkflowError && e.kind === 'conflict') {
        throw new WorkflowError('conflict', `"${attribute.name}" was saved in another session at the same time. Reload to see the latest values.`);
      }
      throw e;
    }
  }
  for (const { row, value } of plan.update) {
    await store.update(row.myapp_tbl_moei_requestid, {
      myapp_attributevalue: value,
      myapp_submissionstatus: status,
      ...stamp,
    });
  }
  return syncRequest(store, await loadState(store, { info: state.info, dataset: request.dataset }));
}

// ---------- DG Admin review log ----------

const entryBase = (state: RequestState, approvalId: string, entryType: string) => ({
  myapp_approvalid: approvalId,
  myapp_requestkey: state.key,
  myapp_entrytype: entryType,
  myapp_datasetname: clip(state.dataset.name, 850),
  myapp_ownedby: clip(divisionListText(state.dataset), 100),
});

/**
 * Record the DG Admin decision as one review-log row (`<request>:DECISION`) and
 * record the status on the request row. Values stay locked; nothing on the value rows changes.
 */
export async function writeDecision(
  store: RequestStore,
  request: RequestRef,
  reviewerUpn: string,
  decision: ReviewStatus,
  reason: string,
  now: Clock = isoNow,
): Promise<RequestState> {
  const state = await loadFresh(store, request);
  assertReviewable(state, decision);
  const text = validateReason(reason, decision);
  await store.createEntry({
    ...entryBase(state, EntryKeys.decision(state.key), 'Decision'),
    myapp_status: decision,
    myapp_comments: text || undefined,
    myapp_reviewedby: reviewerUpn,
    myapp_reviewedon: now(),
  });
  return syncRequest(store, await loadState(store, { info: state.info, dataset: request.dataset }));
}

/** Add a request-level DG Admin comment. Earlier comments are never changed. */
export async function writeComment(store: RequestStore, request: RequestRef, authorUpn: string, text: string, now: Clock = isoNow): Promise<RequestState> {
  const comment = validateComment(text);
  const state = await loadFresh(store, request);
  const at = now();
  await store.createEntry({
    ...entryBase(state, EntryKeys.comment(state.key, `${at}:${Math.random().toString(36).slice(2, 8)}`), 'Comment'),
    myapp_comments: comment,
    myapp_reviewedby: authorUpn,
    myapp_reviewedon: at,
  });
  return loadState(store, { info: state.info, dataset: request.dataset });
}

/** DG Admin asks the responsible division about one submitted attribute value. */
export async function writeClarificationRequest(
  store: RequestStore,
  request: RequestRef,
  authorUpn: string,
  mapId: string,
  divisionId: string,
  question: string,
  now: Clock = isoNow,
): Promise<RequestState> {
  const state = await loadFresh(store, request);
  const plan = planClarification(state, mapId, divisionId, question);
  await store.createEntry({
    ...entryBase(state, plan.approvalId, 'Clarification'),
    myapp_status: 'Pending Response',
    myapp_comments: plan.question,
    myapp_attributemapid: mapId,
    myapp_attributename: clip(plan.attribute.name, 100),
    myapp_divisionname: clip(plan.divisionName, 100),
    myapp_submittedvalue: clip(plan.submittedValue, 100),
    myapp_reviewedby: authorUpn,
    myapp_reviewedon: now(),
  });
  return loadState(store, { info: state.info, dataset: request.dataset });
}

/** The responsible division answers a pending clarification. */
export async function writeClarificationResponse(
  store: RequestStore,
  request: RequestRef,
  division: Division,
  responderUpn: string,
  clarificationId: string,
  response: string,
  loadedVersion: string | undefined,
  now: Clock = isoNow,
): Promise<RequestState> {
  const state = await loadFresh(store, request);
  const plan = planClarificationResponse(state, clarificationId, division.id, response, loadedVersion);
  await store.updateEntry(clarificationId, {
    myapp_status: 'Responded',
    myapp_response: plan.response,
    myapp_respondedby: responderUpn,
    myapp_respondedon: now(),
  });
  return loadState(store, { info: state.info, dataset: request.dataset });
}

/** DG Admin marks a responded clarification as resolved. */
export async function writeClarificationResolve(
  store: RequestStore,
  request: RequestRef,
  resolverUpn: string,
  clarificationId: string,
  loadedVersion: string | undefined,
  now: Clock = isoNow,
): Promise<RequestState> {
  const state = await loadFresh(store, request);
  planClarificationResolve(state, clarificationId, loadedVersion);
  await store.updateEntry(clarificationId, {
    myapp_status: 'Resolved',
    myapp_resolvedby: resolverUpn,
    myapp_resolvedon: now(),
  });
  return loadState(store, { info: state.info, dataset: request.dataset });
}
