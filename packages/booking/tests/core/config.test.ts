import { describe, expect, it } from 'vitest';
import {
  BookingConfigError,
  type BookingConfigInput,
  resolveBookingConfig,
} from '../../src/core/config';
import { PARITY_CONFIG } from '../support/parity-config';

function issuesOf(input: BookingConfigInput): string[] {
  try {
    resolveBookingConfig(input);
  } catch (error) {
    expect(error).toBeInstanceOf(BookingConfigError);
    return (error as BookingConfigError).issues.map((issue) => `${issue.path}: ${issue.message}`);
  }
  throw new Error('expected the config to be refused');
}

describe('resolveBookingConfig', () => {
  it('fills every default from a time zone alone', () => {
    const config = resolveBookingConfig({ timeZone: 'Europe/Oslo' });
    expect(config).toMatchObject({
      locale: 'nb-NO',
      currency: 'NOK',
      phone: { country: 'NO', validate: 'strict' },
      paths: { booking: '/bestill', manage: '/bestill/administrer', portal: '/min-side' },
      fallbackCategory: 'annet',
      party: { maxPeople: 3, allowParallel: true, askWhoFirst: true, maxServicesPerPerson: 1 },
      window: { rangeDays: 7, prefetchLimit: 4, prefetchCategory: null },
      handoffUrl: null,
      portal: {
        enabled: false,
        cookieName: 'booking_portal',
        returnPaths: { exact: ['/bestill'], prefixes: [] },
      },
      consent: { termsUrl: null, marketing: null },
      storageNamespace: 'medal',
      monitoring: { enabled: true, sampleRate: 1 },
    });
    expect(config.dayparts.map((part) => part.key)).toEqual(['formiddag', 'ettermiddag', 'kveld']);
  });

  it('merges objects key by key, replaces arrays, and keeps a default only for undefined', () => {
    const config = resolveBookingConfig({
      timeZone: 'Europe/Oslo',
      paths: { booking: '/book', portal: null },
      dayparts: [{ key: 'all', from: 0, to: 24 }],
      contact: undefined,
    });
    expect(config.paths).toMatchObject({ booking: '/book', manage: '/bestill/administrer' });
    // `null` is an answer: this site has no portal.
    expect(config.paths.portal).toBeNull();
    expect(config.dayparts).toEqual([{ key: 'all', from: 0, to: 24 }]);
    expect(config.contact).toEqual({ phone: null, address: null, name: '' });
    // The return path follows the booking page it was given.
    expect(config.portal.returnPaths.exact).toEqual(['/book']);
  });

  it('freezes the whole tree', () => {
    expect(Object.isFrozen(PARITY_CONFIG)).toBe(true);
    expect(Object.isFrozen(PARITY_CONFIG.paths)).toBe(true);
    expect(Object.isFrozen(PARITY_CONFIG.categories[0])).toBe(true);
  });

  it('is idempotent', () => {
    expect(resolveBookingConfig(PARITY_CONFIG)).toEqual(PARITY_CONFIG);
  });

  it('keeps label overrides', () => {
    const config = resolveBookingConfig({
      timeZone: 'Europe/Oslo',
      labels: { 'summary.pickTime': 'Finn en tid' },
    });
    expect(config.labels).toEqual({ 'summary.pickTime': 'Finn en tid' });
  });

  it('keeps a label written as an array of text pieces, and refuses anything else', () => {
    const config = resolveBookingConfig({
      timeZone: 'Europe/Oslo',
      labels: { 'summary.services': ['{count}', ' tjenester'] },
    });
    expect(config.labels).toEqual({ 'summary.services': ['{count}', ' tjenester'] });
    expect(() =>
      resolveBookingConfig({
        timeZone: 'Europe/Oslo',
        labels: { 'summary.services': [1] as unknown as string[] },
      })
    ).toThrow(/labels/);
  });

  it.each<[string, BookingConfigInput, string]>([
    ['an unknown zone', { timeZone: 'Mars/Olympus' }, 'timeZone: must be an IANA time zone'],
    [
      'a malformed locale',
      { timeZone: 'UTC', locale: 'not a locale' },
      'locale: must be a BCP-47 locale',
    ],
    [
      'a lower-case currency',
      { timeZone: 'UTC', currency: 'nok' },
      'currency: must be an ISO 4217 code',
    ],
    [
      'a relative path',
      { timeZone: 'UTC', paths: { booking: 'bestill' } },
      'paths.booking: must be a root-relative path',
    ],
    [
      'a duplicated category',
      {
        timeZone: 'UTC',
        categories: [
          { key: 'annet', audience: 'any' },
          { key: 'annet', audience: 'any' },
        ],
      },
      'categories: category keys must be unique',
    ],
    [
      'a fallback that is not a category',
      { timeZone: 'UTC', fallbackCategory: 'other' },
      'fallbackCategory: must be one of the categories',
    ],
    [
      'a prefetch category that is not a category',
      { timeZone: 'UTC', window: { prefetchCategory: 'other' } },
      'window.prefetchCategory: must be one of the categories',
    ],
    [
      'an adult equivalent that is not a category',
      {
        timeZone: 'UTC',
        categories: [{ key: 'annet', audience: 'child', adultEquivalent: 'other' }],
      },
      'categories.0.adultEquivalent: «other» is not one of the categories',
    ],
    [
      'a name rule pointing nowhere',
      {
        timeZone: 'UTC',
        categories: [
          {
            key: 'annet',
            audience: 'child',
            adultEquivalent: [{ nameIncludes: 'x', category: 'y' }],
          },
        ],
      },
      'categories.0.adultEquivalent: «y» is not one of the categories',
    ],
    [
      'a gap between day parts',
      {
        timeZone: 'UTC',
        dayparts: [
          { key: 'a', from: 0, to: 10 },
          { key: 'b', from: 11, to: 24 },
        ],
      },
      'dayparts.1: dayparts must run contiguously from 0 to 24',
    ],
    [
      'day parts that stop early',
      { timeZone: 'UTC', dayparts: [{ key: 'a', from: 0, to: 20 }] },
      'dayparts: dayparts must end at 24',
    ],
    [
      'an enabled portal with no way in',
      { timeZone: 'UTC', portal: { enabled: true, methods: [] } },
      'portal.methods: an enabled portal needs a login method',
    ],
    [
      'a category key with capitals, which a lower-cased link value never matches',
      {
        timeZone: 'UTC',
        categories: [{ key: 'Annet', audience: 'any' }],
        fallbackCategory: 'Annet',
      },
      'categories.0.key: must be 1–64 lower-case word characters',
    ],
    [
      'a who value with capitals',
      { timeZone: 'UTC', whoValues: { child: 'Barn', adult: 'voksen' } },
      'whoValues.child: must be 1–64 lower-case word characters',
    ],
    [
      'a return prefix that does not end at a segment',
      { timeZone: 'UTC', portal: { returnPaths: { exact: [], prefixes: ['/flow'] } } },
      'portal.returnPaths.prefixes.0: a prefix must end with /',
    ],
    [
      'a non-nullable section set to null',
      { timeZone: 'UTC', contact: null as never },
      'contact: Invalid input: expected object, received null',
    ],
    [
      'a binding cookie without the __Host- prefix',
      { timeZone: 'UTC', portal: { vippsBindingCookieName: 'bind' } },
      'portal.vippsBindingCookieName: must carry the __Host- prefix',
    ],
  ])('refuses %s', (_, input, issue) => {
    expect(issuesOf(input)).toContain(issue);
  });

  it('says every issue in its message', () => {
    expect(() => resolveBookingConfig({ timeZone: 'Mars/Olympus', currency: 'nok' })).toThrow(
      /Invalid booking config:\n {2}timeZone: .*\n {2}currency: /
    );
  });

  it('accepts an http(s) handoff and nothing else', () => {
    expect(
      resolveBookingConfig({ timeZone: 'UTC', handoffUrl: 'https://booking.example/salon' })
        .handoffUrl
    ).toBe('https://booking.example/salon');
    expect(issuesOf({ timeZone: 'UTC', handoffUrl: 'javascript:alert(1)' })[0]).toMatch(
      /^handoffUrl:/
    );
  });
});

