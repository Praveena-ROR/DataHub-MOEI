import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { pageSlice } from '../components/format.ts';
import { Alert, ConfirmDialog, FilterText, MultiSelectFilter, Pagination, SectionTitle, Th } from '../components/ui.tsx';
import { AdminValidationError, designationChoices, divisionChoices, draftFromUser, isKnownRole, LIMITS, nextUserId, roleChoices, validateUser, type DraftErrors, type UserDraft } from '../data/admin.ts';
import { saveUser, type AdminCentreData } from '../data/services.ts';
import { normalize, roleOf, splitDivisionText } from '../data/workflow.ts';
import type { UserRow } from '../data/types.ts';

const ROLE_HELP: Record<string, string> = {
  BusinessDivision: 'Enters values for its business division and creates requests.',
  'DG Admin': 'Reviews requests, asks for clarification, approves or rejects, downloads reports, and uses the Admin Centre.',
  Admin: 'Manages datasets, attributes, mappings and users in the Admin Centre.',
};
const NEW = '__new__';

/**
 * User Management: the records of tbl_MOEI_UserDetails that map verified
 * sign-in addresses to a role and (for BusinessDivision) a division. No
 * passwords: identity is verified by the Power Apps host, never by this table.
 */
export function AdminUsers({ data, selfUpn, onSaved }: { data: AdminCentreData; selfUpn: string; onSaved: (message: string) => void }) {
  const [search, setSearch] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [designations, setDesignations] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>(['active']);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<UserDraft | null>(null);
  const [viewing, setViewing] = useState<UserRow | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const divisions = useMemo(() => divisionChoices(data.users), [data]);
  const mapped = useMemo(() => new Set(data.mapRows.filter((r) => r.statecode === 0).flatMap((r) => splitDivisionText(r.myapp_businessdivision).map(normalize))), [data]);
  const self = data.users.find((u) => u.statecode === 0 && (u.myapp_usermailid ?? '').split(/[;,\s]+/).some((m) => normalize(m) === normalize(selfUpn)));
  const ctx = { users: data.users, divisions, mappedDivisions: mapped, selfId: self?.myapp_tbl_moei_userdetailsid };

  const options = useMemo(() => ({
    roles: [...new Set(data.users.map((u) => u.myapp_userrole ?? '').filter(Boolean))].sort().map((r) => [r, r] as [string, string]),
    designations: [...new Set(data.users.map((u) => u.myapp_userdesignation ?? '').filter(Boolean))].sort().map((d) => [d, d] as [string, string]),
  }), [data.users]);
  const shown = useMemo(() => {
    const q = normalize(search);
    return data.users
      .filter((u) => !q || normalize(`${u.myapp_username} ${u.myapp_userid} ${u.myapp_usermailid}`).includes(q))
      .filter((u) => roles.length === 0 || roles.includes(u.myapp_userrole ?? ''))
      .filter((u) => designations.length === 0 || designations.includes(u.myapp_userdesignation ?? ''))
      .filter((u) => statuses.length === 0 || statuses.includes(u.statecode === 0 ? 'active' : 'inactive'))
      .sort((a, b) => (a.myapp_username ?? '').localeCompare(b.myapp_username ?? ''));
  }, [data.users, search, roles, designations, statuses]);
  const current = Math.min(page, Math.max(1, Math.ceil(shown.length / pageSize)));
  const filtered = !!search || roles.length + designations.length > 0 || !(statuses.length === 1 && statuses[0] === 'active');

  /** "Add new role" / "Add new designation" chosen: the field becomes a text box. */
  const [newRole, setNewRole] = useState(false);
  const [newDesignation, setNewDesignation] = useState(false);
  const roleList = useMemo(() => roleChoices(data.users), [data.users]);
  const designationList = useMemo(() => designationChoices(data.users), [data.users]);
  const open = (d: UserDraft) => { setEditing(d); setErrors({}); setFailure(null); setNewRole(false); setNewDesignation(false); };
  const openNew = () => open({ name: '', userId: nextUserId(data.users, 'BusinessDivision'), mail: '', role: 'BusinessDivision', designation: '', active: true });
  const change = (changes: Partial<UserDraft>) => setEditing((d) => (d ? { ...d, ...changes } : d));
  /** Changing the role: a new user gets the matching User ID; moving into or out of BusinessDivision clears the designation. */
  const setRole = (role: string) => setEditing((d) => {
    if (!d) return d;
    const kindChanged = (roleOf(role) === 'division') !== (roleOf(d.role) === 'division');
    if (kindChanged) setNewDesignation(false);
    return { ...d, role, ...(d.id ? {} : { userId: nextUserId(data.users, role) }), ...(kindChanged ? { designation: '', newDivision: false } : {}) };
  });
  const save = async () => {
    if (!editing) return;
    const e = validateUser(editing, ctx);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFailure(null);
    try {
      const saved = await saveUser(editing);
      onSaved(editing.id
        ? `${editing.name} was updated.`
        : `${editing.name} was added as ${saved.userId}${saved.newDivision ? `, and ${saved.newDivision} is now a business division` : ''}. They can sign in with ${editing.mail}.`);
      setEditing(null);
    } catch (err) {
      if (err instanceof AdminValidationError) setErrors(err.errors);
      setFailure(err instanceof Error ? err.message : 'The user could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const isDivision = editing ? roleOf(editing.role) === 'division' : false;
  const before = editing?.id ? data.users.find((u) => u.myapp_tbl_moei_userdetailsid === editing.id) : undefined;
  const divisionChanged = !!before && roleOf(before.myapp_userrole) === 'division' && !!editing && normalize(before.myapp_userdesignation) !== normalize(editing.designation);
  const err = (k: string) => errors[k] && <div className="field-error">{errors[k]}</div>;

  return (
    <section className="panel">
      <SectionTitle icon="users" right={<button className="btn btn-primary btn-sm" onClick={openNew}><Icon name="plus" />Add User</button>}>
        Users ({data.users.filter((u) => u.statecode === 0).length} active)
      </SectionTitle>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <Th icon="users">User name</Th>
              <Th icon="hash">User ID</Th>
              <Th icon="info">Sign-in email</Th>
              <Th icon="shield">Role</Th>
              <Th icon="layers">Designation</Th>
              <Th icon="status">Status</Th>
              <Th icon="actions" className="right">Actions</Th>
            </tr>
            <tr className="filter-row">
              <th colSpan={3}><FilterText label="Search users" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Name, User ID or email" /></th>
              <th><MultiSelectFilter label="Filter by role" options={options.roles} selected={roles} onChange={(v) => { setRoles(v); setPage(1); }} /></th>
              <th><MultiSelectFilter label="Filter by designation" options={options.designations} selected={designations} onChange={(v) => { setDesignations(v); setPage(1); }} /></th>
              <th><MultiSelectFilter label="Filter by status" options={[['active', 'Active'], ['inactive', 'Inactive']]} selected={statuses} onChange={(v) => { setStatuses(v); setPage(1); }} /></th>
              <th className="right">{filtered && <button className="btn btn-link" onClick={() => { setSearch(''); setRoles([]); setDesignations([]); setStatuses(['active']); }}><Icon name="x" />Clear</button>}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="center muted">No users match these filters.</td></tr>}
            {pageSlice(shown, pageSize, current).map((u) => (
              <tr key={u.myapp_tbl_moei_userdetailsid}>
                <td>{u.myapp_username}{u.myapp_tbl_moei_userdetailsid === self?.myapp_tbl_moei_userdetailsid && <span className="chip chip-green">You</span>}</td>
                <td className="mono">{u.myapp_userid || '—'}</td>
                <td className="wrap">{u.myapp_usermailid || '—'}</td>
                <td>{u.myapp_userrole || '—'}{roleOf(u.myapp_userrole) === 'unknown' && <span className="flag" title="Not a recognised role; this user cannot sign in"><Icon name="alert" size={14} label="Unrecognised role" /></span>}</td>
                <td>{u.myapp_userdesignation || '—'}</td>
                <td>{u.statecode === 0 ? <span className="badge badge-green">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
                <td className="right">
                  <button className="btn btn-link" onClick={() => setViewing(u)}><Icon name="eye" />View</button>
                  <button className="btn btn-link" onClick={() => open(draftFromUser(u))}><Icon name="edit" />Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 0 && <Pagination page={current} pageSize={pageSize} total={shown.length} noun="user(s)" onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}

      {viewing && (
        <ConfirmDialog title={viewing.myapp_username ?? 'User'} confirmLabel="Edit" cancelLabel="Close" onCancel={() => setViewing(null)}
          onConfirm={() => { const u = viewing; setViewing(null); open(draftFromUser(u)); }}>
          <dl className="kv">
            <dt>User ID</dt><dd>{viewing.myapp_userid || '—'}</dd>
            <dt>Sign-in email</dt><dd>{viewing.myapp_usermailid || '—'}</dd>
            <dt>Role</dt><dd>{viewing.myapp_userrole || '—'}</dd>
            <dt>Designation</dt><dd>{viewing.myapp_userdesignation || '—'}</dd>
            <dt>Status</dt><dd>{viewing.statecode === 0 ? 'Active' : 'Inactive'}</dd>
          </dl>
        </ConfirmDialog>
      )}

      {editing && (
        <ConfirmDialog wide title={editing.id ? `Edit ${before?.myapp_username ?? 'user'}` : 'Add User'} confirmLabel={busy ? 'Saving…' : editing.id ? 'Save changes' : 'Add user'}
          busy={busy} onCancel={() => setEditing(null)} onConfirm={() => void save()}>
          {failure && <Alert tone="error">{failure}</Alert>}
          <p className="muted small">Access is granted only to a verified sign-in whose email address matches this record. The record sets the person's role and, for business divisions, their division.</p>
          <div className="form-grid">
            <label className="field grow">
              <span className="field-label">User name <span className="req">*</span></span>
              <input className={`input${errors.name ? ' input-invalid' : ''}`} value={editing.name} maxLength={LIMITS.userName} onChange={(e) => change({ name: e.target.value })} />
              {err('name')}
            </label>
            <div className="field">
              <span className="field-label">User ID</span>
              <span className="auto-value">{editing.userId || '—'}</span>
              <span className="sub">{editing.id ? 'Cannot be changed' : 'Assigned automatically from the role'}</span>
              {err('userId')}
            </div>
            <label className="field full">
              <span className="field-label">Sign-in email <span className="req">*</span></span>
              <input className={`input${errors.mail ? ' input-invalid' : ''}`} type="email" value={editing.mail} maxLength={LIMITS.userMail} onChange={(e) => change({ mail: e.target.value })} placeholder="name@organisation.com" />
              {err('mail')}
            </label>
            <label className="field">
              <span className="field-label">Role <span className="req">*</span></span>
              {newRole ? (
                <span className="with-action">
                  <input className={`input${errors.role ? ' input-invalid' : ''}`} value={editing.role} maxLength={LIMITS.userRole} autoFocus placeholder="New role name"
                    onChange={(e) => change({ role: e.target.value, ...(editing.id ? {} : { userId: nextUserId(data.users, e.target.value) }) })} />
                  <button type="button" className="btn btn-link" onClick={() => { setNewRole(false); setRole(roleList[0]); }}>Choose existing</button>
                </span>
              ) : (
                <select className={`select${errors.role ? ' input-invalid' : ''}`} value={roleList.find((r) => roleOf(r) !== 'unknown' ? roleOf(r) === roleOf(editing.role) : r === editing.role) ?? editing.role}
                  onChange={(e) => (e.target.value === NEW ? (setNewRole(true), setRole('')) : setRole(e.target.value))}>
                  {!roleList.some((r) => r === editing.role) && editing.role && roleOf(editing.role) === 'unknown' && <option value={editing.role}>{editing.role}</option>}
                  {roleList.map((r) => <option key={r} value={r}>{r}</option>)}
                  <option value={NEW}>+ Add new role…</option>
                </select>
              )}
              <span className="sub">{ROLE_HELP[roleList.find((r) => roleOf(r) === roleOf(editing.role)) ?? ''] ?? (editing.role && !isKnownRole(editing.role) ? 'This role has no screens in the app yet: a user with it cannot sign in.' : '')}</span>
              {err('role')}
            </label>
            <label className="field grow">
              <span className="field-label">{isDivision ? 'Business division' : 'Designation'} <span className="req">*</span></span>
              {newDesignation ? (
                <span className="with-action">
                  <input className={`input${errors.designation ? ' input-invalid' : ''}`} value={editing.designation} maxLength={LIMITS.userDesignation} autoFocus
                    placeholder={isDivision ? 'New business division name' : 'New designation'} onChange={(e) => change({ designation: e.target.value })} />
                  <button type="button" className="btn btn-link" onClick={() => { setNewDesignation(false); change({ designation: '', newDivision: false }); }}>Choose existing</button>
                </span>
              ) : (
                <select className={`select${errors.designation ? ' input-invalid' : ''}`}
                  value={(isDivision ? divisions.map((d) => d.name) : designationList).find((n) => normalize(n) === normalize(editing.designation)) ?? editing.designation}
                  onChange={(e) => (e.target.value === NEW ? (setNewDesignation(true), change({ designation: '', newDivision: isDivision })) : change({ designation: e.target.value, newDivision: false }))}>
                  <option value="">{isDivision ? 'Choose a division…' : 'Choose a designation…'}</option>
                  {editing.designation && !(isDivision ? divisions.map((d) => d.name) : designationList).some((n) => normalize(n) === normalize(editing.designation)) && <option value={editing.designation}>{editing.designation}</option>}
                  {(isDivision ? divisions.map((d) => d.name) : designationList).map((n) => <option key={n} value={n}>{n}</option>)}
                  <option value={NEW}>{isDivision ? '+ Add new business division…' : '+ Add new designation…'}</option>
                </select>
              )}
              {newDesignation && isDivision && <span className="sub">Once this user is saved, the division can be mapped to attributes.</span>}
              {divisionChanged && <span className="sub">Their earlier contributions stay with {before?.myapp_userdesignation}; they will work on {editing.designation || 'the new division'}'s requests from now on.</span>}
              {err('designation')}
            </label>
            {editing.id && (
              <label className="field full checkbox-field">
                <span><input type="checkbox" className="checkbox" checked={editing.active} onChange={(e) => change({ active: e.target.checked })} /> Active (an inactive user cannot sign in)</span>
                {err('active')}
              </label>
            )}
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}
