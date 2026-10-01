/**
 * The portal's four sections, and how they are spelled in the URL.
 *
 * Free of `'use client'`, so the server page can call `parsePortalTab` on the
 * query and the FIRST paint is already the right section; the dashboard
 * writes it back as the visitor moves between them.
 */

export const PORTAL_TABS = ['overview', 'family', 'history', 'profile'] as const;

export type PortalTab = (typeof PORTAL_TABS)[number];

/** The section with no parameter — and the answer to any value that is not one. */
export const DEFAULT_PORTAL_TAB: PortalTab = 'overview';

/** The query parameter the open section rides in (`?fane=…`). */
export const DEFAULT_PORTAL_TAB_PARAM = 'fane';

/** Each section's value in that parameter. */
export const DEFAULT_PORTAL_TAB_SLUGS: Readonly<Record<PortalTab, string>> = {
  overview: 'oversikt',
  family: 'barn',
  history: 'historikk',
  profile: 'profil',
};

/**
 * The parameter's value as a section. Exact spellings only; anything else — a
 * typo, a repeated parameter, a value from an old link — opens the overview.
 */
export function parsePortalTab(
  value: unknown,
  slugs: Readonly<Record<PortalTab, string>> = DEFAULT_PORTAL_TAB_SLUGS
): PortalTab {
  return (
    PORTAL_TABS.find((tab) => typeof value === 'string' && slugs[tab] === value) ??
    DEFAULT_PORTAL_TAB
  );
}
