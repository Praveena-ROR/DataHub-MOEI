// Shared helpers for the provisioning scripts: Dataverse Web API metadata calls
// using an Azure CLI token. Additive only; nothing here deletes schema or data.
import { execSync } from 'node:child_process';

export function connect(orgUrlArg) {
  const orgUrl = (orgUrlArg || '').replace(/\/$/, '');
  if (!/^https:\/\/[\w.-]+\.dynamics\.com$/.test(orgUrl)) {
    console.error('Usage: node <script> https://<org>.crm.dynamics.com');
    process.exit(1);
  }
  const token = execSync(`az account get-access-token --resource ${orgUrl} --query accessToken -o tsv`).toString().trim();
  const api = `${orgUrl}/api/data/v9.2`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'OData-Version': '4.0',
    'OData-MaxVersion': '4.0',
  };
  const call = async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(`${api}/${path}`, { method, headers: { ...headers, ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return { call };
}

const label = (text) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.Label',
  LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: text, LanguageCode: 1033 }],
});
const base = (schema, display, desc) => ({
  SchemaName: schema, DisplayName: label(display), Description: label(desc), RequiredLevel: { Value: 'None' },
});
export const text = (schema, display, max, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata', ...base(schema, display, desc),
  MaxLength: max, FormatName: { Value: 'Text' },
});
export const memo = (schema, display, max, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.MemoAttributeMetadata', ...base(schema, display, desc),
  MaxLength: max, Format: 'TextArea',
});
export const dateTime = (schema, display, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata', ...base(schema, display, desc),
  Format: 'DateAndTime', DateTimeBehavior: { Value: 'UserLocal' },
});

/** Create any of `columns` that don't exist yet on `table`. */
export async function addColumns({ call }, table, columns) {
  const existing = new Set((await call('GET', `EntityDefinitions(LogicalName='${table}')/Attributes?$select=LogicalName`)).value.map((a) => a.LogicalName));
  for (const col of columns) {
    const logical = col.SchemaName.toLowerCase();
    if (existing.has(logical)) {
      console.log(`skip   ${table}.${logical} (exists)`);
      continue;
    }
    await call('POST', `EntityDefinitions(LogicalName='${table}')/Attributes`, col);
    console.log(`added  ${table}.${logical}`);
  }
}

/** Raise a text column's maximum length (never lowers it). */
export async function widenTextColumn({ call }, table, column, maxLength) {
  const path = `EntityDefinitions(LogicalName='${table}')/Attributes(LogicalName='${column}')/Microsoft.Dynamics.CRM.StringAttributeMetadata`;
  const attr = await call('GET', path);
  if (attr.MaxLength >= maxLength) {
    console.log(`skip   ${table}.${column} (MaxLength ${attr.MaxLength})`);
    return;
  }
  const { '@odata.context': _ctx, ...definition } = attr;
  await call('PUT', `EntityDefinitions(LogicalName='${table}')/Attributes(LogicalName='${column}')`,
    { ...definition, '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata', MaxLength: maxLength },
    { 'MSCRM.MergeLabels': 'true' });
  console.log(`widened ${table}.${column} ${attr.MaxLength} -> ${maxLength}`);
}

/** Create an alternate key unless one with the same schema name exists. */
export async function addAlternateKey({ call }, table, schemaName, display, attributes) {
  const keys = (await call('GET', `EntityDefinitions(LogicalName='${table}')/Keys?$select=SchemaName,KeyAttributes,EntityKeyIndexStatus`)).value;
  const found = keys.find((k) => k.SchemaName.toLowerCase() === schemaName.toLowerCase());
  if (found) {
    console.log(`skip   key ${schemaName} (${found.EntityKeyIndexStatus})`);
    return;
  }
  await call('POST', `EntityDefinitions(LogicalName='${table}')/Keys`, {
    SchemaName: schemaName, DisplayName: label(display), KeyAttributes: attributes,
  });
  console.log(`added  key ${schemaName} on ${attributes.join(', ')} (index builds asynchronously)`);
}

export async function publish({ call }, tables) {
  await call('POST', 'PublishXml', {
    ParameterXml: `<importexportxml><entities>${tables.map((t) => `<entity>${t}</entity>`).join('')}</entities></importexportxml>`,
  });
  console.log(`published ${tables.join(', ')}`);
}
