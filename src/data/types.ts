// Domain types for the Data Division app. Field names on the *Row types are the
// actual Dataverse logical names of the connected tables.

export const SubmissionStatus = { Draft: 'Draft', Submitted: 'Submitted' } as const;
export type SubmissionStatus = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

export const ReviewStatus = { Approved: 'Approved', Rejected: 'Rejected' } as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

export const ClarificationStatus = { Pending: 'Pending Response', Responded: 'Responded', Resolved: 'Resolved' } as const;
export type ClarificationStatus = (typeof ClarificationStatus)[keyof typeof ClarificationStatus];

export const EntryType = { Comment: 'Comment', Clarification: 'Clarification', Decision: 'Decision' } as const;
export type EntryType = (typeof EntryType)[keyof typeof EntryType];

/** Division portion status as shown to users. `Pending` is derived (no rows yet). */
export type DivisionStatus = 'Pending' | 'Draft' | 'Submitted';

/** Overall request status, always derived from the value rows and the review log. */
export type OverallStatus = 'In Progress' | 'Pending DG Admin Review' | 'Approved' | 'Rejected';
export const OVERALL_STATUSES: OverallStatus[] = ['In Progress', 'Pending DG Admin Review', 'Approved', 'Rejected'];

/**
 * A request: read from its request row in tbl_MOEI_requests (see RequestRows in
 * workflow.ts), or, for requests created before request rows existed, rebuilt
 * from the request's value rows (`legacy`).
 */
export interface RequestInfo {
  /** Request ID, e.g. REQ_0001; equals myapp_requestid on the value rows. */
  key: string;
  /** Dataset number; equals myapp_datasetid on the value rows. */
  datasetKey: string;
  /** Sign-in address of the person who raised the request. */
  requestedBy?: string;
  requestingDivision?: string;
  /** Mapping row IDs of the attributes the request covers (empty = all). */
  selectedAttributes: string[];
  /** Overall status as last recorded; a Rejected request frees its attributes. */
  status?: string;
  createdOn?: string;
  /** myapp_tbl_moei_requestid of the request row (absent for legacy requests). */
  rowId?: string;
  /** Rebuilt from value rows: who raised it and the original selection were not recorded. */
  legacy?: boolean;
}

/**
 * myapp_tbl_moei_userdetails — the sole source of user → division and role.
 * `myapp_userdesignation` holds the division name for division users.
 */
export interface UserRow {
  myapp_tbl_moei_userdetailsid: string;
  myapp_username?: string;
  myapp_userid?: string;
  myapp_usermailid?: string;
  myapp_userdesignation?: string;
  myapp_userrole?: string;
  statecode: number;
}

/** myapp_tbl_moei_datasetandbusinessmap — one row per dataset attribute. */
export interface MapRow {
  myapp_tbl_moei_datasetandbusinessmapid: string;
  myapp_datasetnumber?: number;
  myapp_datasetname?: string;
  myapp_datasetdescription?: string;
  myapp_attributename?: string;
  myapp_attributedescription?: string;
  myapp_unit?: string;
  myapp_businessdivision?: string;
  myapp_attributevaluetype?: number;
  myapp_attributeclassification?: number;
  myapp_comments?: string;
  statecode: number;
}

/**
 * myapp_tbl_moei_request (display name tbl_MOEI_requests) — one row per
 * request × attribute × division value. The division is identified by
 * `myapp_divisionname`. The columns after `myapp_attributevalue` are the workflow
 * columns added for this app (see README). Each request also has one request row
 * (myapp_attributemapid = RequestRows.marker) that records the request itself;
 * on that row the columns marked "Request row" below hold the request details.
 */
export interface ValueRow {
  myapp_tbl_moei_requestid: string;
  /** Request ID the value belongs to. */
  myapp_requestid?: string;
  myapp_datasetid: string;
  myapp_datasetname?: string;
  myapp_attribute?: string;
  myapp_divisionname?: string;
  myapp_attributevalue?: string;
  myapp_attributemapid?: string;
  /** Request row: the requesting division. (Unused on value rows.) */
  myapp_divisionid?: string;
  myapp_submissionstatus?: string;
  myapp_submittedby?: string;
  myapp_submittedon?: string;
  /** Request row: overall status as last recorded (short label, see storedStatus). (Unused on value rows.) */
  myapp_reviewstatus?: string;
  /** Legacy, not read or written: decisions are recorded in tbl_MOEI_DGAdminApproval. */
  myapp_reviewedby?: string;
  myapp_reviewedon?: string;
  /** Request row: mapping IDs of the selected attributes, comma separated. (Unused on value rows.) */
  myapp_reviewcomments?: string;
  modifiedon?: string;
  createdon?: string;
}

/**
 * myapp_tbl_moei_dgadminapproval — DG Admin review log. One row per comment,
 * clarification or decision for a request (myapp_requestkey = Request ID).
 */
