/**
 * `<PortalDashboard>` — the customer portal — and its helpers. The parsers a
 * Server Component calls (`parsePortalTab`, `parseAgePromptDismissed`,
 * `vippsLinkFlash`, …) are also exported from the server-safe
 * `@medalsocial/booking/react/shared`, because everything in `/react` is a
 * client module.
 */

export { agePromptCookie, agePromptCookieName, parseAgePromptDismissed } from './portal/age-prompt';
export { bookAgainHref } from './portal/book-again';
export { createChildSummaries } from './portal/child-summary';
export {
  PortalDashboard,
  type PortalDashboardProps,
  PortalDashboardUnreachable,
  type PortalDashboardUnreachableProps,
} from './portal/dashboard';
export { leavePortal } from './portal/leave';
export { SESSION_TOUCH_THROTTLE_MS, SessionTouch, sessionTouchKey } from './portal/SessionTouch';
export type { PortalTabIcons } from './portal/sections';
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
