// Setup check for the columns the app reads and writes. Pure functions so the
// classification rules can be unit tested.

/** tbl_MOEI_UserDetails columns used for sign-in mapping, role and division. */
export const REQUIRED_USER_COLUMNS = ['myapp_usermailid', 'myapp_userrole', 'myapp_userdesignation', 'statecode'] as const;

/**
 * tbl_MOEI_requests columns. Must match README.md and
 * scripts/provision-request-columns.mjs. myapp_divisionid, myapp_reviewstatus and
 * myapp_reviewcomments hold the request details on each request's request row
 * (see RequestRows in workflow.ts); decisions live in tbl_MOEI_DGAdminApproval.
 */
export const REQUIRED_REQUEST_COLUMNS = [
  'myapp_requestid',
  'myapp_datasetid',
  'myapp_datasetname',
  'myapp_attribute',
  'myapp_divisionname',
  'myapp_attributevalue',
  'myapp_attributemapid',
  'myapp_submissionstatus',
  'myapp_submittedby',
  'myapp_submittedon',
  'myapp_divisionid',
  'myapp_reviewstatus',
  'myapp_reviewcomments',
] as const;

/**
 * tbl_MOEI_DGAdminApproval columns used as the DG Admin review log (comments,
 * clarifications, decisions). Must match scripts/provision-dgadmin-approval.mjs.
 */
export const REQUIRED_REVIEW_COLUMNS = [
  'myapp_approvalid',
  'myapp_requestkey',
  'myapp_entrytype',
  'myapp_datasetname',
  'myapp_ownedby',
  'myapp_status',
  'myapp_comments',
  'myapp_reviewedby',
  'myapp_reviewedon',
  'myapp_attributemapid',
  'myapp_attributename',
  'myapp_divisionname',
  'myapp_submittedvalue',
  'myapp_response',
  'myapp_respondedby',
  'myapp_respondedon',
  'myapp_resolvedby',
  'myapp_resolvedon',
] as const;


export type SchemaCheck =
  | { kind: 'ready' }
  /** The table was read successfully and these columns are definitely absent. */
  | { kind: 'missing'; columns: string[] }
  /** The schema could not be confirmed (connection, permission or host error). */
  | { kind: 'unavailable'; detail: string };

/** Compare a table's actual column list against the required columns. */
export function checkColumns(actualLogicalNames: readonly string[], required: readonly string[]): SchemaCheck {
  const actual = new Set(actualLogicalNames.map((n) => n.toLowerCase()));
  const missing = required.filter((c) => !actual.has(c));
  return missing.length ? { kind: 'missing', columns: missing } : { kind: 'ready' };
}

/**
 * Classify a failed query that selected the required columns. Dataverse names the
 * unknown column ("Could not find a property named 'x'"); only then is it reported
 * as missing. Anything else (network, 401/403, throttling) is "unavailable".
 */
export function classifyProbeError(message: string, required: readonly string[]): SchemaCheck {
  const named = [...message.matchAll(/property named '([a-z0-9_]+)'/gi)].map((m) => m[1].toLowerCase());
  const missing = required.filter((c) => named.includes(c));
  if (missing.length) return { kind: 'missing', columns: missing };
  return { kind: 'unavailable', detail: message };
}
