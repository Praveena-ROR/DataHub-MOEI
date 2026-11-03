// Content of the final request report, built from a request state that was
// freshly read from Dataverse. Pure, so it can be unit tested. Only persisted
// data is used: the timeline lists events whose timestamps Dataverse holds and
// never invents intermediate history (for example individual draft saves).
import { personName } from '../components/format.ts';
import { attributesFor, datasetId, rowDivisionId } from '../data/workflow.ts';
import type { RequestState } from '../data/types.ts';

export const REPORT_TITLE = 'Data Division Dataset Request Report';
export const BLANK_VALUE = 'Blank / Not provided';

export interface ReportValueRow {
  attribute: string;
  attributeId: string;
  unit: string;
  classification: string;
  division: string;
  value: string;
  valueStatus: string;
  submitted: string;
}

export interface ReportTimelineEvent {
  on: string;
  event: string;
}

export interface ReportModel {
  title: string;
  generatedAt: string;
  requestKey: string;
  status: string;
  summary: [string, string][];
  divisions: { division: string; status: string; submittedBy: string; submittedOn: string }[];
  values: ReportValueRow[];
  timeline: ReportTimelineEvent[];
  clarifications: {
    id: string;
    attribute: string;
    division: string;
    submittedValue: string;
    question: string;
    askedBy: string;
    askedOn: string;
    response: string;
    respondedBy: string;
    respondedOn: string;
    status: string;
    resolvedBy: string;
    resolvedOn: string;
  }[];
  decision: [string, string][];
  notes: string[];
}

/** Remove control characters so user text can't disturb the PDF layout. */
export const cleanText = (s: string | undefined | null) =>
  [...(s ?? '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ')]
    .filter((ch) => ch === '\n' || (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127))
    .join('')
    .trim();

export type DateFormatter = (iso?: string) => string;

const latest = (dates: (string | undefined)[]) => dates.filter((d): d is string => !!d).sort().at(-1);
const earliest = (dates: (string | undefined)[]) => dates.filter((d): d is string => !!d).sort()[0];

/**
 * Build the report content. `state` must carry a recorded decision; callers
 * read it from Dataverse immediately before generating the report.
 */
