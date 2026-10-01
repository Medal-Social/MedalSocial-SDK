/**
 * One iCalendar object, built by hand.
 *
 * A dependency for this would be four hundred lines of RFC 5545 the salon does
 * not need, and the parts that actually bite — CRLF, folding measured in octets
 * rather than characters, and UTC stamps — are the parts a library would hide
 * rather than the parts it would save.
 *
 * Pure and free of React for the same reason `clock.ts` is: the
 * confirmation screen inlines the result into a `data:` URL, and the
 * reschedule mail will attach the same bytes.
 */

/** RFC 5545 §3.1: a content line is at most 75 octets, excluding the CRLF. */
const MAX_OCTETS = 75;

const CRLF = '\r\n';

export interface IcsEvent {
  /**
   * Stable for the life of the appointment, and deliberately not regenerated on
   * a reschedule: the UID is the only thing that tells a calendar the new
   * invitation is the old one moved rather than a second haircut.
   */
  uid: string;
  startTs: number;
  endTs: number;
  summary: string;
  description?: string;
  location?: string;
  /**
   * `PUBLISH` is «here is an appointment, add it» — the confirmation screen's
   * «Legg til i kalender». `REQUEST` is «this replaces what you already have»,
   * and is what a reschedule mail must send: a PUBLISH with a new time leaves
   * the old appointment sitting in the customer's calendar alongside the new
   * one, which is worse than sending nothing at all.
   */
  method?: 'PUBLISH' | 'REQUEST';
  /**
   * The revision counter, and the half of the reschedule promise that clients
   * actually enforce. A REQUEST carrying a UID they already hold *and* a
   * SEQUENCE they have already seen is a replay: Outlook and Google keep the
   * appointment they have. Every reschedule must therefore hand in a number
   * higher than the last one sent for that booking.
   */
  sequence?: number;
  /** When this object was produced. Injectable so it can be asserted; there is
   * no other reason to pass it. */
  stampTs?: number;
}

/**
 * `20260903T130000Z` — a UTC date-time, which is the one form that means the
 * same thing to every calendar that opens it.
 *
 * Through `toISOString()` rather than the salon clock deliberately. Everything
 * the visitor *reads* is Oslo time and comes from `clock.ts`; this is not
 * read by anyone, it is the instant itself, and a floating local time here
 * would land the appointment three hours out for the family booking from Spain.
 */
function utcStamp(ts: number): string {
  return new Date(ts)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/**
 * RFC 5545 §3.3.11. `;` and `,` are the format's own separators, so an
 * unescaped one in «Noe vi bør vite?» ends the property early and puts the rest
 * of the parent's sentence where a parameter belongs.
 *
 * Backslash first, or the escapes added below would be escaped again.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold to 75 **octets**, not 75 characters.
 *
 * Norwegian is not ASCII: `ø` and `å` are two octets each, so a fold counted in
 * characters overruns the limit on exactly the summaries this salon produces.
 * Counting octets and cutting blindly is the opposite failure — the cut lands
 * between the two halves of one letter and the client decodes `�` — so the
 * boundary walks back off any UTF-8 continuation octet (`10xxxxxx`) first.
 *
 * Continuation lines spend one octet on their leading space, so they carry 74.
 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= MAX_OCTETS) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let offset = 0;
  let capacity = MAX_OCTETS;

  while (offset < bytes.length) {
    let end = Math.min(offset + capacity, bytes.length);
    while (end > offset + 1 && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
      end -= 1;
    }
    chunks.push(decoder.decode(bytes.subarray(offset, end)));
    offset = end;
    capacity = MAX_OCTETS - 1;
  }

  return chunks.join(`${CRLF} `);
}

/** Absent stays absent: `LOCATION:` with nothing after it renders as a blank
 * address line, which reads as a salon that has lost its address. */
function textProperty(name: string, value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : `${name}:${escapeText(value)}`;
}

/** One VEVENT. Split out because a calendar may hold several of them and the
 * wrapper around them is written once. */
function eventLines(event: IcsEvent): (string | null)[] {
  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `DTSTAMP:${utcStamp(event.stampTs ?? Date.now())}`,
    `DTSTART:${utcStamp(event.startTs)}`,
    `DTEND:${utcStamp(event.endTs)}`,
    textProperty('SUMMARY', event.summary),
    textProperty('DESCRIPTION', event.description),
    textProperty('LOCATION', event.location),
    'END:VEVENT',
  ];
}

/**
 * One calendar, holding one appointment or several.
 *
 * Several is the family visit: each child is its own booking with its own
 * manage link, moved on its own, so each needs a VEVENT of its own with that
 * child's booking id as the UID. A single event spanning the whole visit could
 * only ever carry one of those ids, and every other child's reschedule would
 * then add a second entry rather than move the one already in the calendar.
 *
 * `METHOD` is a property of the VCALENDAR rather than of an event, so it is
 * taken from the first — a list whose events disagree about it is asking for
 * something the format cannot express.
 */
function buildIcs(prodId: string, events: IcsEvent | readonly IcsEvent[]): string {
  const list = Array.isArray(events) ? (events as readonly IcsEvent[]) : [events as IcsEvent];
  const lines: (string | null)[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // The PRODID identifies the software, and RFC 5545 requires one (the site's
    // `config.ics.prodId`). Nothing reads it; a missing one makes strict
    // parsers reject the file.
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${list[0]?.method ?? 'PUBLISH'}`,
    ...list.flatMap(eventLines),
    'END:VCALENDAR',
  ];

  // Trailing CRLF included: the last content line is a line like any other, and
  // a file that ends mid-line is one a strict parser is entitled to refuse.
  return `${lines
    .filter((line) => line !== null)
    .map(fold)
    .join(CRLF)}${CRLF}`;
}

/**
 * The same bytes as a link target.
 *
 * `charset=utf-8` is not decoration — without it the media type defaults to
 * US-ASCII and «Fødselsdagsklipp» arrives mangled in the calendar entry.
 */
export function icsDataUrl(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export interface Ics {
  buildIcs(events: IcsEvent | readonly IcsEvent[]): string;
  icsDataUrl: typeof icsDataUrl;
}

export function createIcs(config: { ics: { prodId: string } }): Ics {
  return {
    buildIcs: (events) => buildIcs(config.ics.prodId, events),
    icsDataUrl,
  };
}
