import logoDark from '../assets/dewa-logo-dark.svg';
import { Icon } from '../components/Icon.tsx';
import { landingFor } from '../components/nav.ts';
import { Alert, Spinner } from '../components/ui.tsx';
import type { AccessResult } from '../data/services.ts';

export type EntryState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'resolved'; access: AccessResult };

function AccessMessage({ access }: { access: Exclude<AccessResult, { kind: 'ok' }> }) {
  switch (access.kind) {
    case 'no-identity':
      return (
        <Alert tone="error" title="We couldn't verify who you are">
          The app received no verified sign-in, so it can't look up your user record. Open the app from Power Apps rather than a saved or shared link, sign in, and try again.
        </Alert>
      );
    case 'no-user':
      return (
        <Alert tone="error" title="You don't have access to this application">
          No user record in tbl_MOEI_UserDetails has the email address {access.user.upn}. Ask the application administrator to add one with your user ID, role and designation.
        </Alert>
      );
    case 'inactive-user':
      return (
        <Alert tone="error" title="Your user record is inactive">
          The user record for {access.user.upn} is deactivated, so it can't be used to sign in. Ask the application administrator to reactivate it if you still need access.
        </Alert>
      );
    case 'multiple-users':
      return (
        <Alert tone="error" title="Your account has more than one active user record">
          {access.count} active records match {access.user.upn}. Each user must have exactly one, so access is blocked until the application administrator removes or deactivates the duplicates.
        </Alert>
      );
    case 'invalid-user':
      return (
        <Alert tone="error" title="Your user record is incomplete">
          {access.reason} Ask the application administrator to correct your user record.
        </Alert>
      );
    case 'schema-missing':
      return (
        <Alert tone="error" title="The application is not fully set up yet">
          {access.table} is missing columns this app needs: {access.columns.join(', ')}. Ask the application administrator to finish the setup described in the README.
        </Alert>
      );
    case 'schema-unavailable':
      return (
        <Alert tone="error" title="We couldn't confirm the application setup">
          {access.table} couldn't be checked right now. This is usually a temporary connection or permission problem, not missing setup. Select Check again in a moment. If it keeps happening, ask the application administrator to check your access to {access.table}.
        </Alert>
      );
  }
}

/**
 * Sign-in screen. Identity is the address the Power Apps host verified; the app
 * never asks for one. That address is looked up in tbl_MOEI_UserDetails, and only
 * exactly one active record with a known role lets the user continue.
 */
export function EntryScreen({ state, onContinue, onRetry }: { state: EntryState; onContinue: () => void; onRetry: () => void }) {
  const access = state.kind === 'resolved' ? state.access : null;
  const ok = access?.kind === 'ok' ? access.session : null;
  const user = access && 'user' in access ? access.user : ok?.user;
  const landing = ok ? landingFor(ok) : null;
  const details: [string, string | undefined][] = ok
    ? [['Name', ok.user.fullName], ['User ID', ok.user.userId], ['Email', ok.user.upn], ['Role', ok.role], ['Designation', ok.designation]]
    : [['Email', user?.upn]];

  return (
    <div className="entry">
      <section className="entry-hero" aria-hidden="false">
        <img src={logoDark} alt="" className="entry-hero-logo" />
        <div className="entry-hero-copy">
          <h1>Yearly Datasets Integration</h1>
        </div>
        <p className="entry-hero-foot">© Dubai Electricity &amp; Water Authority. All rights reserved.</p>
      </section>

      <section className="entry-panel">
        <div className="entry-card">
          <h2>Data Division Portal</h2>
          <p className="muted center">Verified sign-in, checked against the MOEI user register</p>

          {state.kind === 'loading' && <Spinner label="Looking up your user record…" />}

          {state.kind === 'error' && (
            <>
              <Alert tone="error" title="We couldn't connect to the data service">{state.message}</Alert>
              <button className="btn btn-primary btn-block" onClick={onRetry}><Icon name="refresh" />Try again</button>
            </>
          )}

          {user && (
            <dl className="identity">
              {details.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          )}

          {access && access.kind !== 'ok' && (
            <>
              <AccessMessage access={access} />
              <button className="btn btn-outline btn-block" onClick={onRetry}><Icon name="refresh" />Check again</button>
            </>
          )}

          {ok && landing && (
            <button className="btn btn-primary btn-block" onClick={onContinue} autoFocus>
              Continue to {landing.label} <Icon name="arrow" />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
