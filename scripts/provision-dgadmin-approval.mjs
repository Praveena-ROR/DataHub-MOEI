// Extends tbl_MOEI_DGAdminApproval (myapp_tbl_moei_dgadminapproval) into the
// DG Admin review log: one row per comment, clarification or decision for a
// request. Additive and idempotent; touches only this table.
//
// Usage (Azure CLI signed in as System Customizer/Administrator):
//   node scripts/provision-dgadmin-approval.mjs https://<org>.crm.dynamics.com
import { addAlternateKey, addColumns, connect, dateTime, memo, publish, text, widenTextColumn } from './lib/dataverse-admin.mjs';

const TABLE = 'myapp_tbl_moei_dgadminapproval';
const dv = connect(process.argv[2]);

// Existing columns reused: myapp_approvalid (unique entry key), myapp_datasetname,
// myapp_status, myapp_comments (text), myapp_reviewedby / myapp_reviewedon (author, time).
// Must match REQUIRED_REVIEW_COLUMNS in src/data/schema.ts and README.md.
await addColumns(dv, TABLE, [
  text('myapp_RequestKey', 'RequestKey', 100, 'Request identifier: myapp_datasetid of the request value rows (dataset number)'),
  text('myapp_EntryType', 'EntryType', 20, 'Comment, Clarification or Decision'),
  text('myapp_AttributeMapId', 'AttributeMapID', 100, 'Clarification: tbl_MOEI_DatasetAndBusinessMap row of the attribute'),
  text('myapp_AttributeName', 'AttributeName', 100, 'Clarification: attribute name when the question was asked'),
  text('myapp_DivisionName', 'DivisionName', 100, 'Clarification: business division responsible for the value'),
  text('myapp_SubmittedValue', 'SubmittedValue', 100, 'Clarification: the submitted value the question refers to'),
  memo('myapp_Response', 'Response', 2000, 'Clarification: the division response'),
  text('myapp_RespondedBy', 'RespondedBy', 320, 'Clarification: sign-in address of the responder'),
  dateTime('myapp_RespondedOn', 'RespondedOn', 'Clarification: when the division responded'),
  text('myapp_ResolvedBy', 'ResolvedBy', 320, 'Clarification: DG Admin who marked it resolved'),
  dateTime('myapp_ResolvedOn', 'ResolvedOn', 'Clarification: when it was marked resolved'),
]);

// Comments, questions and rejection reasons need more than the original 100 characters.
await widenTextColumn(dv, TABLE, 'myapp_comments', 2000);

await publish(dv, [TABLE]);

// One row per entry key; also makes "one decision per request" a server-side rule.
await addAlternateKey(dv, TABLE, 'myapp_key_approvalid', 'Approval ID key', ['myapp_approvalid']);
