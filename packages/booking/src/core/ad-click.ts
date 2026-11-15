/**
 * The Google Ads click a visitor arrived with: `gclid`, or `gbraid` / `wbraid`
 * where Google sends those instead.
 *
 * The wizard does not read it from the URL and does not store it. The site
 * hands it over (`adClick` on the wizard) once its visitor has agreed to
 * marketing, because only the site knows that. It is sent with the booking, so
 * Medal Social can tell a booking an ad brought from the rest.
 */
export interface BookingAdClick {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
}

const PARAMS = ['gclid', 'gbraid', 'wbraid'] as const;
/** Medal Social's rule for a click id. Anything else is a 400 there, so it is dropped here. */
const CLICK_ID = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * The click as Medal Social takes it, or null when there is none.
 *
 * Never an error: the click only says where the visitor came from. An id of
 * the wrong shape is left out, and a value with no usable id is no click.
 */
export function adClickOf(raw: unknown): BookingAdClick | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const click: BookingAdClick = {};
  for (const name of PARAMS) {
    const value = (raw as Record<string, unknown>)[name];
    if (typeof value === 'string' && CLICK_ID.test(value)) click[name] = value;
  }
  return Object.keys(click).length > 0 ? click : null;
}
