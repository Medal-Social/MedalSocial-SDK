/**
 * Where a manage link points, spelled once.
 *
 * The path segment after this prefix is a live bearer credential: whoever holds
 * it can move or cancel that one appointment. Several things have to agree about
 * the shape of that URL — the wizard builds it, the manage page is served at it,
 * and `Analytics` has to recognise it in order to keep the tracker off — and
 * they are in three different layers of the app, which is exactly the sort of
 * spread where one of them drifts.
 *
 * Free of React, `server-only` and fetch on purpose: the root layout's
 * `Analytics` imports it, so it has to be safe in every bundle.
 */

import type { BookingConfig } from './config';

type PathsConfig = Pick<BookingConfig, 'paths'>;

/** The page that manages one booking. Encoded, because the token is opaque and
 * this is the only place that turns one into a URL. */
function managePath(config: PathsConfig, token: string): string {
  return `${config.paths.manage}/${encodeURIComponent(token)}`;
}

/** A path as a regex source, so a `.` in a configured path means a dot. */
function escapeRegExp(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `path` and everything below it, behind an optional `/xx` or `/xx-YY` locale segment. */
function under(path: string): RegExp {
  return new RegExp(`^(?:/[A-Za-z]{2}(?:-[A-Za-z]{2})?)?${escapeRegExp(path)}(?:/|$)`);
}

/**
 * Whether a pathname is a manage page — with or without a locale segment in
 * front of it.
 *
 * `localePrefix: 'as-needed'` means the site's one locale is unprefixed today,
 * so `/bestill/administrer/…` is what actually gets served. The optional
 * `/xx` or `/xx-YY` in front is for the day a second locale is added: the
 * tracker staying on for the Danish copy of this page would be the same leak
 * with a different first segment.
 *
 * `null` is what `usePathname` returns with no router above it, which cannot
 * happen for a client component under the App Router. It is answered `false`
 * rather than `true` so that a caller reading this as «is this the manage page»
 * is not told yes about a page it knows nothing about.
 */
function isManagePath(config: PathsConfig, pathname: string | null | undefined): boolean {
  if (typeof pathname !== 'string') return false;
  return under(config.paths.manage).test(pathname);
}

/**
 * The portal (`paths.portal`, `/min-side` by default) and everything under it. The portal pages carry no credential in
 * the URL, but the dashboard renders each upcoming appointment's manage link —
 * a per-booking bearer token — into the DOM, and a third-party script mounted
 * on that page can read the DOM. So the analytics tracker treats the portal
 * exactly like the manage page: not loaded at all, rather than loaded and
 * asked not to look. Locale-prefixed forms are covered like `isManagePath`.
 */
function isPortalPath(config: PathsConfig, pathname: string | null | undefined): boolean {
  if (typeof pathname !== 'string' || config.paths.portal === null) return false;
  return under(config.paths.portal).test(pathname);
}

export interface Paths {
  managePath(token: string): string;
  isManagePath(pathname: string | null | undefined): boolean;
  isPortalPath(pathname: string | null | undefined): boolean;
}

export function createPaths(config: PathsConfig): Paths {
  return {
    managePath: (token) => managePath(config, token),
    isManagePath: (pathname) => isManagePath(config, pathname),
    isPortalPath: (pathname) => isPortalPath(config, pathname),
  };
}
