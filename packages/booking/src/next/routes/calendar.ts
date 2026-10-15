import { MedalApiError } from '@medalsocial/sdk';
import { NextResponse } from 'next/server';
import { createIcs, type IcsEvent } from '../../core/ics';
import { fill, resolveLabels } from '../../core/labels';
import { toManageDto } from '../manage-dto';
import type { BookingRuntime } from '../runtime';
import { catalogueErrorResponse } from './shared';

/**
 * A Medal manage token: an HMAC-SHA256 in base64url (43 characters today).
 * Checked before Medal is asked, so a junk list costs no upstream call — and
 * since a comma is not in the alphabet, the list separator cannot split one.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;
/** The whole file, however many bookings it holds. */
const DEADLINE_MS = 10_000;

const CALENDAR_HEADERS = {
  'Content-Type': 'text/calendar; charset=utf-8',
  // In place, not as an attachment: iOS and macOS then open «Add to Calendar»
  // rather than saving a file to Files.
  'Content-Disposition': 'inline; filename="booking.ics"',
  // The URL carries manage tokens: never stored, never sent on as a referrer.
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
} as const;

/** A refusal: still never stored, never sent on as a referrer. */
const REFUSAL_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

function refusal(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: REFUSAL_HEADERS });
}

class CalendarDeadline extends Error {}

/**
 * `GET <api>/calendar/<token>[,<token>…]` — the visit as a calendar file a
 * phone opens directly («Legg til i kalender»), one event per booking.
 *
 * Everything in the file is the server's: the time, the end and the UID come
 * from Medal by each booking's manage token; the title, the change link and
 * the place from the site's config and labels (`ics.*`, `contact`). Nothing is
 * taken from the URL but the tokens, so a link on the site's domain can only
 * ever describe a booking that exists, in the site's own words.
 *
 * Several tokens (a family) are read at once, under one deadline, and each
 * token past the first is counted against the site's rate limiter.
 */
export async function calendarRoute(
  rt: BookingRuntime,
  request: Request,
  segment: string
): Promise<Response> {
  const tokens = segment.split(',');
  if (
    tokens.length > rt.config.party.maxPeople ||
    !tokens.every((token) => TOKEN_SHAPE.test(token))
  ) {
    return refusal('notFound', 404);
  }
  // The dispatcher counted one; a family file is one Medal read per person.
  for (let extra = 1; extra < tokens.length; extra += 1) {
    if (rt.options.rateLimit && (await rt.options.rateLimit('booking/calendar', request))) {
      return refusal('rateLimited', 429);
    }
  }

  const read = async (token: string) => {
    try {
      return toManageDto(await rt.medal.getManage(token));
    } catch (error) {
      // An unknown or revoked token is one missing line, not a failed file.
      if (error instanceof MedalApiError && error.status === 404) return null;
      throw error;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bookings: Awaited<ReturnType<typeof read>>[];
  try {
    bookings = await Promise.race([
      Promise.all(tokens.map(read)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CalendarDeadline()), DEADLINE_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof CalendarDeadline) {
      rt.logger.warn({ tokens: tokens.length }, 'Calendar file: Medal did not answer in time');
      return refusal('upstreamError', 504);
    }
    return catalogueErrorResponse(rt, error, 'calendar');
  } finally {
    clearTimeout(timer);
  }

  const labels = resolveLabels(rt.config.locale, rt.config.labels);
  const business = rt.config.contact.name;
  const origin = rt.baseUrl() ?? new URL(request.url).origin;
  const events: IcsEvent[] = [];
  bookings.forEach((booking, index) => {
    if (booking === null || booking.status === 'cancelled') return;
    const manageUrl = new URL(rt.paths.managePath(tokens[index] as string), origin).toString();
    events.push({
      uid: booking.bookingId,
      startTs: booking.startTs,
      endTs: booking.endTs,
      summary: fill(labels[booking.bookedForName ? 'ics.titleFor' : 'ics.title'], {
        service: booking.serviceName,
        name: booking.bookedForName ?? '',
        business,
      }),
      description: fill(labels['ics.manage'], { url: manageUrl }),
      ...(rt.config.contact.address ? { location: rt.config.contact.address } : {}),
    });
  });
  if (events.length === 0) return refusal('notFound', 404);
  return new NextResponse(createIcs(rt.config).buildIcs(events), {
    status: 200,
    headers: CALENDAR_HEADERS,
  });
}
