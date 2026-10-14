import { describe, expect, it } from 'vitest';
import type { IcsEvent } from '../../../src/core/ics';
import {
  calendarLinks,
  calendarPlatform,
  googleCalendarHref,
  servedCalendarHref,
} from '../../../src/react/wizard/calendar';

const EVENT: IcsEvent = {
  uid: 'bk-1',
  startTs: Date.UTC(2026, 9, 20, 11),
  endTs: Date.UTC(2026, 9, 20, 11, 30),
  summary: 'Barneklipp hos Salong Demo',
  description: 'Endre: https://salong.example/m/tok',
  location: 'Torget 1, 0001 Oslo',
};
const LABELS = { google: 'Google Kalender', file: 'Kalenderfil (.ics)' };
const ua = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

describe('calendarPlatform', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'apple'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'apple'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) Instagram 350', 'android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'other'],
  ])('%s → %s', (userAgent, platform) => {
    expect(calendarPlatform(ua(userAgent))).toBe(platform);
  });

  it('is «other» with no browser to ask', () => {
    expect(calendarPlatform(undefined)).toBe('other');
  });
});

describe('googleCalendarHref', () => {
  it('fills Google’s add-event form in UTC', () => {
    const url = new URL(googleCalendarHref(EVENT));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261020T110000Z/20261020T113000Z');
    expect(url.searchParams.get('location')).toBe('Torget 1, 0001 Oslo');
    expect(url.searchParams.get('details')).toContain('Endre');
  });

  it('leaves out what the event does not have', () => {
    const url = new URL(
      googleCalendarHref({ ...EVENT, description: undefined, location: undefined })
    );
    expect(url.searchParams.has('details')).toBe(false);
    expect(url.searchParams.has('location')).toBe(false);
  });
});

describe('servedCalendarHref', () => {
  it('carries the words per booking and the place once', () => {
    const href = servedCalendarHref('/api/booking/calendar/a,b', [
      EVENT,
      { ...EVENT, uid: 'bk-2', description: undefined, location: undefined },
    ]);
    const url = new URL(href, 'https://salong.example');
    expect(url.pathname).toBe('/api/booking/calendar/a,b');
    expect(url.searchParams.getAll('s')).toHaveLength(2);
    expect(url.searchParams.getAll('d')).toEqual([EVENT.description, '']);
    expect(url.searchParams.get('l')).toBe('Torget 1, 0001 Oslo');
  });

  it('names no place when the first event has none', () => {
    const href = servedCalendarHref('/c/a', [{ ...EVENT, location: undefined }]);
    expect(new URL(href, 'https://x.example').searchParams.has('l')).toBe(false);
  });
});

describe('calendarLinks', () => {
  const base = {
    events: [EVENT],
    dataHref: 'data:text/calendar,x',
    servedPath: '/c/a',
    labels: LABELS,
  };

  it('gives an iPhone the served file, with Google beside it', () => {
    const links = calendarLinks({ ...base, platform: 'apple' });
    expect(links.calendarHref.startsWith('/c/a?')).toBe(true);
    expect(links.calendarAlt?.label).toBe('Google Kalender');
    expect(links.calendarNewTab).toBe(false);
    expect(links.calendarAlt?.newTab).toBe(true);
  });

  it('gives Android Google, with the file beside it', () => {
    const links = calendarLinks({ ...base, platform: 'android' });
    expect(links.calendarHref).toMatch(/^https:\/\/calendar\.google\.com/);
    expect(links.calendarAlt?.label).toBe('Kalenderfil (.ics)');
    expect(links.calendarNewTab).toBe(true);
    expect(links.calendarAlt?.newTab).toBe(false);
  });

  it('gives a family the file everywhere: Google takes one event per link', () => {
    const links = calendarLinks({ ...base, events: [EVENT, EVENT], platform: 'android' });
    expect(links.calendarHref.startsWith('/c/a?')).toBe(true);
    expect(links.calendarAlt).toBeNull();
  });

  it('falls back to the data: file without tokens', () => {
    const links = calendarLinks({ ...base, servedPath: null, platform: 'other' });
    expect(links.calendarHref).toBe('data:text/calendar,x');
    expect(links.calendarAlt?.label).toBe('Google Kalender');
  });
});
