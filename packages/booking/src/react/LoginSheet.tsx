import {
  LoginPanel,
  type LoginPanelProps,
  type LoginStartResult,
  type LoginVerifyResult,
  LoginSheet as SheetScreen,
  type VippsConfirm,
} from '@medalsocial/meda/booking';
import { useRouter } from 'next/navigation';
import { labelText } from '../core/labels';
import type { BookingGuardian } from '../core/types';
import { type PortalActions, readStartLogin } from './actions';
import { type BookingOverrides, useBookingKit } from './Provider';
import { screenLabels } from './screen-labels';

export type { VippsConfirm };

/**
 * The site's one login — Vipps, or a six-digit code by e-mail — in the three
 * places a visitor takes it, over meda's `LoginSheet` / `LoginPanel`.
 *
 * - `presentation="sheet"` is the booking wizard's: an offer the wizard never
 *   waits on, that never navigates. A good code hands the visitor back
 *   through `onSignedIn` with the `guardian` the verify route answers with.
 * - `presentation="inline"` is the login page's. A good code ends in ONE
 *   `router.replace` to `returnPath` or the portal — the destination is a
 *   server page that reads the fresh cookie on the way in, and Back should not
 *   land on a login whose job is done.
 * - `presentation="gate"` is the wizard's «Bekreft» under `account.required`:
 *   the panel in place of the form, never navigating. Vipps lands on the
 *   wizard's resume URL; a good code hands the parent back through
 *   `onSignedIn`, like the sheet.
 *
 * Where Vipps is offered, the page and the gate draw e-mail as a second button
 * under it («Fortsett med Vipps» / «Fortsett med e-post») that opens the form.
 * The sheet keeps its form open under Vipps: meda's `LoginSheet` does not take
 * `emailCollapsed` (and under `account.required` the wizard draws no sheet but
 * a Vipps confirm, which opens on the code).
 *
 * THE CODE IS CHECKED BY `fetch`, NOT BY A SERVER ACTION
 * (`POST <portalApi>/login/verify`): in Next 16 an action that sets a cookie
 * makes the client re-fetch the route it was called from — the whole booking
 * page behind the sheet, or a second render racing the `replace`. Asking for
 * the code stays the app's action (`actions.startLogin`): it sets no cookie.
 *
 * Vipps is offered when the site has it (`config.portal.methods`) and the app
 * passed its start action.
 */
export type LoginSheetProps = BookingOverrides & {
  /** The app's server actions (Decision 8). */
  actions: Pick<PortalActions, 'startLogin' | 'startVipps'>;
} & (
    | {
        presentation: 'sheet';
        /** Where a Vipps login should land: the wizard's resume URL. */
        resumePath: string;
        /** A good code; `guardian` is `null` when the read after it failed. */
        onSignedIn: (guardian: BookingGuardian | null) => void;
        /** A Vipps return asking for the e-mailed code: the sheet opens on it. */
        vippsConfirm?: VippsConfirm | null;
        /** Draw the «have an account? Log in» row. Default `true`. */
        trigger?: boolean;
      }
    | {
        presentation: 'gate';
        /** Where a Vipps login should land: the wizard's resume URL. */
        resumePath: string;
        /** A good code; `guardian` is `null` when the read after it failed. */
        onSignedIn: (guardian: BookingGuardian | null) => void;
        /** A Vipps return asking for the e-mailed code: the gate opens on it. */
        vippsConfirm?: VippsConfirm | null;
      }
    | {
        presentation: 'inline';
        /** Already through `createReturnPath(config)`; `null` is the portal. */
        returnPath?: string | null;
        vippsConfirm?: VippsConfirm | null;
      }
  );

/**
 * Ask a verify route, and say what its answer means for the form. The
 * route's own reasons are the form's; anything else (a 403, a body that is
 * not the route's, the network failing) is `unreachable`.
 */
async function askVerify(
  path: string,
  payload: Record<string, string>
): Promise<LoginVerifyResult> {
  let body: unknown;
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  const answer = body as {
    ok?: unknown;
    guardian?: BookingGuardian | null;
    reason?: unknown;
  } | null;
  if (answer?.ok === true) return { ok: true, guardian: answer.guardian ?? null };
  const reason = answer?.reason;
  return reason === 'invalid' || reason === 'throttled' || reason === 'conflict'
    ? { ok: false, reason }
    : { ok: false, reason: 'unreachable' };
}

export function LoginSheet(props: LoginSheetProps) {
  const { kit, classNames } = useBookingKit(props);
  const { config, labels } = kit;
  const { actions } = props;
  const api = config.paths.portalApi;
  const screen = {
    labels: screenLabels(labels),
    // «Sent» for every address; only a failed action is not (so the form is
    // never an oracle for who books here, and never claims a code it did not send).
    onStartLogin: async (email: string): Promise<LoginStartResult> => {
      try {
        return readStartLogin(await actions.startLogin({ email }));
      } catch {
        return { ok: false, reason: 'unreachable' };
      }
    },
    // The Vipps confirm code is checked by the code alone: the pending link is
    // in an httpOnly cookie the route reads.
    onVerify: (code: string, context: { mode: 'email' | 'vipps'; email: string }) =>
      context.mode === 'vipps'
        ? askVerify(`${api}/vipps/link/verify`, { code })
        : askVerify(`${api}/login/verify`, { email: context.email, code }),
    onVipps: config.portal.methods.includes('vipps') ? actions.startVipps : undefined,
    vippsConfirm: props.vippsConfirm ?? null,
    otpClassNames: classNames.otp,
    vippsClassNames: classNames.vipps,
  };
  const vippsLabel = labelText(labels['login.continueVipps']);
  if (props.presentation === 'gate') {
    return (
      <LoginPanel
        {...screen}
        emailCollapsed
        vippsLabel={vippsLabel}
        vippsNext={props.resumePath}
        classNames={classNames.loginPanel}
        onSignedIn={props.onSignedIn}
      />
    );
  }
  if (props.presentation === 'inline') {
    return (
      <InlineLogin
        screen={{ ...screen, emailCollapsed: true, vippsLabel }}
        classNames={classNames.loginPanel}
        target={props.returnPath ?? null}
        fallback={config.paths.portal ?? '/'}
      />
    );
  }
  return (
    <SheetScreen
      {...screen}
      resumePath={props.resumePath}
      onSignedIn={props.onSignedIn}
      trigger={props.trigger}
      classNames={classNames.loginSheet}
      panelClassNames={classNames.loginPanel}
    />
  );
}

/** Its own component so only the page login reads the router. */
function InlineLogin({
  screen,
  classNames,
  target,
  fallback,
}: {
  screen: Omit<LoginPanelProps, 'onSignedIn'>;
  classNames: LoginPanelProps['classNames'];
  target: string | null;
  fallback: string;
}) {
  const router = useRouter();
  return (
    <LoginPanel
      {...screen}
      classNames={classNames}
      vippsNext={target}
      onSignedIn={() => router.replace(target ?? fallback)}
    />
  );
}
