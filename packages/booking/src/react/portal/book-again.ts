import type { BookingConfig } from '../../core/config';

/**
 * «Book again», with the catalogue ids the wizard understands.
 *
 * `bookingHref` is where booking happens for this site. When it is the site's
 * own wizard (`paths.booking`) the ids ride along in the query string. When
 * booking is handed to somebody else they do NOT: they are this backend's
 * ids, they mean nothing at the other end, and pinning them to a stranger's
 * URL would leak the catalogue into an address bar. The person's NAME never
 * rides in the URL either way — see `RebookStore`.
 */
export function bookAgainHref(
  config: Pick<BookingConfig, 'paths' | 'query'>,
  bookingHref: string,
  ids: { serviceId?: string | null; resourceId?: string | null } = {}
): string {
  if (bookingHref !== config.paths.booking || !ids.serviceId) return bookingHref;
  const params = [`${config.query.rebookService}=${encodeURIComponent(ids.serviceId)}`];
  if (ids.resourceId)
    params.push(`${config.query.rebookStylist}=${encodeURIComponent(ids.resourceId)}`);
  return `${bookingHref}?${params.join('&')}`;
}
