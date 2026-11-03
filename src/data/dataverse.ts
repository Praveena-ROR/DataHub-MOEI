// Thin wrapper over the Power Apps Code App data client — the same mechanism the
// generated services in src/generated use. All Dataverse calls go through here.
import { getClient, type IOperationResult } from '@microsoft/power-apps/data';
import { dataSourcesInfo } from '../../.power/schemas/appschemas/dataSourcesInfo';
import { Myapp_tbl_moei_requestsService } from '../generated/services/Myapp_tbl_moei_requestsService';
import { Myapp_tbl_moei_userdetailsesService } from '../generated/services/Myapp_tbl_moei_userdetailsesService';
import { Myapp_tbl_moei_dgadminapprovalsService } from '../generated/services/Myapp_tbl_moei_dgadminapprovalsService';

/** Data source names as registered in power.config.json / dataSourcesInfo. */
export const Tables = {
  users: 'myapp_tbl_moei_userdetailses',
  mappings: 'myapp_tbl_moei_datasetandbusinessmaps',
  requests: 'myapp_tbl_moei_requests',
  reviews: 'myapp_tbl_moei_dgadminapprovals',
  /** tbl_MOEI_DatasetWithAttributes: one row per dataset, attribute names in 45 fixed columns. */
  references: 'myapp_tbl_moei_datasetwithattributeses',
  /** tbl_MOEI_AssistantConversation: Business Division Assistant conversations, user-owned. */
  assistant: 'myapp_tbl_moei_assistantconversations',
} as const;

export type SchemaTable = 'users' | 'requests' | 'reviews';

const client = getClient(dataSourcesInfo);

export class DataverseError extends Error {}

function unwrap<T>(result: IOperationResult<T>, action: string): T {
  if (!result.success) {
    if (import.meta.env.DEV) console.error(`[dataverse] ${action} failed`, result.error);
    throw new DataverseError(`${action} failed. ${result.error?.message ?? 'Dataverse could not be reached.'}`);
  }
  return result.data;
}

/** Escape a value for an OData string literal. */
export const odataString = (value: string) => `'${value.replace(/'/g, "''")}'`;

export interface Query {
  select?: string[];
  filter?: string;
  orderBy?: string[];
  top?: number;
}

/** Retrieve all pages for a query. */
export async function retrieveAll<T>(table: string, query: Query): Promise<T[]> {
  const out: T[] = [];
  let skipToken: string | undefined;
  do {
    const result = await client.retrieveMultipleRecordsAsync<T>(table, { ...query, maxPageSize: 500, skipToken });
    out.push(...unwrap(result, `Reading ${table}`));
    skipToken = query.top ? undefined : result.skipToken;
  } while (skipToken);
  return out;
}

export async function createRecord<T extends object>(table: string, record: T): Promise<void> {
  unwrap(await client.createRecordAsync<T, unknown>(table, record), `Saving to ${table}`);
}

/** Create a record and return its primary key value (`idColumn`). */
export async function createRecordReturningId<T extends object>(table: string, record: T, idColumn: string): Promise<string> {
  const created = unwrap(await client.createRecordAsync<T, Record<string, unknown>>(table, record), `Saving to ${table}`);
  const id = created?.[idColumn];
  if (typeof id !== 'string' || !id) throw new DataverseError(`Saving to ${table} failed. The new record ID was not returned.`);
  return id;
}

/** Read one record by ID. */
export async function retrieveRecord<T>(table: string, id: string, select: string[]): Promise<T> {
  return unwrap(await client.retrieveRecordAsync<T>(table, id, { select }), `Reading ${table}`);
}

export async function updateRecord<T extends object>(table: string, id: string, changes: T): Promise<void> {
  unwrap(await client.updateRecordAsync<T, unknown>(table, id, changes), `Updating ${table}`);
}

/** Logical names of every column on a table, via the generated metadata API. */
export async function readTableColumns(table: SchemaTable): Promise<string[] | null> {
  const options = { schema: { columns: 'all' as const } };
  const result = table === 'users'
    ? await Myapp_tbl_moei_userdetailsesService.getMetadata(options)
    : table === 'reviews'
      ? await Myapp_tbl_moei_dgadminapprovalsService.getMetadata(options)
      : await Myapp_tbl_moei_requestsService.getMetadata(options);
  const meta = unwrap(result, `Reading ${table} metadata`);
  return meta.Attributes?.map((a) => a.LogicalName) ?? null;
}