export function buildReportModel(state: RequestState, generatedAtIso: string, formatDate: DateFormatter): ReportModel {
  if (!state.review) throw new Error('The report can only be produced after a decision is recorded.');
  const who = (upn?: string) => (upn ? cleanText(personName(state.names, upn)) : 'Not recorded');
  /** Name plus "<role> - <designation>" from tbl_MOEI_UserDetails, e.g. "Praveena (DG Admin - Admin)". */
  const whoWithRole = (upn?: string) => {
    const role = upn ? state.roles?.[upn.trim().toLowerCase()] : undefined;
    return role ? `${who(upn)} (${cleanText(role)})` : who(upn);
  };
  const when = (iso?: string) => (iso ? formatDate(iso) : 'Not recorded');
  const { info, dataset, review } = state;
  const submittedOn = state.portions.every((p) => p.complete) ? latest(state.portions.map((p) => p.submittedOn)) : undefined;

  const summary: [string, string][] = [
    ['Request ID', state.key],
    ['Dataset', `${datasetId(dataset)} - ${cleanText(dataset.name)}`],
    ['Dataset description', cleanText(dataset.description) || 'Not recorded'],
    ['Created on', when(info.createdOn)],
    ['Created by', who(info.requestedBy)],
    ['Requesting division(s)', dataset.divisions.map((d) => d.name).join(', ') || 'None'],
    ['All divisions submitted on', when(submittedOn)],
    ['Final status', state.overall],
    ['Decision on', when(review.on)],
    ['Reviewed by', whoWithRole(review.by)],
  ];

  const divisions = state.portions.map((p) => ({
    division: p.division.name,
    status: p.status,
    submittedBy: p.submittedBy ? who(p.submittedBy) : '-',
    submittedOn: p.submittedOn ? when(p.submittedOn) : '-',
  }));

  const values: ReportValueRow[] = [];
  for (const a of dataset.attributes) {
    for (const d of a.divisions) {
      const row = state.rows.find((r) => r.myapp_attributemapid === a.mapId && rowDivisionId(r) === d.id);
      const value = cleanText(row?.myapp_attributevalue);
      values.push({
        attribute: cleanText(a.name),
        attributeId: a.mapId,
        unit: cleanText(a.unit) || '-',
        classification: a.classification ?? '-',
        division: d.name,
        value: value || BLANK_VALUE,
        valueStatus: row?.myapp_submissionstatus ?? 'Not entered',
        submitted: row?.myapp_submittedon ? `${when(row.myapp_submittedon)}${row.myapp_submittedby ? ` by ${who(row.myapp_submittedby)}` : ''}` : '-',
      });
    }
  }

  const timeline: ReportTimelineEvent[] = [];
  const add = (on: string | undefined, event: string) => { if (on) timeline.push({ on, event }); };
  add(info.createdOn, `Request ${state.key} created by ${who(info.requestedBy)}${info.requestingDivision ? ` (${cleanText(info.requestingDivision)})` : ''}`);
  for (const p of state.portions) {
    const own = state.rows.filter((r) => rowDivisionId(r) === p.division.id);
    add(earliest(own.map((r) => r.createdon)), `${p.division.name}: first values saved`);
    if (p.complete) add(p.submittedOn, `${p.division.name}: contribution submitted by ${who(p.submittedBy)}`);
  }
  add(submittedOn, 'All participating divisions submitted; request ready for DG Admin review');
  for (const c of state.clarifications) {
    add(c.askedOn, `Clarification requested from ${c.divisionName} on ${cleanText(c.attributeName)} by ${who(c.askedBy)}`);
    add(c.respondedOn, `${c.divisionName} responded to the clarification on ${cleanText(c.attributeName)} (${who(c.respondedBy)})`);
    add(c.resolvedOn, `Clarification on ${cleanText(c.attributeName)} (${c.divisionName}) resolved by ${who(c.resolvedBy)}`);
  }
  add(review.on, `Request ${review.status.toLowerCase()} by ${whoWithRole(review.by)}`);
  timeline.sort((a, b) => a.on.localeCompare(b.on));
  const events = [...timeline.map((e) => ({ on: when(e.on), event: e.event })), { on: when(generatedAtIso), event: 'This report generated' }];

  const notes = [
    'Generated from the records stored in Dataverse at the time shown above.',
    'The timeline lists only events that Dataverse records. Individual draft saves are not kept, so only each division\'s first save and its submission are shown.',
  ];
  if (state.issues.length) notes.push(`Data issues at generation time: ${state.issues.map(cleanText).join(' ')}`);
  const unmatched = state.rows.filter((r) => !attributesFor(dataset, rowDivisionId(r)).some((a) => a.mapId === r.myapp_attributemapid));
  if (unmatched.length) notes.push(`${unmatched.length} stored value(s) no longer match the dataset mapping and are not listed above.`);

  return {
    title: REPORT_TITLE,
    generatedAt: when(generatedAtIso),
    requestKey: state.key,
    status: state.overall,
    summary,
    divisions,
    values,
    timeline: events,
    clarifications: state.clarifications.map((c) => ({
      id: c.key,
      attribute: cleanText(c.attributeName),
      division: c.divisionName,
      submittedValue: cleanText(c.submittedValue) || BLANK_VALUE,
      question: cleanText(c.question),
      askedBy: who(c.askedBy),
      askedOn: when(c.askedOn),
      response: cleanText(c.response) || 'No response recorded',
      respondedBy: c.respondedBy ? who(c.respondedBy) : '-',
      respondedOn: c.respondedOn ? when(c.respondedOn) : '-',
      status: c.status,
      resolvedBy: c.resolvedBy ? who(c.resolvedBy) : '-',
      resolvedOn: c.resolvedOn ? when(c.resolvedOn) : '-',
    })),
    decision: [
      ['Decision', review.status],
      ['Reviewed by', whoWithRole(review.by)],
      ['Decision on', when(review.on)],
      [review.status === 'Rejected' ? 'Rejection reason' : 'Approval comment', cleanText(review.comments) || 'None recorded'],
      ['Final status', state.overall],
    ],
    notes,
  };
}
