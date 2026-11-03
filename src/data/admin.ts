// Admin Centre business rules: dataset/attribute/mapping management and user
// management. Pure functions (no Dataverse calls) so they can be unit tested; the
// services re-run them against freshly loaded data before every write.
import { divisionsFromUsers, isRequestRow, managesAdminCentre, normalize, requestAttributeIds, roleOf, splitDivisionText, UserRoles } from './workflow.ts';
import type { Dataset, MapRow, RequestInfo, UserRow, ValueRow } from './types.ts';

// ---------- Schema facts (inspected 17 Oct 2026) ----------

/** myapp_attributeclassification choice values. */
export const CLASSIFICATION_OPTIONS: [number, string][] = [[0, 'Confidential'], [1, 'Open'], [2, 'Sensitive']];
/** myapp_attributevaluetype choice values. */
export const VALUE_TYPE_OPTIONS: [number, string][] = [[0, 'Single'], [1, 'LOVs'], [2, 'Multiple']];

/**
 * Attribute-name columns of tbl_MOEI_DatasetWithAttributes, in display order
 * ("Attribute 1" … "Attribute 45"). The first nine have legacy logical names.
 */
export const REFERENCE_SLOTS: readonly string[] = [
  'myapp_steamturbinesoutput', 'myapp_gasturbinesopencycleoutput', 'myapp_combinedcycleoutput', 'myapp_solarthermaloutput',
  'myapp_solarpvoutput', 'myapp_naturalgasoutput', 'myapp_mediumfueloiloutput', 'myapp_dieselfueloiloutput', 'myapp_coaltestingoutput',
  ...Array.from({ length: 36 }, (_, i) => `myapp_attribute${i + 10}`),
];
/** The reference table cannot hold more attributes than it has columns. */
export const MAX_ATTRIBUTES = REFERENCE_SLOTS.length;

/** Column limits (characters). */
export const LIMITS = {
  datasetName: 850, datasetDescription: 100, attributeName: 100, attributeDescription: 200, unit: 100,
  divisions: 100, comments: 400, slot: 100, userName: 850, userId: 100, userMail: 100, userRole: 100, userDesignation: 100,
} as const;

/** tbl_MOEI_DatasetWithAttributes row (only the columns the app uses). */
export interface ReferenceRow {
  myapp_tbl_moei_datasetwithattributesid: string;
  myapp_recordnumber?: number;
  myapp_datasetname?: string;
  statecode: number;
  [slot: string]: string | number | undefined;
}

/** A validation failure with the message for each form field. */
export class AdminValidationError extends Error {
  readonly errors: DraftErrors;
  constructor(errors: DraftErrors) {
    super(Object.values(errors)[0] ?? 'Check the highlighted fields.');
    this.errors = errors;
  }
}

// ---------- Datasets ----------

export interface AttributeDraft {
  /** Stable form key (not stored). */
  key: string;
  /** Mapping row ID when the attribute already exists. */
  mapId?: string;
  name: string;
  description: string;
  unit: string;
  /** Division names, in the order chosen. */
  divisions: string[];
  /** Choice values as strings ('' = not set). */
  classification: string;
  valueType: string;
  comments: string;
}

export interface DatasetDraft {
  number: string;
  name: string;
  description: string;
  attributes: AttributeDraft[];
}

/** Errors by field: `number`, `name`, `description`, `attributes`, and `attr:<key>:<field>`. */
export type DraftErrors = Record<string, string>;

/** A division that can be mapped: the designation of an active BusinessDivision user. */
export interface DivisionChoice { name: string; selectable: boolean; reason?: string }