/**
 * Pre-release review: the three secondary portal cookie names derive from
 * `portal.cookieName` with a prefix and a suffix. A base name that fits the
 * 128-character limit but leaves no room for them is reported against the
 * name the site wrote, with the length that would fit — not as a pattern
 * mismatch on a name the site never set.
 */
describe('resolveBookingConfig — derived portal cookie names', () => {
  const withCookie = (portal: Partial<BookingConfigInput['portal']>) =>
    ({ timeZone: 'Europe/Oslo', portal: { cookieName: 'x', ...portal } }) as BookingConfigInput;

  it('accepts the longest base name every derived name still fits', () => {
    // `__Host-` + base + `_vipps_bind` is the longest: 7 + 110 + 11 = 128.
    const base = 'p'.repeat(110);
    const config = resolveBookingConfig(withCookie({ cookieName: base }));
    expect(config.portal.vippsBindingCookieName).toHaveLength(128);
    expect(config.portal.vippsLinkCookieName).toBe(`${base}_vipps_link`);
    expect(config.portal.nextCookieName).toBe(`${base}_next`);
  });

  it('names the base name and the room left when a derived name would be too long', () => {
    const issues = issuesOf(withCookie({ cookieName: 'p'.repeat(111) }));
    expect(issues).toEqual([
      'portal.cookieName: must be at most 110 characters, or the derived portal.vippsBindingCookieName would exceed 128; shorten it or set that name explicitly',
    ]);
  });

  it('lists every derived name that would overflow, and the tightest room', () => {
    const issues = issuesOf(withCookie({ cookieName: 'p'.repeat(124) }));
    expect(issues).toEqual([
      'portal.cookieName: must be at most 110 characters, or the derived portal.nextCookieName, portal.vippsBindingCookieName, portal.vippsLinkCookieName would exceed 128; shorten it or set those names explicitly',
    ]);
  });

  it('takes a long base name whose secondary names the site sets itself', () => {
    const config = resolveBookingConfig(
      withCookie({
        cookieName: 'p'.repeat(128),
        nextCookieName: 'p_next',
        vippsBindingCookieName: '__Host-p_bind',
        vippsLinkCookieName: 'p_link',
      })
    );
    expect(config.portal.cookieName).toHaveLength(128);
  });

  it('still judges only what was derived: an explicit name keeps its own issue', () => {
    const issues = issuesOf(
      withCookie({ cookieName: 'p'.repeat(111), vippsLinkCookieName: 'bad name' })
    );
    expect(issues[0]).toMatch(/^portal\.cookieName: must be at most 110 characters/);
    expect(issues.some((issue) => issue.startsWith('portal.vippsLinkCookieName:'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('portal.vippsBindingCookieName:'))).toBe(false);
  });

  it('reports a base name with a bad character as before', () => {
    const issues = issuesOf(withCookie({ cookieName: 'bad name' }));
    expect(issues.some((issue) => issue.startsWith('portal.cookieName:'))).toBe(true);
  });

  /**
   * Pre-release review: the derived-length check runs only once the schema
   * has refused the input, so it must not assume the base is a string. A
   * runtime `null` (or any non-string) is the schema's issue, not a TypeError.
   */
  for (const bad of [null, 42, { name: 'x' }]) {
    it(`refuses a non-string base name (${JSON.stringify(bad)}) with a BookingConfigError`, () => {
      const input = withCookie({ cookieName: bad as never });
      expect(() => resolveBookingConfig(input)).toThrow(BookingConfigError);
      const issues = issuesOf(input);
      expect(issues.some((issue) => issue.startsWith('portal.cookieName:'))).toBe(true);
      expect(issues.some((issue) => issue.includes('characters'))).toBe(false);
    });
  }
});

describe('party.maxServicesPerPerson', () => {
  it('defaults to 1 (the one-tap step), takes up to 4 and refuses 0 and 5', () => {
    expect(resolveBookingConfig({ timeZone: 'Europe/Oslo' }).party.maxServicesPerPerson).toBe(1);
    expect(
      resolveBookingConfig({ timeZone: 'Europe/Oslo', party: { maxServicesPerPerson: 4 } }).party
        .maxServicesPerPerson
    ).toBe(4);
    for (const maxServicesPerPerson of [0, 5]) {
      expect(() =>
        resolveBookingConfig({ timeZone: 'Europe/Oslo', party: { maxServicesPerPerson } })
      ).toThrow();
    }
  });
});