export interface ReviewEntryRow {
  myapp_tbl_moei_dgadminapprovalid: string;
  /** Unique entry key (alternate key): `<request>:DECISION`, `<request>:CLR:...`, `<request>:CMT:...`. */
  myapp_approvalid?: string;
  myapp_requestkey?: string;
  myapp_entrytype?: string;
  myapp_datasetname: string;
  /** Divisions owning the dataset, joined with " / ". */
  myapp_ownedby?: string;
  myapp_status?: string;
  /** Comment text, clarification question or decision reason. */
  myapp_comments?: string;
  myapp_reviewedby?: string;
  myapp_reviewedon?: string;
  myapp_attributemapid?: string;
  myapp_attributename?: string;
  myapp_divisionname?: string;
  myapp_submittedvalue?: string;
  myapp_response?: string;
  myapp_respondedby?: string;
  myapp_respondedon?: string;
  myapp_resolvedby?: string;
  myapp_resolvedon?: string;
  createdon?: string;
  modifiedon?: string;
}

export interface Clarification {
  id: string;
  key: string;
  mapId: string;
  attributeName: string;
  divisionId: string;
  divisionName: string;
  submittedValue: string;
  question: string;
  status: ClarificationStatus;
  askedBy?: string;
  askedOn?: string;
  response?: string;
  respondedBy?: string;
  respondedOn?: string;
  resolvedBy?: string;
  resolvedOn?: string;
  modifiedon?: string;
}

export interface RequestComment {
  id: string;
  text: string;
  by?: string;
  on?: string;
}

export interface Division {
  /** Normalised division name — the key shared by user rows, mapping text and value rows. */
  id: string;
  name: string;
}

export interface Attribute {
  /** Mapping row ID — the stable attribute reference. */
  mapId: string;
  name: string;
  description?: string;
  unit?: string;
  valueType?: string;
  classification?: string;
  /** Divisions resolved from the mapping text, in mapping order. */
  divisions: Division[];
  /** Raw division tokens that did not resolve to an active division. */
  unresolved: string[];
}

export interface Dataset {
  /** Dataset number as a string; stored in myapp_datasetid on value rows. */
  key: string;
  number?: number;
  name: string;
  description?: string;
  attributes: Attribute[];
  /** Classifications of the dataset's attributes (from the mapping's attribute classification). */
  classifications: string[];
  /** Union of divisions mapped to at least one attribute of this dataset. */
  divisions: Division[];
  /** Mapping problems that would make the submission gate unreliable — they block DG Admin review. */
  issues: string[];
  /** Non-blocking data-quality notes. */
  warnings: string[];
}

/**
 * The signed-in person. `upn` is the address verified by the Power Apps host
 * (the only trusted identity); everything else comes from tbl_MOEI_UserDetails.
 */
export interface UserIdentity {
  /** Display name: myapp_username from tbl_MOEI_UserDetails once resolved. */
  fullName: string;
  /** Host-verified sign-in address, matched against myapp_usermailid. */
  upn: string;
  /** myapp_userid from tbl_MOEI_UserDetails once resolved. */
  userId?: string;
}

export interface Session {
  user: UserIdentity;
  division: Division | null;
  /** DG Admin: review queue, clarifications, decisions and reports. */
  isAdmin: boolean;
  /** Admin (myapp_userrole = Admin): Admin Centre only. Never implies DG Admin. */
  isSystemAdmin?: boolean;
  /** "<role> - <designation>" from tbl_MOEI_UserDetails for non-division users. */
  roleLabel?: string;
  /** myapp_userrole and myapp_userdesignation as recorded, for the profile card. */
  role?: string;
  designation?: string;
}

export interface DivisionPortion {
  division: Division;
  status: DivisionStatus;
  submittedBy?: string;
  submittedOn?: string;
  lastUpdated?: string;
  /** Every attribute of the request mapped to this division has a Submitted row with a non-blank value. */
  complete: boolean;
  /** Attributes this division provides in the request. */
  total: number;
  /** Attributes with a Submitted, non-blank value. */
  submittedCount: number;
  /** Attributes still missing a submitted value (not saved, Draft, or submitted blank). */
  outstanding: string[];
}

/** A request and the dataset it is for: what every write operation works on. */
export interface RequestRef {
  info: RequestInfo;
  dataset: Dataset;
}

export interface RequestState {
  /** Request ID. */
  key: string;
  info: RequestInfo;
  /** The dataset narrowed to the request's selected attributes and their divisions. */
  dataset: Dataset;
  rows: ValueRow[];
  portions: DivisionPortion[];
  overall: OverallStatus;
  review?: { status: ReviewStatus; by?: string; on?: string; comments?: string };
  clarifications: Clarification[];
  comments: RequestComment[];
  /** Sign-in address (lower case) → myapp_username, for display. Filled by services. */
  names?: Record<string, string>;
  /** Sign-in address (lower case) → "<role> - <designation>" from tbl_MOEI_UserDetails. Filled by services. */
  roles?: Record<string, string>;
  issues: string[];
  warnings: string[];
  lastUpdated?: string;
}
