import { PortalShell, type PortalShellIcon } from '@medalsocial/meda/booking';
import type { ReactNode } from 'react';
import { labelText } from '../../core/labels';
import type { ResolvedBooking } from '../Provider';
import { screenLabels } from '../screen-labels';
import {
  DEFAULT_PORTAL_TAB,
  DEFAULT_PORTAL_TAB_PARAM,
  DEFAULT_PORTAL_TAB_SLUGS,
  type PortalTab,
} from './tabs';

/** The icons a tab may carry, rail and bottom bar. */
export type PortalTabIcons = Partial<
  Record<PortalTab, { icon?: PortalShellIcon; shortIcon?: PortalShellIcon }>
>;

export interface PortalSectionsProps extends Record<PortalTab, ReactNode> {
  booking: ResolvedBooking;
  header?: ReactNode;
  account?: ReactNode;
  logout?: ReactNode;
  initialTab?: PortalTab;
  /** The query parameter the open section rides in. Default `fane`. */
  tabParam?: string;
  tabSlugs?: Readonly<Record<PortalTab, string>>;
  icons?: PortalTabIcons;
}

/**
 * The portal's four sections in meda's shell, with the open one in the URL so
 * a reload or a link lands on it. Written with `history.replaceState`, not a
 * router navigation: the page is per-request, and a router replace would
 * render it on the server again to move a `hidden` attribute. Replace, not
 * push: a tab is not a page, and Back should leave the portal.
 */
export function PortalSections({
  booking,
  header,
  account,
  logout,
  initialTab = DEFAULT_PORTAL_TAB,
  tabParam = DEFAULT_PORTAL_TAB_PARAM,
  tabSlugs = DEFAULT_PORTAL_TAB_SLUGS,
  icons,
  ...sections
}: PortalSectionsProps) {
  const { labels } = booking.kit;
  const tab = (id: PortalTab, short?: string) => ({
    id,
    label: labelText(labels[`portal.tab.${id}`]),
    short,
    ...icons?.[id],
    content: sections[id],
  });
  return (
    <PortalShell<PortalTab>
      labels={screenLabels(labels)}
      classNames={booking.classNames.portalShell}
      header={header}
      account={account}
      logout={logout}
      defaultTab={initialTab}
      onTabChange={(next) => {
        const url = new URL(window.location.href);
        if (next === DEFAULT_PORTAL_TAB) url.searchParams.delete(tabParam);
        else url.searchParams.set(tabParam, tabSlugs[next]);
        window.history.replaceState(null, '', url);
      }}
      tabs={[
        tab('overview', labelText(labels['portal.tab.overviewShort'])),
        tab('family'),
        tab('history'),
        tab('profile'),
      ]}
    />
  );
}
