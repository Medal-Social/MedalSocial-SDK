import type { IcsEvent } from '../../core/ics';

/**
 * Which calendar a device opens best from a link:
 *
 * - `apple` — iPhone, iPad and Mac. A calendar file served as `text/calendar`
 *   opens straight into «Add to Calendar»; a downloaded one lands in Files.
 * - `android` — the Google Calendar app cannot open a calendar file at all, so
 *   Google's own add-event page is the way in.
 * - `other` — a desktop: the file opens in Outlook or the system calendar.
 */
export type CalendarPlatform = 'apple' | 'android' | 'other';

export function calendarPlatform(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined
): CalendarPlatform {
  if (nav === undefined) return 'other';
  const ua = nav.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS reports itself as a Mac; either way it is Apple's calendar.
  if (/iPhone|iPad|iPod|Macintosh/i.test(ua)) return 'apple';
  return 'other';
}

/** `20261014T130000Z`: Google's `dates` form, in UTC. */
function googleStamp(ts: number): string {
  return new Date(ts)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Google Calendar's add-event page for one event: it works in every browser,
 * in-app browsers included, and is the Android app's way in.
 */
export function googleCalendarHref(event: IcsEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.summary,
    dates: `${googleStamp(event.startTs)}/${googleStamp(event.endTs)}`,
  });
  if (event.description) params.set('details', event.description);
  if (event.location) params.set('location', event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export interface CalendarLinks {
  calendarHref: string;
  /** Google's page opens beside the confirmation; the file opens in place. */
  calendarNewTab: boolean;
  calendarAlt: { href: string; label: string; newTab: boolean } | null;
}

/**
 * The confirmation's calendar link for this device, and the other way in
 * beside it. Google takes one event per link, so a family's visit is only
 * ever offered as the file.
 *
 * `googleEvents` are the same visit WITHOUT the change link in the notes: that
 * link is a bearer credential, and Google would receive it in the URL before
 * the visitor decided to save anything. The served file needs no words from
 * here — the server writes its own.
 */
export function calendarLinks({
  platform,
  googleEvents,
  dataHref,
  servedPath,
  labels,
}: {
  platform: CalendarPlatform;
  googleEvents: readonly IcsEvent[];
  /** The `data:` file: what a confirmation saved before the served file existed falls back to. */
  dataHref: string;
  servedPath: string | null;
  labels: { google: string; file: string };
}): CalendarLinks {
  const file = servedPath ?? dataHref;
  const google = googleEvents.length === 1 ? googleCalendarHref(googleEvents[0] as IcsEvent) : null;
  if (platform === 'android' && google !== null) {
    return {
      calendarHref: google,
      calendarNewTab: true,
      calendarAlt: { href: file, label: labels.file, newTab: false },
    };
  }
  return {
    calendarHref: file,
    calendarNewTab: false,
    calendarAlt: google === null ? null : { href: google, label: labels.google, newTab: true },
  };
}
