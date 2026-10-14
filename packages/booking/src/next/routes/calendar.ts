import { MedalApiError } from '@medalsocial/sdk';
import { NextResponse } from 'next/server';
import { createIcs, type IcsEvent } from '../../core/ics';
import { toManageDto } from '../manage-dto';
import type { BookingRuntime } from '../runtime';
import { catalogueErrorResponse } from './shared';

/** The most bookings one calendar file holds — the most one booking can seat. */
const MAX_TOKENS = 20;
/** Each wording hint is clipped: it is a calendar title, not a document. */
const MAX_HINT = 300;

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
const NOT_FOUND_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

function notFound(): NextResponse {
  return NextResponse.json({ error: 'notFound' }, { status: 404, headers: NOT_FOUND_HEADERS });
}

function hint(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, MAX_HINT) : undefined;
}

/**
 * `GET <api>/calendar/<token>[,<token>…]` — the visit as a calendar file a
 * phone opens directly («Legg til i kalender»), one event per booking.
 *
 * What the event IS comes from Medal, by the manage token each line was
 * booked with: the time, the end and the booking id (the UID). Only the
 * wording comes from the URL — `s` (the title) and `d` (the notes) once per
 * token in order, and `l` (where) — because the words are the site's own and
 * the server does not hold them. So the URL cannot describe a booking that
 * does not exist: without a valid token there is no file.
 */
export async function calendarRoute(
  rt: BookingRuntime,
  request: Request,
  segment: string
): Promise<Response> {
  const tokens = segment.split(',').filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) {
    return notFound();
  }
  const params = new URL(request.url).searchParams;
  const titles = params.getAll('s');
  const notes = params.getAll('d');
  const location = hint(params.get('l')) ?? rt.config.contact.address ?? undefined;

  const events: IcsEvent[] = [];
  try {
    for (const [index, token] of tokens.entries()) {
      let booking: ReturnType<typeof toManageDto>;
      try {
        booking = toManageDto(await rt.medal.getManage(token));
      } catch (error) {
        // An unknown or revoked token is one missing line, not a failed file.
        if (error instanceof MedalApiError && error.status === 404) continue;
        throw error;
      }
      if (booking === null || booking.status === 'cancelled') continue;
      events.push({
        uid: booking.bookingId,
        startTs: booking.startTs,
        endTs: booking.endTs,
        summary:
          hint(titles[index]) ??
          [booking.serviceName, rt.config.contact.name].filter(Boolean).join(' – '),
        description: hint(notes[index]),
        location,
      });
    }
  } catch (error) {
    return catalogueErrorResponse(rt, error, 'calendar');
  }
  if (events.length === 0) {
    return notFound();
  }
  return new NextResponse(createIcs(rt.config).buildIcs(events), {
    status: 200,
    headers: CALENDAR_HEADERS,
  });
}
