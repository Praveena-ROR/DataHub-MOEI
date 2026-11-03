import { Fragment, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import { StatusBadge, Th } from './ui.tsx';
import { rowDivisionId, VALUE_MAX_LENGTH } from '../data/workflow.ts';
import type { Attribute, Division, RequestState, ValueRow } from '../data/types.ts';

/**
 * One row per attribute × mapped division. A shared attribute therefore gets a
 * separate value cell per division — never one shared input.
 */
export function AttributeTable({ state, viewerDivisionId, editable, values, onChange, missing, rowAction }: {
  state: RequestState;
  /** The signed-in user's division, if any. */
  viewerDivisionId?: string;
  /** The viewer's own cells are editable. */
  editable: boolean;
  values: Record<string, string>;
  onChange?: (mapId: string, value: string) => void;
  /** Mapping IDs of the viewer's required values that are still blank (shown after a Submit attempt). */
  missing?: ReadonlySet<string>;
  /** Optional per attribute × division action (DG Admin: Request clarification). */
  rowAction?: (attribute: Attribute, division: Division, row: ValueRow | undefined) => ReactNode;
}) {
  const columns = rowAction ? 4 : 3;
  /** Latest clarification for an attribute value (the list is already limited to what the viewer may see). */
  const clarificationOf = (mapId: string, divisionId: string) =>
    state.clarifications.filter((c) => c.mapId === mapId && c.divisionId === divisionId).at(-1);
  const portionOf = (divisionId: string) => state.portions.find((p) => p.division.id === divisionId);
  const rowOf = (mapId: string, divisionId: string) =>
    state.rows.find((r) => r.myapp_attributemapid === mapId && rowDivisionId(r) === divisionId);

  return (
    <div className="table-wrap">
      <table className="table attr-table">
        <thead>
          <tr>
            <Th icon="layers">Attribute</Th>
            <Th icon="hash">Unit</Th>
            <Th icon="users">Division</Th>
            <Th icon="edit">Value{editable && <span className="req" aria-hidden="true"> *</span>}</Th>
            <Th icon="status">Division status</Th>
            {rowAction && <Th icon="actions" className="right">Review</Th>}
          </tr>
        </thead>
        <tbody>
          {state.dataset.attributes.map((a) => {
            const span = a.divisions.length + a.unresolved.length || 1;
            const attrCell = (
              <td rowSpan={span} className="attr-cell span-cell">
                <div>{a.name}</div>
                {a.description && a.description !== a.name && <div className="sub">{a.description}</div>}
                {a.divisions.length > 1 && <span className="chip">Shared by {a.divisions.length} divisions</span>}
              </td>
            );
            const unitCell = <td rowSpan={span} className="span-cell">{a.unit ?? '—'}</td>;
            if (a.divisions.length === 0 && a.unresolved.length === 0) {
              return (
                <tr key={a.mapId}>
                  {attrCell}{unitCell}
                  <td colSpan={columns} className="warn-text"><Icon name="alert" size={14} /> No business division is mapped to this attribute</td>
                </tr>
              );
            }
            return (
              <Fragment key={a.mapId}>
                {a.divisions.map((d, i) => {
                  const own = d.id === viewerDivisionId;
                  const portion = portionOf(d.id);
                  const row = rowOf(a.mapId, d.id);
                  const submitted = row?.myapp_submissionstatus === 'Submitted';
                  const canType = own && editable && !submitted;
                  const inputId = `v-${a.mapId}-${d.id}`;
                  let content;
                  if (canType) {
                    const invalid = !!missing?.has(a.mapId);
                    content = (
                      <>
                        <input
                          id={inputId}
                          className={`input input-cell${invalid ? ' input-invalid' : ''}`}
                          value={values[a.mapId] ?? ''}
                          maxLength={VALUE_MAX_LENGTH}
                          onChange={(e) => onChange?.(a.mapId, e.target.value)}
                          aria-label={`${a.name} value for ${d.name} (required)`}
                          aria-required="true"
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? `${inputId}-err` : undefined}
                          placeholder="Enter value"
                        />
                        {invalid && <div id={`${inputId}-err`} className="field-error">Enter a value</div>}
                      </>
                    );
                  } else if (own || row) {
                    // Every participating division's saved value is visible (drafts included), read-only.
                    const v = own ? (values[a.mapId] ?? row?.myapp_attributevalue) : row?.myapp_attributevalue;
                    content = (
                      <span className="readonly-value">
                        <Icon name="lock" size={13} label="Read-only" />
                        {v ? v : <span className="muted">Blank</span>}
                        {row && <span className={`chip${submitted ? ' chip-green' : ' chip-amber'}`}>{submitted ? 'Submitted' : 'Draft'}</span>}
                      </span>
                    );
                  } else {
                    content = <span className="muted">Not entered yet</span>;
                  }
                  return (
                    <tr key={d.id} className={own ? 'own-row' : undefined}>
                      {i === 0 && attrCell}
                      {i === 0 && unitCell}
                      <td>
                        {d.name}
                        {own && <span className="chip chip-green">Your division</span>}
                      </td>
                      <td>
                        {content}
                        {(() => {
                          const c = clarificationOf(a.mapId, d.id);
                          return c && (
                            <div className="cell-note">
                              <Icon name="info" size={13} />Clarification <StatusBadge status={c.status} />
                            </div>
                          );
                        })()}
                      </td>
                      <td>{portion && <StatusBadge status={portion.status} />}</td>
                      {rowAction && <td className="right">{rowAction(a, d, row)}</td>}
                    </tr>
                  );
                })}
                {a.unresolved.map((t, i) => (
                  <tr key={`u-${t}`}>
                    {a.divisions.length === 0 && i === 0 && attrCell}
                    {a.divisions.length === 0 && i === 0 && unitCell}
                    <td colSpan={columns} className="warn-text"><Icon name="alert" size={14} /> "{t}" does not match a division with an active user</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
