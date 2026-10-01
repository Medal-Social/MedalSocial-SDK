/**
 * `@medalsocial/booking/react/shared` — the parts of the booking UI a Server
 * Component calls before it renders one: the label packs, and the portal's
 * URL and cookie readers.
 *
 * Everything in `@medalsocial/booking/react` is a client module, and a
 * function imported from one into a Server Component arrives as a client
 * reference, not something the server can call. This entry carries no
 * `'use client'` and no React, so the page resolves its label pack here
 * (`mergeLabels(locale, siteWords)` → `config.labels`) and the browser bundle
 * never carries a pack it does not show.
 */

export * from './labels';
export { agePromptCookieName, parseAgePromptDismissed } from './portal/age-prompt';
export { bookAgainHref } from './portal/book-again';
export { createChildSummaries } from './portal/child-summary';
export {
  DEFAULT_PORTAL_TAB,
  DEFAULT_PORTAL_TAB_PARAM,
  DEFAULT_PORTAL_TAB_SLUGS,
  PORTAL_TABS,
  type PortalTab,
  parsePortalTab,
} from './portal/tabs';
export {
  VIPPS_LINK_FLASHES,
  type VippsLinkFlash,
  vippsFlashPath,
  vippsLinkFlash,
} from './portal/vipps-flash';
