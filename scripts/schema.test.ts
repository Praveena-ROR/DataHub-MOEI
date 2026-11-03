// Unit tests for the setup (schema) check in src/data/schema.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkColumns, classifyProbeError, REQUIRED_REQUEST_COLUMNS, REQUIRED_REVIEW_COLUMNS, REQUIRED_USER_COLUMNS } from '../src/data/schema.ts';

test('schema: ready when every required column exists (plus system columns)', () => {
  assert.deepEqual(checkColumns([...REQUIRED_REQUEST_COLUMNS, 'createdon', 'myapp_tbl_moei_requestid'], REQUIRED_REQUEST_COLUMNS), { kind: 'ready' });
  // Actual tbl_MOEI_UserDetails columns as read from Dataverse.
  const userTable = ['myapp_tbl_moei_userdetailsid', 'myapp_username', 'myapp_userid', 'myapp_usermailid', 'myapp_userdesignation', 'myapp_userrole', 'statecode', 'statuscode'];
  assert.deepEqual(checkColumns(userTable, REQUIRED_USER_COLUMNS), { kind: 'ready' });
});

test('schema: reports exactly the missing columns', () => {
  const r = checkColumns(REQUIRED_REQUEST_COLUMNS.filter((c) => c !== 'myapp_submissionstatus' && c !== 'myapp_submittedon'), REQUIRED_REQUEST_COLUMNS);
  assert.deepEqual(r, { kind: 'missing', columns: ['myapp_submissionstatus', 'myapp_submittedon'] });
  assert.deepEqual(checkColumns(['myapp_usermailid', 'statecode'], REQUIRED_USER_COLUMNS), { kind: 'missing', columns: ['myapp_userrole', 'myapp_userdesignation'] });
});

test('schema: the request-row columns are required; the other legacy columns are not', () => {
  for (const c of ['myapp_requestid', 'myapp_divisionid', 'myapp_reviewstatus', 'myapp_reviewcomments']) {
    assert.equal((REQUIRED_REQUEST_COLUMNS as readonly string[]).includes(c), true, c);
  }
  for (const c of ['myapp_reviewedby', 'myapp_reviewedon']) {
    assert.equal((REQUIRED_REQUEST_COLUMNS as readonly string[]).includes(c), false, c);
  }
});

test('schema: review log columns are checked on tbl_MOEI_DGAdminApproval', () => {
  const original = ['myapp_approvalid', 'myapp_comments', 'myapp_datasetname', 'myapp_ownedby', 'myapp_reviewedby', 'myapp_reviewedon', 'myapp_status'];
  const r = checkColumns(original, REQUIRED_REVIEW_COLUMNS);
  assert.equal(r.kind, 'missing', 'the table as originally created lacks the review-log columns');
  assert.deepEqual(checkColumns([...REQUIRED_REVIEW_COLUMNS], REQUIRED_REVIEW_COLUMNS), { kind: 'ready' });
});

test('schema: only a named unknown required column counts as missing; other failures are "unavailable"', () => {
  // Exact message returned by Dataverse for an unknown $select column.
  const real = "Reading myapp_tbl_moei_requests failed. Could not find a property named 'myapp_submittedby' on type 'Microsoft.Dynamics.CRM.myapp_tbl_moei_request'.";
  assert.deepEqual(classifyProbeError(real, REQUIRED_REQUEST_COLUMNS), { kind: 'missing', columns: ['myapp_submittedby'] });
  assert.equal(classifyProbeError('Reading myapp_tbl_moei_requests failed. Failed to fetch', REQUIRED_REQUEST_COLUMNS).kind, 'unavailable');
  assert.equal(classifyProbeError('403 Forbidden: principal user is missing prvReadmyapp_tbl_moei_userdetails', REQUIRED_USER_COLUMNS).kind, 'unavailable');
  assert.equal(classifyProbeError("Could not find a property named 'someothercolumn'", REQUIRED_REQUEST_COLUMNS).kind, 'unavailable');
});

test('schema: the value-row Request ID is required', () => {
  assert.equal((REQUIRED_REQUEST_COLUMNS as readonly string[]).includes('myapp_requestid'), true);
});
