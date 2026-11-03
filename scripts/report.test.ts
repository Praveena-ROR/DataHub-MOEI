// Unit tests for the final PDF report (src/report). Fixtures are test-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDatasets, deriveRequestState, divisionsFromUsers } from '../src/data/workflow.ts';
import { BLANK_VALUE, buildReportModel, cleanText, REPORT_TITLE } from '../src/report/reportModel.ts';
import { renderReportPdf, reportFileName } from '../src/report/pdf.ts';
import type { MapRow, RequestInfo, ReviewEntryRow, UserRow, ValueRow } from '../src/data/types.ts';

const USERS: UserRow[] = ['Generation', 'BD&E'].map((d, i) => ({
  myapp_tbl_moei_userdetailsid: `u${i}`, myapp_usermailid: `${i}@x`, myapp_userdesignation: d, myapp_userrole: 'BusinessDivision', statecode: 0,
}));
const map = (id: string, attr: string, division: string): MapRow => ({
  myapp_tbl_moei_datasetandbusinessmapid: id, myapp_datasetnumber: 2, myapp_datasetname: 'Electricity Generation',
  myapp_attributename: attr, myapp_businessdivision: division, myapp_unit: 'GWh', statecode: 0,
});
const DATASET = buildDatasets([map('steam', 'Steam Turbines', 'Generation'), map('gas', 'Natural Gas', 'Generation / BD&E'), map('solar', 'Solar PV', 'BD&E')], divisionsFromUsers(USERS))[0];
const KEY = 'REQ_0042';
const INFO: RequestInfo = {
  key: KEY, datasetKey: '2', requestedBy: 'gen@x', requestingDivision: 'Generation', selectedAttributes: [], createdOn: '2026-10-15T08:00:00Z',
};
const value = (mapId: string, division: string, v: string, on: string): ValueRow => ({
  myapp_tbl_moei_requestid: `${mapId}-${division}`, myapp_requestid: KEY, myapp_datasetid: '2', myapp_attributemapid: mapId, myapp_divisionname: division,
  myapp_attributevalue: v, myapp_submissionstatus: 'Submitted', myapp_submittedby: division === 'Generation' ? 'gen@x' : 'bde@x', myapp_submittedon: on,
  createdon: '2026-10-15T08:30:00Z', modifiedon: on,
});
const ROWS = [
  value('steam', 'Generation', '1200', '2026-10-15T09:00:00Z'),
  value('gas', 'Generation', '100', '2026-10-15T09:00:00Z'),
  value('gas', 'BD&E', '200', '2026-10-15T10:00:00Z'),
  value('solar', 'BD&E', '30', '2026-10-15T10:00:00Z'),
];
const LONG = 'This comment is deliberately long so that it wraps across many lines in the report table. '.repeat(60);
const entry = (id: string, extra: Partial<ReviewEntryRow>): ReviewEntryRow => ({
  myapp_tbl_moei_dgadminapprovalid: id, myapp_requestkey: KEY, myapp_datasetname: 'Electricity Generation', createdon: extra.myapp_reviewedon, ...extra,
});
const ENTRIES = [
  entry('c1', { myapp_approvalid: `${KEY}:CLR:gas:bd&e:1`, myapp_entrytype: 'Clarification', myapp_status: 'Resolved', myapp_attributemapid: 'gas', myapp_attributename: 'Natural Gas',
    myapp_divisionname: 'BD&E', myapp_submittedvalue: '200', myapp_comments: 'Why 200?', myapp_reviewedby: 'admin@x', myapp_reviewedon: '2026-10-15T11:00:00Z',
    myapp_response: 'Includes imports', myapp_respondedby: 'bde@x', myapp_respondedon: '2026-10-15T11:30:00Z', myapp_resolvedby: 'admin@x', myapp_resolvedon: '2026-10-15T11:45:00Z' }),
  entry('c2', { myapp_approvalid: `${KEY}:CLR:gas:bd&e:2`, myapp_entrytype: 'Clarification', myapp_status: 'Resolved', myapp_attributemapid: 'gas', myapp_attributename: 'Natural Gas',
    myapp_divisionname: 'BD&E', myapp_submittedvalue: '200', myapp_comments: 'Follow-up: which imports?', myapp_reviewedby: 'admin@x', myapp_reviewedon: '2026-10-15T11:50:00Z',
    myapp_response: 'Oman pipeline', myapp_respondedby: 'bde@x', myapp_respondedon: '2026-10-15T12:00:00Z', myapp_resolvedby: 'admin@x', myapp_resolvedon: '2026-10-15T12:05:00Z' }),
  entry('m1', { myapp_approvalid: `${KEY}:CMT:1`, myapp_entrytype: 'Comment', myapp_comments: LONG, myapp_reviewedby: 'admin@x', myapp_reviewedon: '2026-10-15T12:10:00Z' }),
  entry('d1', { myapp_approvalid: `${KEY}:DECISION`, myapp_entrytype: 'Decision', myapp_status: 'Rejected', myapp_comments: 'Figures do not reconcile', myapp_reviewedby: 'admin@x', myapp_reviewedon: '2026-10-15T13:00:00Z' }),
];
const NAMES = { 'gen@x': 'Gen Steward', 'bde@x': 'BDE Steward', 'admin@x': 'DG Reviewer' };
const ROLES = { 'admin@x': 'DG Admin - Admin', 'gen@x': 'BusinessDivision - Generation' };
const decided = () => ({ ...deriveRequestState({ info: INFO, dataset: DATASET }, ROWS, ENTRIES), names: NAMES, roles: ROLES });
const fmt = (iso?: string) => iso ?? '';

