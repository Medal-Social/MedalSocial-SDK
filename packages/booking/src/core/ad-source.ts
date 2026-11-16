/**
 * The ad a visitor came from, as the site read it off its own landing link:
 * the network, and the campaign's name when the link named one (`utm_source`
 * and `utm_campaign` of a paid link).
 *
 * Not a click id, and not read from a cookie or from storage: it says which
 * of the site's own ads brought the visit and identifies nobody to the ad
 * network, so a site can hand it over for every visitor. The wizard does not
 * read the URL for it: the site does, on the page the visitor landed on, and
 * answers it through `adSource` on the wizard. It is sent with the booking,
 * so Medal Social can count the bookings each network brought.
 */
export interface BookingAdSource {
  network: 'google' | 'meta';
  campaign?: string;
}

/** Medal Social's rule for a campaign name. Anything else is left out. */
const CAMPAIGN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

/**
 * The source as Medal Social takes it, or null when there is none.
 *
 * Never an error: it only says where the visitor came from. A network Medal
 * Social does not count is no source, and a campaign name of the wrong shape
 * is left out with the network kept.
 */
export function adSourceOf(raw: unknown): BookingAdSource | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { network, campaign } = raw as Record<string, unknown>;
  if (network !== 'google' && network !== 'meta') return null;
  return typeof campaign === 'string' && CAMPAIGN.test(campaign)
    ? { network, campaign }
    : { network };
}