/** Divisions with an active BusinessDivision user (from tbl_MOEI_UserDetails), the only divisions that can be mapped. */
export function divisionChoices(users: UserRow[]): DivisionChoice[] {
  return divisionsFromUsers(users).map((d) => ({ name: d.name, selectable: true })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Divisions text stored in myapp_businessdivision (shared attributes list every division, " / " separated). */
export const divisionsText = (names: string[]) => names.join(' / ');

/** A form draft for an existing dataset (attributes from the mapping table, not the reference columns). */
export function draftFromDataset(dataset: Dataset, mapRows: MapRow[]): DatasetDraft {
  const rows = new Map(mapRows.map((r) => [r.myapp_tbl_moei_datasetandbusinessmapid, r]));
  return {
    number: dataset.number != null ? String(dataset.number) : '',
    name: dataset.name,
    description: dataset.description ?? '',
    attributes: dataset.attributes.map((a) => {
      const row = rows.get(a.mapId);
      return {
        key: a.mapId,
        mapId: a.mapId,
        name: a.name,
        description: a.description ?? '',
        unit: a.unit ?? '',
        divisions: splitDivisionText(row?.myapp_businessdivision),
        classification: row?.myapp_attributeclassification != null ? String(row.myapp_attributeclassification) : '',
        valueType: row?.myapp_attributevaluetype != null ? String(row.myapp_attributevaluetype) : '',
        comments: row?.myapp_comments ?? '',
      };
    }),
  };
}

export interface DatasetUsage {
  /** Request IDs for the dataset (any status). */
  requests: string[];
  /** Mapping IDs used by at least one request (any status): their name, unit and divisions are locked and they cannot be removed. */
  lockedAttributes: Set<string>;
}

/**
 * Which requests use a dataset and which of its attributes they cover (stored
 * selection, the requesting-division rule and saved values, as the workflow reads them).
 * Rejected and decided requests count too, so historical values keep their meaning.
 */
export function datasetUsage(dataset: Dataset, requests: RequestInfo[], rows: ValueRow[]): DatasetUsage {
  const mine = requests.filter((r) => r.datasetKey === dataset.key && r.key);
  const locked = new Set<string>();
  for (const r of mine) for (const id of requestAttributeIds(r, dataset, rows)) locked.add(id);
  // Any saved value also locks its attribute, whatever the request row says.
  for (const r of rows) if (r.myapp_datasetid === dataset.key && r.myapp_attributemapid && !isRequestRow(r)) locked.add(r.myapp_attributemapid);
  return { requests: mine.map((r) => r.key), lockedAttributes: locked };
}

const tooLong = (value: string, max: number, what: string) => (value.trim().length > max ? `${what} must be ${max} characters or fewer.` : null);

/**
 * Validate a dataset draft against the existing datasets, the division list and
 * the attributes already used by requests. `original` is the dataset being edited.
 */
export function validateDataset(draft: DatasetDraft, ctx: {
  datasets: Dataset[];
  references: ReferenceRow[];
  divisions: DivisionChoice[];
  original?: { dataset: Dataset; draft: DatasetDraft; usage: DatasetUsage };
}): DraftErrors {
  const e: DraftErrors = {};
  const num = draft.number.trim();
  const originalNumber = ctx.original?.dataset.number;
  if (!/^\d+$/.test(num) || Number(num) < 1) e.number = 'Enter the dataset number as a whole number of 1 or more.';
  else if (Number(num) > 2147483647) e.number = 'The dataset number is too large.';
  else if (Number(num) !== originalNumber && (ctx.datasets.some((d) => d.number === Number(num)) || ctx.references.some((r) => r.myapp_recordnumber === Number(num)))) {
    e.number = `Dataset number ${num} is already used.`;
  } else if (ctx.original && Number(num) !== originalNumber) e.number = 'The dataset number cannot be changed: requests and values refer to it.';

  const name = draft.name.replace(/\s+/g, ' ').trim();
  if (!name) e.name = 'Enter the dataset name.';
  else if (tooLong(name, LIMITS.datasetName, 'The dataset name')) e.name = tooLong(name, LIMITS.datasetName, 'The dataset name')!;
  else if (ctx.datasets.some((d) => d.number !== originalNumber && normalize(d.name) === normalize(name))) e.name = `A dataset named "${name}" already exists.`;
  const descError = tooLong(draft.description, LIMITS.datasetDescription, 'The description');
  if (descError) e.description = descError;

  const attrs = draft.attributes;
  if (attrs.length === 0) e.attributes = 'Add at least one attribute.';
  if (attrs.length > MAX_ATTRIBUTES) e.attributes = `A dataset can have at most ${MAX_ATTRIBUTES} attributes: tbl_MOEI_DatasetWithAttributes has ${MAX_ATTRIBUTES} attribute columns.`;

  const selectable = new Map(ctx.divisions.map((d) => [normalize(d.name), d]));
  const originalAttr = new Map((ctx.original?.draft.attributes ?? []).filter((a) => a.mapId).map((a) => [a.mapId!, a]));
  const names = new Map<string, number>();
  for (const a of attrs) names.set(normalize(a.name), (names.get(normalize(a.name)) ?? 0) + 1);
  for (const a of attrs) {
    const k = (f: string) => `attr:${a.key}:${f}`;
    const aname = a.name.replace(/\s+/g, ' ').trim();
    if (!aname) e[k('name')] = 'Enter the attribute name.';
    else if (tooLong(aname, LIMITS.attributeName, 'The attribute name')) e[k('name')] = tooLong(aname, LIMITS.attributeName, 'The attribute name')!;
    else if ((names.get(normalize(aname)) ?? 0) > 1) e[k('name')] = `"${aname}" is used by more than one attribute of this dataset.`;
    const d = tooLong(a.description, LIMITS.attributeDescription, 'The description');
    if (d) e[k('description')] = d;
    const u = tooLong(a.unit, LIMITS.unit, 'The unit');
    if (u) e[k('unit')] = u;
    const c = tooLong(a.comments, LIMITS.comments, 'Comments');
    if (c) e[k('comments')] = c;
    if (a.classification && !CLASSIFICATION_OPTIONS.some(([v]) => String(v) === a.classification)) e[k('classification')] = 'Choose a valid classification.';
    if (a.valueType && !VALUE_TYPE_OPTIONS.some(([v]) => String(v) === a.valueType)) e[k('valueType')] = 'Choose a valid value type.';
    if (a.divisions.length === 0) e[k('divisions')] = 'Select at least one business division.';
    else {
      const bad = a.divisions.filter((n) => !selectable.get(normalize(n))?.selectable);
      const before = a.mapId ? originalAttr.get(a.mapId) : undefined;
      // An existing mapping to a division may stay even if that division lost its users; a new one may not.
      const newlyAdded = bad.filter((n) => !before?.divisions.some((x) => normalize(x) === normalize(n)));
      if (newlyAdded.length) e[k('divisions')] = `These divisions can't be mapped: ${newlyAdded.join(', ')}.`;
      else if (divisionsText(a.divisions).length > LIMITS.divisions) e[k('divisions')] = `Too many divisions for one attribute (the column holds ${LIMITS.divisions} characters).`;
      if (new Set(a.divisions.map(normalize)).size !== a.divisions.length) e[k('divisions')] = 'A division is selected twice.';
    }
    // Attributes used by a request keep their name, unit and divisions.
    if (a.mapId && ctx.original?.usage.lockedAttributes.has(a.mapId)) {
      const before = originalAttr.get(a.mapId);
      if (before) {
        if (normalize(before.name) !== normalize(a.name)) e[k('name')] = 'This attribute is used by a request; its name cannot be changed.';
        if ((before.unit ?? '').trim() !== a.unit.trim()) e[k('unit')] = 'This attribute is used by a request; its unit cannot be changed.';
        if (divisionsText(before.divisions.map(normalize)) !== divisionsText(a.divisions.map(normalize))) e[k('divisions')] = 'This attribute is used by a request; its divisions cannot be changed.';
      }
    }
  }
  // Removing attributes that requests use is refused.
  if (ctx.original) {
    const kept = new Set(attrs.map((a) => a.mapId).filter(Boolean));
    const removedLocked = ctx.original.draft.attributes.filter((a) => a.mapId && !kept.has(a.mapId) && ctx.original!.usage.lockedAttributes.has(a.mapId));
    if (removedLocked.length) e.attributes = `${removedLocked.map((a) => a.name).join(', ')} ${removedLocked.length === 1 ? 'is' : 'are'} used by a request and cannot be removed.`;
  }
  return e;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const choice = (s: string) => (s === '' ? null : Number(s));

/** Mapping-table columns for one attribute of the draft. */
export function mappingFields(draft: DatasetDraft, a: AttributeDraft) {
  return {
    myapp_datasetnumber: Number(draft.number),
    myapp_datasetname: clean(draft.name),
    myapp_datasetdescription: clean(draft.description) || null,
    myapp_attributename: clean(a.name),
    myapp_attributedescription: clean(a.description) || null,
    myapp_unit: clean(a.unit) || null,
    myapp_businessdivision: divisionsText(a.divisions.map(clean)),
    myapp_attributeclassification: choice(a.classification),
    myapp_attributevaluetype: choice(a.valueType),
    myapp_comments: a.comments.trim() || null,
  };
}
export type MappingFields = ReturnType<typeof mappingFields>;

/** Reference-table columns: dataset number, name and the attribute names in slot order (unused slots cleared). */
export function referenceFields(draft: DatasetDraft): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = { myapp_recordnumber: Number(draft.number), myapp_datasetname: clean(draft.name) };
  REFERENCE_SLOTS.forEach((slot, i) => { out[slot] = draft.attributes[i] ? clean(draft.attributes[i].name).slice(0, LIMITS.slot) : null; });
  return out;
}

export interface SavePlan {
  create: { key: string; fields: MappingFields }[];
  update: { mapId: string; fields: Partial<MappingFields> }[];
  /** Mapping rows to deactivate (removed, unused attributes). */
  deactivate: string[];
  /** The reference row write, or null when it already matches. */
  reference: { id?: string; fields: Record<string, string | number | null> } | null;
}

/** Same stored text, ignoring surrounding/double spaces; empty and missing are the same. */
const sameValue = (a: unknown, b: unknown) =>
  (typeof a === 'string' || typeof b === 'string') ? clean(String(a ?? '')) === clean(String(b ?? '')) : (a ?? null) === (b ?? null);

const DATASET_FIELDS = new Set(['myapp_datasetnumber', 'myapp_datasetname', 'myapp_datasetdescription']);

/**
 * The writes needed to bring both tables in line with the draft. Only what the
 * administrator changed is written: with `original` (the form as loaded), a field
 * the administrator left alone is not rewritten even if rows differ in spacing or
 * carry older variations of the dataset name. New attributes are written in full.
 */
export function planDatasetSave(draft: DatasetDraft, existing: { mapRows: MapRow[]; reference?: ReferenceRow }, original?: DatasetDraft): SavePlan {
  const byId = new Map(existing.mapRows.map((r) => [r.myapp_tbl_moei_datasetandbusinessmapid, r]));
  const plan: SavePlan = { create: [], update: [], deactivate: [], reference: null };
  const claimed = new Set(draft.attributes.map((a) => a.mapId).filter((id): id is string => !!id && byId.has(id)));
  // A new attribute whose row already exists (an earlier attempt saved it) updates that row instead of duplicating it.
  const adopt = (a: AttributeDraft) => {
    const row = existing.mapRows.find((r) => !claimed.has(r.myapp_tbl_moei_datasetandbusinessmapid) && normalize(r.myapp_attributename) === normalize(a.name));
    if (row) claimed.add(row.myapp_tbl_moei_datasetandbusinessmapid);
    return row;
  };
  const datasetChanged = (k: string) => !original || (k === 'myapp_datasetname' ? !sameValue(original.name, draft.name)
    : k === 'myapp_datasetdescription' ? !sameValue(original.description, draft.description) : original.number !== draft.number);

  for (const a of draft.attributes) {
    const fields = mappingFields(draft, a);
    const row = a.mapId && byId.has(a.mapId) ? byId.get(a.mapId) : adopt(a);
    if (!row) { plan.create.push({ key: a.key, fields }); continue; }
    const before = original?.attributes.find((x) => x.mapId && x.mapId === a.mapId);
    const loaded = before ? mappingFields(original!, before) : undefined;
    const changes: Partial<MappingFields> = {};
    for (const [k, v] of Object.entries(fields) as [keyof MappingFields, MappingFields[keyof MappingFields]][]) {
      if (sameValue((row as unknown as Record<string, unknown>)[k], v)) continue;
      // Left alone by the administrator: keep what is stored.
      if (DATASET_FIELDS.has(k) ? !datasetChanged(k) : loaded && sameValue(loaded[k], v)) continue;
      (changes as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(changes).length) plan.update.push({ mapId: row.myapp_tbl_moei_datasetandbusinessmapid, fields: changes });
  }
  for (const r of existing.mapRows) if (!claimed.has(r.myapp_tbl_moei_datasetandbusinessmapid)) plan.deactivate.push(r.myapp_tbl_moei_datasetandbusinessmapid);

  // Reference row: a new row gets everything; an existing row only what the administrator changed.
  const ref = existing.reference;
  if (!ref) plan.reference = { fields: referenceFields(draft) };
  else {
    const target = original ? referenceChanges(draft, original, ref) : referenceFields(draft);
    const diff = Object.fromEntries(Object.entries(target).filter(([k, v]) => !sameValue(ref[k], v)));
    if (Object.keys(diff).length) plan.reference = { id: ref.myapp_tbl_moei_datasetwithattributesid, fields: diff };
  }
  return plan;
}

/**
 * Reference-row columns for an edit, keeping the row's existing layout: a renamed
 * attribute keeps its column, a removed one's column is cleared, a new one takes
 * the first free column (or one holding a name no attribute has any more). The
 * existing reference rows were filled independently of the mapping table (some
 * names differ), so columns the edit does not concern are left exactly as they are.
 */
export function referenceChanges(draft: DatasetDraft, original: DatasetDraft, ref: ReferenceRow): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (!sameValue(original.name, draft.name)) out.myapp_datasetname = clean(draft.name);
  const slots = new Map<string, string | null>(REFERENCE_SLOTS.map((k) => [k, typeof ref[k] === 'string' && clean(ref[k] as string) ? (ref[k] as string) : null]));
  const used = new Set<string>();
  const slotOf = (name: string) => REFERENCE_SLOTS.find((k) => !used.has(k) && slots.get(k) != null && sameValue(slots.get(k), name));
  const set = (k: string, v: string | null) => { slots.set(k, v); out[k] = v; used.add(k); };
  const before = new Map(original.attributes.filter((a) => a.mapId).map((a) => [a.mapId!, a]));
  const waiting: AttributeDraft[] = [];
  for (const a of draft.attributes) {
    const old = a.mapId ? before.get(a.mapId) : undefined;
    const k = old ? slotOf(old.name) : slotOf(a.name);
    // Existing attributes the reference row names differently are left alone; only new ones need a column.
    if (!k) { if (!old) waiting.push(a); continue; }
    used.add(k);
    if (!sameValue(slots.get(k), a.name)) set(k, clean(a.name).slice(0, LIMITS.slot));
  }
  const kept = new Set(draft.attributes.map((a) => a.mapId).filter(Boolean));
  for (const old of original.attributes) {
    if (!old.mapId || kept.has(old.mapId)) continue;
    const k = slotOf(old.name);
    // Cleared, and free for a new attribute below.
    if (k) { slots.set(k, null); out[k] = null; }
  }
  // Free columns first, then columns whose name no attribute of the dataset has.
  const names = new Set(draft.attributes.map((a) => clean(a.name).toLowerCase()));
  const free = [
    ...REFERENCE_SLOTS.filter((k) => !used.has(k) && slots.get(k) == null),
    ...REFERENCE_SLOTS.filter((k) => !used.has(k) && slots.get(k) != null && !names.has(clean(slots.get(k)!).toLowerCase())),
  ];
  for (const a of waiting) {
    const k = free.shift();
    if (!k) throw new Error(`tbl_MOEI_DatasetWithAttributes has no free attribute column for "${clean(a.name)}" (all ${MAX_ATTRIBUTES} are in use).`);
    set(k, clean(a.name).slice(0, LIMITS.slot));
  }
  return out;
}

/** Dataverse access used to apply a save plan (the services pass the SDK; tests pass memory). */
export interface DatasetStore {
  createMapping(fields: Record<string, unknown>): Promise<void>;
  /** ID of the active mapping row for this dataset number and attribute name that is not in `known`. */
  findNewMapping(datasetNumber: number, attributeName: string, known: Set<string>): Promise<string | undefined>;
  updateMapping(id: string, fields: Record<string, unknown>): Promise<void>;
  deactivateMapping(id: string): Promise<void>;
  createReference(fields: Record<string, unknown>): Promise<void>;
  updateReference(id: string, fields: Record<string, unknown>): Promise<void>;
}

/** Leave out empty optional values on create (Dataverse defaults them). */
const withoutNulls = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));

