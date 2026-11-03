// Adds the workflow columns documented in README.md to tbl_MOEI_requests
// (logical name myapp_tbl_moei_request). Additive and idempotent: columns that
// already exist are skipped. Touches no other table.
//
// Usage (Azure CLI signed in as a user with System Customizer/Administrator):
//   node scripts/provision-request-columns.mjs https://<org>.crm.dynamics.com
import { execSync } from 'node:child_process';

const orgUrl = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https:\/\/[\w.-]+\.dynamics\.com$/.test(orgUrl)) {
  console.error('Usage: node scripts/provision-request-columns.mjs https://<org>.crm.dynamics.com');
  process.exit(1);
}
const token = execSync(`az account get-access-token --resource ${orgUrl} --query accessToken -o tsv`).toString().trim();
const api = `${orgUrl}/api/data/v9.2`;
const TABLE = 'myapp_tbl_moei_request';

const label = (text) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.Label',
  LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: text, LanguageCode: 1033 }],
});
const base = (schema, display, desc) => ({
  SchemaName: schema, DisplayName: label(display), Description: label(desc), RequiredLevel: { Value: 'None' },
});
const text = (schema, display, max, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata', ...base(schema, display, desc),
  MaxLength: max, FormatName: { Value: 'Text' },
});
const memo = (schema, display, max, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.MemoAttributeMetadata', ...base(schema, display, desc),
  MaxLength: max, Format: 'TextArea',
});
const dateTime = (schema, display, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata', ...base(schema, display, desc),
  Format: 'DateAndTime', DateTimeBehavior: { Value: 'UserLocal' },
});

// Must match README.md and REQUIRED_REQUEST_COLUMNS in src/data/schema.ts.
const columns = [
  text('myapp_AttributeMapId', 'AttributeMapID', 100, 'ID of the tbl_MOEI_DatasetAndBusinessMap row this value belongs to'),
  text('myapp_DivisionId', 'DivisionID', 100, 'Request row: the requesting division'),
  text('myapp_SubmissionStatus', 'SubmissionStatus', 20, 'Division submission status: Draft or Submitted'),
  text('myapp_SubmittedBy', 'SubmittedBy', 320, 'Sign-in address of the user who submitted the division portion'),
  dateTime('myapp_SubmittedOn', 'SubmittedOn', 'When the division portion was submitted'),
  text('myapp_ReviewStatus', 'ReviewStatus', 20, 'Request row: overall status as last recorded'),
  text('myapp_ReviewedBy', 'ReviewedBy', 320, 'Sign-in address of the DG Admin who recorded the decision'),
  dateTime('myapp_ReviewedOn', 'ReviewedOn', 'When the DG Admin decision was recorded'),
  memo('myapp_ReviewComments', 'ReviewComments', 2000, 'Request row: mapping IDs of the selected attributes'),
];

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
  'Content-Type': 'application/json; charset=utf-8',
  'OData-Version': '4.0',
  'OData-MaxVersion': '4.0',
};

const existingRes = await fetch(`${api}/EntityDefinitions(LogicalName='${TABLE}')/Attributes?$select=LogicalName`, { headers });
if (!existingRes.ok) throw new Error(`Could not read table metadata: ${existingRes.status} ${await existingRes.text()}`);
const existing = new Set((await existingRes.json()).value.map((a) => a.LogicalName));

for (const col of columns) {
  const logical = col.SchemaName.toLowerCase();
  if (existing.has(logical)) {
    console.log(`skip   ${logical} (exists)`);
    continue;
  }
  const res = await fetch(`${api}/EntityDefinitions(LogicalName='${TABLE}')/Attributes`, {
    method: 'POST', headers, body: JSON.stringify(col),
  });
  if (!res.ok) throw new Error(`Failed to create ${logical}: ${res.status} ${await res.text()}`);
  console.log(`added  ${logical}`);
}

const pub = await fetch(`${api}/PublishXml`, {
  method: 'POST', headers,
  body: JSON.stringify({ ParameterXml: `<importexportxml><entities><entity>${TABLE}</entity></entities></importexportxml>` }),
});
if (!pub.ok) throw new Error(`Publish failed: ${pub.status} ${await pub.text()}`);
console.log('published');