test('report: refused before a decision is recorded', () => {
  const pending = deriveRequestState({ info: INFO, dataset: DATASET }, ROWS, ENTRIES.filter((e) => e.myapp_entrytype !== 'Decision'));
  assert.equal(pending.overall, 'Pending DG Admin Review');
  assert.throws(() => buildReportModel(pending, '2026-10-15T14:00:00Z', fmt));
});

test('report: summary, separate shared values, clarifications and decision come from the stored data', () => {
  const m = buildReportModel(decided(), '2026-10-15T14:00:00Z', fmt);
  assert.equal(m.title, REPORT_TITLE);
  assert.equal(m.requestKey, KEY);
  assert.equal(m.status, 'Rejected');
  const summary = Object.fromEntries(m.summary);
  assert.equal(summary['Created by'], 'Gen Steward', 'the name of the person who created the request');
  assert.equal(summary['Requesting division(s)'], 'Generation, BD&E', 'every division in the request, listed once');
  assert.equal(summary['Participating divisions'], undefined);
  assert.equal(summary['Reviewed by'], 'DG Reviewer (DG Admin - Admin)', 'reviewer name with role');
  assert.deepEqual(Object.keys(m.divisions[0]), ['division', 'status', 'submittedBy', 'submittedOn'], 'no last-saved column');

  const gas = m.values.filter((v) => v.attribute === 'Natural Gas');
  assert.deepEqual(gas.map((v) => [v.division, v.value]), [['Generation', '100'], ['BD&E', '200']], 'shared attribute values are never combined');
  assert.equal(m.values.find((v) => v.attribute === 'Solar PV')!.value, '30');
  // A blank stored value (possible only in data saved before blanks were refused) is labelled, not invented.
  const legacyBlank = { ...deriveRequestState({ info: INFO, dataset: DATASET }, ROWS.map((x) => (x.myapp_attributemapid === 'solar' ? { ...x, myapp_attributevalue: '' } : x)), ENTRIES), names: NAMES };
  assert.equal(buildReportModel(legacyBlank, '2026-10-15T14:00:00Z', fmt).values.find((v) => v.attribute === 'Solar PV')!.value, BLANK_VALUE);

  assert.equal(m.clarifications.length, 2, 'every clarification round is listed');
  assert.deepEqual([m.clarifications[0].question, m.clarifications[0].response, m.clarifications[0].respondedBy], ['Why 200?', 'Includes imports', 'BDE Steward']);
  assert.equal(m.clarifications[1].question, 'Follow-up: which imports?');
  assert.equal('comments' in m, false, 'general request comments are not part of the report');
  assert.deepEqual(Object.fromEntries(m.decision)['Rejection reason'], 'Figures do not reconcile');
  assert.equal(Object.fromEntries(m.decision)['Reviewed by'], 'DG Reviewer (DG Admin - Admin)');
});

test('report: timeline holds only persisted events, in order, ending with the report itself', () => {
  const m = buildReportModel(decided(), '2026-10-15T14:00:00Z', fmt);
  const ons = m.timeline.map((e) => e.on);
  assert.deepEqual([...ons].sort(), ons, 'chronological');
  assert.match(m.timeline[0].event, new RegExp(`Request ${KEY} created by Gen Steward`));
  assert.ok(m.timeline.some((e) => /All participating divisions submitted/.test(e.event)));
  assert.ok(m.timeline.some((e) => /rejected by DG Reviewer \(DG Admin - Admin\)/.test(e.event)));
  assert.equal(m.timeline.filter((e) => /comment/i.test(e.event)).length, 0, 'no general comment events');
  assert.equal(m.timeline.at(-1)!.event, 'This report generated');
  assert.equal(m.timeline.filter((e) => /draft/i.test(e.event)).length, 0, 'no draft-save events are invented');
  assert.ok(m.notes.some((n) => /draft saves are not kept/.test(n)), 'the audit limitation is stated');
});

test('report: user text is cleaned of control characters', () => {
  assert.equal(cleanText('a\u0000b\u0007c\r\nd\t e'), 'abc\nd e');
});

test('pdf: multi-page report with page numbers, running header and the title on page 1', () => {
  const state = decided();
  const many = Array.from({ length: 40 }, (_, i) => map(`a${i}`, `Attribute ${i} with a fairly long descriptive name for wrapping`, i % 3 ? 'Generation' : 'Generation / BD&E'));
  const big = buildDatasets(many, divisionsFromUsers(USERS))[0];
  const bigState = { ...deriveRequestState({ info: INFO, dataset: big }, [], ENTRIES), names: NAMES };
  for (const s of [state, bigState]) {
    const model = buildReportModel(s, '2026-10-15T14:00:00Z', fmt);
    const doc = renderReportPdf(model);
    const pages = doc.getNumberOfPages();
    const pageText = (n: number) => (doc.internal as unknown as { pages: string[][] }).pages[n].join('\n');
    assert.ok(pageText(1).includes(REPORT_TITLE), 'page 1 starts with the report title (no blank leading page)');
    for (let p = 1; p <= pages; p++) {
      assert.ok(pageText(p).includes(`Page ${p} of ${pages}`), `page ${p} is numbered`);
      assert.ok(pageText(p).includes(KEY), `page ${p} shows the Request ID`);
    }
    if (s === bigState) assert.ok(pages >= 3, `long reports span several pages (got ${pages})`);
    assert.ok(doc.output('arraybuffer').byteLength > 1000);
  }
  assert.equal(reportFileName(buildReportModel(state, '2026-10-15T14:00:00Z', fmt)), `${KEY}-report.pdf`);
});