/** A save that did not complete; `kept` lists mapping rows that could not be withdrawn. */
export class DatasetSaveError extends Error {
  readonly kept: string[];
  constructor(message: string, kept: string[] = []) {
    super(message);
    this.kept = kept;
  }
}

/**
 * Apply a save plan: mapping rows first, then the reference row. Dataverse gives
 * Code Apps no multi-table transaction, so for a new dataset every mapping row
 * written in this attempt is deactivated again if a later write fails (nothing
 * half-created stays visible to the app). For an edit the changes are applied in
 * order and a failure reports what was saved; repeating the same save is safe
 * because planDatasetSave matches rows saved earlier instead of duplicating them.
 */
export async function applyDatasetPlan(store: DatasetStore, plan: SavePlan, opts: { datasetNumber: number; isNew: boolean; known: Set<string> }): Promise<void> {
  const created: string[] = [];
  const done: string[] = [];
  try {
    for (const c of plan.create) {
      await store.createMapping(withoutNulls(c.fields));
      const id = await store.findNewMapping(opts.datasetNumber, c.fields.myapp_attributename, opts.known);
      if (id) { created.push(id); opts.known.add(id); }
      done.push(`added "${c.fields.myapp_attributename}"`);
    }
    for (const u of plan.update) { await store.updateMapping(u.mapId, u.fields); done.push('updated an attribute'); }
    for (const id of plan.deactivate) { await store.deactivateMapping(id); done.push('removed an attribute'); }
    if (plan.reference?.id) await store.updateReference(plan.reference.id, plan.reference.fields);
    else if (plan.reference) await store.createReference(withoutNulls(plan.reference.fields));
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'A write failed.';
    if (!opts.isNew) {
      throw new DatasetSaveError(`Not every change was saved (${reason}). Saved so far: ${done.join(', ') || 'nothing'}. Select Save again to finish; saved changes are not repeated.`);
    }
    const kept: string[] = [];
    for (const id of created) {
      try { await store.deactivateMapping(id); } catch { kept.push(id); }
    }
    throw new DatasetSaveError(kept.length
      ? `The dataset could not be saved (${reason}) and ${kept.length} mapping row(s) could not be withdrawn. The dataset appears in the list: open it and select Remove, or ask a Dataverse administrator to deactivate mapping rows ${kept.join(', ')}.`
      : `The dataset could not be saved, so nothing was kept. ${reason} Your entries are still in the form; select Save to try again.`, kept);
  }
}

