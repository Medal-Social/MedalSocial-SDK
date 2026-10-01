/**
 * Where a login is allowed to send a parent afterwards.
 *
 * Two places on this site now start a Min side login on behalf of a page that
 * is NOT Min side — a sign-up flow's «fetch from Vipps» and its «log in
 * with e-mail» — and both have to name where the parent should land when the
 * login is done. That destination arrives from somewhere a visitor can write:
 * a query string on `/min-side/logg-inn`, or a form field posted to the Vipps
 * start action. Anything that arrives that way and is later handed to a
 * `redirect()` is an open redirect unless something narrows it first, and this
 * module is that something.
 *
 * The rule is deliberately not «is this the same origin»: a value is refused
 * unless it is a ROOT-RELATIVE PATH, so there is no origin to compare and no
 * parser disagreement to exploit. The three shapes that historically get
 * through a hand-rolled `startsWith('/')` check are all refused explicitly:
 *
 * - `//evil.example` — a protocol-relative URL. It starts with `/`, and a
 *   browser sends it to `evil.example`.
 * - `/\evil.example` and `\\evil.example` — the same trick with backslashes,
 *   which Chrome and Safari normalise to `//`.
 * - `https://evil.example/barnehage/x` — an absolute URL that happens to
 *   contain an allowed path.
 *
 * On top of that the path must be one this site is willing to send a
 * freshly-logged-in parent to. That list is short on purpose: the login exists
 * to hand a parent back to a flow they were already standing in, not to be a
 * general-purpose navigation primitive. `/min-side` needs no entry — it is the
 * default when there is no return path at all.
 *
 * Pure, and not `server-only`: the login page validates a query parameter with
 * it on the server, and the tests exercise it directly.
 */

import type { BookingConfig } from '../config';

/*
 * The paths a login may return a parent to come from
 * `config.portal.returnPaths`: `prefixes` match on the pathname (a flow whose
 * pages all live below one path), `exact` match the pathname alone and no
 * descendants.
 *
 * The booking page is the default `exact` entry: its login sheet offers Vipps
 * mid-flow and needs the parent back on the page they left (`?resume=1`
 * rebuilds the half-built booking out of the draft store). It is an exact
 * match rather than a prefix because the manage page lives underneath it:
 * that page is reached with a one-time credential in the path, and it has no
 * business being a destination a login can be pointed at.
 *
 * The query string is not part of the comparison — `safeReturnPath` rebuilds
 * the answer from `pathname` and `search`, so `?resume=1` survives while the
 * decision is made on the path alone. The portal itself needs no entry — it is
 * the default when there is no return path at all.
 */

/**
 * Longer than any address this site builds (a kindergarten slug plus one
 * query flag) and short enough that a crafted value cannot be used to push a
 * kilobyte through a `Set-Cookie`.
 */
const MAX_LENGTH = 512;

/**
 * A base that cannot be reached and cannot be confused with a real origin.
 * `URL` needs one to resolve a relative reference; anything that resolves to a
 * DIFFERENT origin than this was not relative, whatever it looked like.
 */
const RELATIVE_BASE = 'https://return-path.invalid';

/**
 * The path `value` names, or `null`.
 *
 * The answer is rebuilt from the parsed URL rather than handed back as it
 * arrived — pathname and query only — so a caller receives a normalised value
 * with no fragment and no room for a second reading of the same bytes.
 */
function safeReturnPath(
  allowed: { exact: readonly string[]; prefixes: readonly string[] },
  value: unknown
): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_LENGTH) return null;

  // Before any parsing: a path this site issues contains no backslash, no
  // whitespace and no control character, and every known normalisation trick
  // needs one of the three. Character by character rather than by regex — a
  // regex that spells out the control range is itself a lint error, and this
  // says the same thing without one.
  if (value.includes('\\')) return null;
  for (const char of value) {
    /* v8 ignore next -- a character of a string always has a code point */
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return null;
  }

  // One leading slash, never two — `//host` is protocol-relative.
  if (!value.startsWith('/') || value.startsWith('//')) return null;

  // Defensive from here: the checks above leave only single-slash paths with no
  // backslash or whitespace, which neither throw nor leave the base origin. The
  // two guards stay as the second line of defence they were written as.
  let url: URL;
  try {
    url = new URL(value, RELATIVE_BASE);
    /* v8 ignore start */
  } catch {
    return null;
  }
  // An absolute URL resolves to its own origin and is refused here even when
  // its path would have been allowed.
  if (url.origin !== RELATIVE_BASE) return null;
  /* v8 ignore stop */

  const ok =
    allowed.prefixes.some((prefix) => url.pathname.startsWith(prefix)) ||
    allowed.exact.some((path) => url.pathname === path);
  if (!ok) return null;

  return `${url.pathname}${url.search}`;
}

export type ReturnPathGuard = (value: unknown) => string | null;

/** `safeReturnPath` for this site's `portal.returnPaths`. */
export function createReturnPath(config: Pick<BookingConfig, 'portal'>): ReturnPathGuard {
  const allowed = config.portal.returnPaths;
  return (value) => safeReturnPath(allowed, value);
}
