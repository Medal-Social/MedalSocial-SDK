/**
 * The «confirm with a code» return from Vipps (SP10), as the pages that
 * receive it read it — free of `server-only`, because both readers are in the
 * browser (the Min side login and the booking wizard).
 *
 * `/min-side/vipps` sends the parent on with `?vipps=confirm_email` and, when
 * Medal named one, `&to=<masked address>` — the address the code went to, as
 * `k•••@g•••.com`. The link itself is NOT in this URL: the route moved it into
 * an httpOnly cookie (`vipps-link.ts`).
 *
 * `to` is written by a third party's redirect and is anyone's to edit in an
 * address bar, so it is RENDERED AS TEXT ONLY and only when it has exactly
 * the masked shape Medal produces; anything else is the generic sentence.
 */

export const VIPPS_CONFIRM_QUERY = 'confirm_email';

/** One visible character, the mask, `@`, one character, the mask, a TLD. */
const MASKED_ADDRESS = /^[^\s<>@]•••@[^\s<>@.]•••\.[A-Za-z]{2,24}$/;

/** The masked address, or `null` for anything that is not one. */
export function maskedAddress(value: string | null | undefined): string | null {
  return typeof value === 'string' && MASKED_ADDRESS.test(value) ? value : null;
}

/**
 * Whether the query says «confirm with a code», and to which address.
 * `undefined` for an ordinary visit; `{ to: null }` when the address is
 * absent (Medal found the contact by phone) or not the masked shape.
 */
export function vippsConfirmFrom(query: URLSearchParams | null): { to: string | null } | undefined {
  const values = query?.getAll('vipps') ?? [];
  if (values.length !== 1 || values[0] !== VIPPS_CONFIRM_QUERY) return undefined;
  /* v8 ignore next -- `query` is non-null once a `vipps` value was read off it */
  const to = query?.getAll('to') ?? [];
  return { to: to.length === 1 ? maskedAddress(to[0]) : null };
}

/** The keys a Vipps return can leave in an address bar. */
const VIPPS_KEYS = ['link', 'to', 'grant'] as const;

/**
 * Take the Vipps return's keys out of the address bar, in place — so the
 * masked address, and anything else a callback left there, is not in the
 * history entry, a bookmark, a shared link or a later pageview. The
 * `?vipps=confirm_email` marker goes too: the page has read it, and a reload
 * must not reopen a code step for a link that may be spent.
 *
 * Other keys stay (`resume`, a deep link's `kategori`…). No-op when there is
 * nothing to take.
 */
export function stripVippsReturn(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of VIPPS_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (url.searchParams.get('vipps') === VIPPS_CONFIRM_QUERY) {
    url.searchParams.delete('vipps');
    changed = true;
  }
  if (!changed) return;
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