/** Next free dataset number (one more than the highest in either table). */
export const nextDatasetNumber = (datasets: Dataset[], references: ReferenceRow[]) =>
  Math.max(0, ...datasets.map((d) => d.number ?? 0), ...references.map((r) => r.myapp_recordnumber ?? 0)) + 1;

// ---------- Users ----------

export const ROLE_OPTIONS = [UserRoles.Division, UserRoles.DgAdmin, UserRoles.Admin] as const;

export interface UserDraft {
  id?: string;
  name: string;
  /** Assigned automatically for new users (see nextUserId); read-only afterwards. */
  userId: string;
  mail: string;
  role: string;
  designation: string;
  active: boolean;
  /** The designation is a new business division (not yet the designation of any active division user). */
  newDivision?: boolean;
}

/** User ID prefix per role: BD (BusinessDivision), DGAD (DG Admin), ADM (Admin); other roles use their first letters. */
export function userIdPrefix(role: string): string {
  const kind = roleOf(role);
  if (kind === 'division') return 'BD';
  if (kind === 'admin') return 'DGAD';
  if (kind === 'system') return 'ADM';
  const letters = role.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
  return letters || 'USR';
}

/** Next User ID for a role: the prefix and one more than the highest number already used with it (e.g. BD007 → BD008). */
export function nextUserId(users: UserRow[], role: string): string {
  const prefix = userIdPrefix(role);
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
  const highest = Math.max(0, ...users.map((u) => Number(pattern.exec((u.myapp_userid ?? '').trim())?.[1] ?? 0)));
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

/** Roles to offer: the app's roles first, then any other role already recorded on a user. */
export function roleChoices(users: UserRow[]): string[] {
  const out: string[] = [...ROLE_OPTIONS];
  for (const u of users) {
    const r = (u.myapp_userrole ?? '').replace(/\s+/g, ' ').trim();
    if (r && !out.some((x) => normalize(x) === normalize(r) || (roleOf(x) === roleOf(r) && roleOf(r) !== 'unknown'))) out.push(r);
  }
  return out;
}

/** Designations already recorded for non-division users (e.g. Admin, IT). */
export const designationChoices = (users: UserRow[]) =>
  [...new Map(users.filter((u) => roleOf(u.myapp_userrole) !== 'division' && (u.myapp_userdesignation ?? '').trim())
    .map((u) => [normalize(u.myapp_userdesignation), clean(u.myapp_userdesignation!)])).values()].sort();

/** Roles the app has screens for; any other role is stored but cannot sign in. */
export const isKnownRole = (role: string) => roleOf(role) !== 'unknown';

export const draftFromUser = (u: UserRow): UserDraft => ({
  id: u.myapp_tbl_moei_userdetailsid,
  name: u.myapp_username ?? '',
  userId: u.myapp_userid ?? '',
  mail: u.myapp_usermailid ?? '',
  role: ROLE_OPTIONS.find((r) => roleOf(r) === roleOf(u.myapp_userrole)) ?? (u.myapp_userrole ?? ''),
  designation: u.myapp_userdesignation ?? '',
  active: u.statecode === 0,
});

const MAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;
/** Active users who can open the Admin Centre (DG Admin or Admin). */
const isActiveAdmin = (u: UserRow) => u.statecode === 0 && managesAdminCentre(u.myapp_userrole);

/**
 * Validate a user draft. Rules: required fields; one active record per sign-in
 * address (the app refuses access when several match); unique User ID; a
 * BusinessDivision user needs an existing division or "Add new business division"; the last
 * active DG Admin or Admin cannot lose that role or be deactivated (and you
 * cannot remove your own access); the last active user of a division with mapped attributes cannot
 * leave it (its mappings would stop resolving).
 */
export function validateUser(draft: UserDraft, ctx: { users: UserRow[]; divisions: DivisionChoice[]; mappedDivisions: Set<string>; selfId?: string }): DraftErrors {
  const e: DraftErrors = {};
  const others = ctx.users.filter((u) => u.myapp_tbl_moei_userdetailsid !== draft.id);
  const before = ctx.users.find((u) => u.myapp_tbl_moei_userdetailsid === draft.id);
  const name = clean(draft.name);
  if (!name) e.name = 'Enter the user name.';
  else if (name.length > LIMITS.userName) e.name = `The user name must be ${LIMITS.userName} characters or fewer.`;

  const uid = draft.userId.trim();
  if (!uid) e.userId = 'Enter the User ID.';
  else if (uid.length > LIMITS.userId) e.userId = `The User ID must be ${LIMITS.userId} characters or fewer.`;
  else if (others.some((u) => normalize(u.myapp_userid) === normalize(uid))) e.userId = `User ID ${uid} is already used.`;

  const mail = draft.mail.trim();
  if (!mail) e.mail = 'Enter the sign-in email address.';
  else if (!MAIL.test(mail)) e.mail = 'Enter one valid email address (the address the person signs in with).';
  else if (mail.length > LIMITS.userMail) e.mail = `The email must be ${LIMITS.userMail} characters or fewer.`;
  else if (draft.active && others.some((u) => u.statecode === 0 && (u.myapp_usermailid ?? '').split(/[;,\s]+/).some((m) => normalize(m) === normalize(mail)))) {
    e.mail = 'Another active user already has this sign-in address. Each address may map to one active user.';
  }

  const kind = roleOf(draft.role);
  const role = clean(draft.role);
  if (!role) e.role = 'Choose or enter a role.';
  else if (role.length > LIMITS.userRole) e.role = `The role must be ${LIMITS.userRole} characters or fewer.`;
  const designation = clean(draft.designation);
  const existingDivision = ctx.divisions.find((d) => normalize(d.name) === normalize(designation));
  if (!designation) e.designation = kind === 'division' ? 'Choose or enter the business division.' : 'Choose or enter the designation.';
  else if (designation.length > LIMITS.userDesignation) e.designation = `The designation must be ${LIMITS.userDesignation} characters or fewer.`;
  else if (kind === 'division' && !existingDivision && !draft.newDivision) e.designation = 'Choose a division from the list, or choose "Add new business division".';
  else if (kind === 'division' && draft.newDivision && existingDivision) e.designation = `${existingDivision.name} already exists — choose it from the list.`;

  // Never remove the last user who can manage the Admin Centre, and never remove your own access.
  if (before && isActiveAdmin(before) && (!managesAdminCentre(draft.role) || !draft.active)) {
    if (!others.some(isActiveAdmin)) e.role = 'This is the last active DG Admin or Admin. Add another before changing this user.';
    else if (before.myapp_tbl_moei_userdetailsid === ctx.selfId) e.role = 'You cannot remove your own Admin Centre access. Ask another DG Admin or Admin.';
  }
  // The last active user of a division whose attributes are mapped keeps that division resolvable.
  if (before && before.statecode === 0 && roleOf(before.myapp_userrole) === 'division') {
    const oldDivision = normalize(before.myapp_userdesignation);
    const leaving = !draft.active || kind !== 'division' || normalize(designation) !== oldDivision;
    const othersInDivision = others.some((u) => u.statecode === 0 && roleOf(u.myapp_userrole) === 'division' && normalize(u.myapp_userdesignation) === oldDivision);
    if (leaving && !othersInDivision && ctx.mappedDivisions.has(oldDivision)) {
      e.designation = `${before.myapp_userdesignation} has attributes mapped to it and no other active user. Add another ${before.myapp_userdesignation} user first.`;
    }
  }
  return e;
}

/** User-table columns for a draft. */
export const userFields = (d: UserDraft) => ({
  myapp_username: clean(d.name),
  myapp_userid: d.userId.trim(),
  myapp_usermailid: d.mail.trim(),
  myapp_userrole: clean(d.role),
  myapp_userdesignation: clean(d.designation),
});
