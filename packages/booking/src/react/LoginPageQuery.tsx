import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { BookingConfig } from '../core/config';
import { labelText } from '../core/labels';
import { createReturnPath } from '../core/portal/return-path';
import { stripVippsReturn, vippsConfirmFrom } from '../core/portal/vipps-return';
import { LoginSheet, type LoginSheetProps, type VippsConfirm } from './LoginSheet';
import type { LoginLabels } from './labels';
import { type BookingOverrides, useBookingKit } from './Provider';

/**
 * The two things the login page reads off its query string, read in the
 * browser so the page itself can be prerendered: one static document, and
 * these two components pick up the query after it lands.
 */

/** The label for each outcome the Vipps return route can report. */
const VIPPS_NOTICE: Record<string, keyof LoginLabels> = {
  needs_email_login: 'loginPage.vipps.needsEmailLogin',
  failed: 'loginPage.vipps.failed',
};

/**
 * The sentence for `?vipps=<value>`, or `null` for anything that is not an
 * outcome. The query is writable by anyone with a URL bar, so the value itself
 * is never rendered: it is a key into the table or it is nothing. A repeated
 * parameter is nothing too.
 */
export function vippsNotice(values: readonly string[], labels: LoginLabels): string | null {
  if (values.length !== 1) return null;
  const [value] = values;
  return Object.hasOwn(VIPPS_NOTICE, value) ? labelText(labels[VIPPS_NOTICE[value]]) : null;
}

/**
 * `?vipps=` — why a Vipps login did not end in a cookie. `useSearchParams` on
 * a prerendered page must sit under a `<Suspense>` (the page provides it, with
 * a `null` fallback: a box reserved for the rare notice would be a layout
 * shift for everybody else).
 */
export function VippsNotice(props: BookingOverrides) {
  const { kit } = useBookingKit(props);
  const notice = vippsNotice(useSearchParams()?.getAll('vipps') ?? [], kit.labels);
  if (!notice) return null;
  return (
    <p role="status" className="rounded-[3px] bg-muted px-4 py-3 text-sm">
      {notice}
    </p>
  );
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

/** `?return=`, validated. A repeated parameter is refused, as on the server. */
export function returnPathFromSearch(
  search: string,
  config: Pick<BookingConfig, 'portal'>
): string | null {
  const values = new URLSearchParams(search).getAll('return');
  return createReturnPath(config)(values.length === 1 ? values[0] : undefined);
}

/**
 * `?vipps=confirm_email[&to=…]` as a primitive, so the snapshot is stable:
 * `null` for an ordinary visit, `''` for a confirm without a usable address,
 * else the masked address.
 */
function readVippsConfirm(): string | null {
  const confirm = vippsConfirmFrom(new URLSearchParams(window.location.search));
  return confirm === undefined ? null : (confirm.to ?? '');
}

function nothing(): null {
  return null;
}

export type LoginFromQueryProps = BookingOverrides & Pick<LoginSheetProps, 'actions'>;

/**
 * The inline login, told where to go once it succeeds.
 *
 * NOT `useSearchParams`: that would need a Suspense boundary, and the login
 * form is the page — as a fallback it would be swapped for a fresh copy on
 * hydration, dropping anything typed before the JavaScript arrived.
 * `useSyncExternalStore` hydrates with the server snapshot (`null`) and
 * re-renders the SAME tree with the real value. The return path is never
 * rendered, only handed to the login's `router.replace` and the Vipps start.
 */
export function LoginFromQuery({ actions, ...overrides }: LoginFromQueryProps) {
  const { config } = useBookingKit(overrides).kit;
  const readReturnPath = useCallback(
    () => returnPathFromSearch(window.location.search, config),
    [config]
  );
  const returnPath = useSyncExternalStore(subscribe, readReturnPath, nothing);
  const live = useSyncExternalStore(subscribe, readVippsConfirm, nothing);
  /**
   * LATCHED on the first read that has one: the address bar is cleaned
   * straight after, and a later render reading it again must not take the
   * visitor off the code screen they are typing into.
   */
  const [confirm, setConfirm] = useState<VippsConfirm | null>(null);
  if (live !== null && confirm === null) setConfirm({ to: live === '' ? null : live });
  useEffect(() => {
    if (confirm !== null) stripVippsReturn();
  }, [confirm]);
  return (
    <LoginSheet
      {...overrides}
      actions={actions}
      // A fresh login for the code step: its memory starts on the code.
      key={confirm === null ? 'email' : 'vipps'}
      presentation="inline"
      returnPath={returnPath}
      vippsConfirm={confirm}
    />
  );
}

/** The login page's component under the module's own name. */
export { LoginFromQuery as LoginPageQuery };
