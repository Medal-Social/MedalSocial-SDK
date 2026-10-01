/**
 * The parameterisation, proved: everything the parity suite pins for one
 * Norwegian salon, asked again of a London studio with another currency,
 * other groups and other words. Each assertion fails if a module still reads
 * a Norwegian default instead of the config it was built with.
 */

import { describe, expect, it } from 'vitest';
import { createAge } from '../../src/core/age';
import { createClock } from '../../src/core/clock';
import { createDeepLinks } from '../../src/core/deep-link';
import { createDto } from '../../src/core/dto';
import { createIcs } from '../../src/core/ics';
import { createWizard, type WizardService } from '../../src/core/machine';
import { createMoney } from '../../src/core/money';
import { createPartySlots } from '../../src/core/party-slots';
import { createPaths } from '../../src/core/paths';
import { createPhone } from '../../src/core/phone';
import { createReturnPath } from '../../src/core/portal/return-path';
import { createSessionCookie } from '../../src/core/portal/session-cookie';
import { createStores } from '../../src/core/stores';
import { SECOND_CONFIG } from '../support/second-config';
import { pinAForeignViewerClock } from '../support/viewer-clock';

pinAForeignViewerClock();

/** London wall time, spelled with its offset: BST (+01:00) until 25 Oct 2026. */
function london(iso: string): number {
  return Date.parse(iso);
}

const clock = createClock(SECOND_CONFIG);
const wizard = createWizard(SECOND_CONFIG);

const KIDS_CUT: WizardService = {
  id: 'svc-kids',
  name: 'Kids cut',
  category: 'kids',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 1250,
  maxPerBooking: 2,
  weekendSurchargePct: 20,
};

const ADULT_CUT: WizardService = {
  ...KIDS_CUT,
  id: 'svc-adult',
  name: 'Adult cut',
  category: 'adults',
  priceOre: 3000,
  maxPerBooking: 1,
};

describe('clock — Europe/London, en-GB', () => {
  it('reads the studio wall clock, not the viewer’s', () => {
    const ts = london('2026-10-08T15:00:00+01:00');
    expect(clock.formatTime(ts)).toBe('15:00');
    expect(clock.hour(ts)).toBe(15);
    expect(clock.dayKey(ts)).toBe('2026-10-08');
    expect(clock.daypartOf(ts)).toBe('afternoon');
    expect(clock.daypartOf(london('2026-10-08T18:00:00+01:00'))).toBe('evening');
    expect(clock.daypartLabel('afternoon')).toBe('Afternoon');
  });

  it('keeps Saturday Saturday at 00:30 BST, while UTC still says Friday', () => {
    const saturday = london('2026-10-24T00:30:00+01:00');
    expect(new Date(saturday).getUTCDay()).toBe(5);
    expect(clock.isWeekend(saturday)).toBe(true);
    expect(clock.dayKey(saturday)).toBe('2026-10-24');
  });

  it('says today and tomorrow in English, then the weekday, then the date', () => {
    const now = london('2026-10-08T09:00:00+01:00');
    expect(clock.dayLabel(london('2026-10-08T15:00:00+01:00'), now)).toBe('today');
    expect(clock.dayLabel(london('2026-10-09T15:00:00+01:00'), now)).toBe('tomorrow');
    expect(clock.dayLabel(london('2026-10-10T15:00:00+01:00'), now)).toBe('Saturday');
    expect(clock.dayLabel(london('2026-10-20T15:00:00+01:00'), now)).toBe('20 Oct');
    expect(clock.dayChip(london('2026-10-08T15:00:00+01:00'), now)).toBe('Today');
    expect(clock.dayChip(london('2026-10-09T15:00:00+01:00'), now)).toBe('Tomorrow');
    expect(clock.dayChip(london('2026-10-10T15:00:00+01:00'), now)).toBe('Sat 10');
    expect(clock.when(london('2026-10-08T14:15:00+01:00'), now)).toBe('today 14:15');
  });

  it('writes an absolute appointment in the locale’s own words', () => {
    const ts = london('2026-10-08T15:00:00+01:00');
    expect(clock.date(ts)).toBe('Thu 8 Oct');
    expect(clock.dateTime(ts)).toBe('Thu 8 Oct at 15:00');
    expect(clock.weekday(ts)).toBe('Thursday');
  });

  it('neither skips nor repeats a day across the UK change, a week before Oslo’s calendar would', () => {
    const from = london('2026-10-23T10:00:00+01:00');
    const { days, toTs } = clock.window(from, SECOND_CONFIG.window.rangeDays);
    expect(days.map(clock.dayKey)).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
    // Sunday 25 Oct is 25 hours long in London.
    expect(days[3] - days[2]).toBe(25 * 3_600_000);
    expect(toTs).toBe(Date.parse('2026-10-28T00:00:00Z'));
  });
});

describe('money — GBP', () => {
  const money = createMoney(SECOND_CONFIG);

  it('writes pounds through Intl, whole amounts whole and pence to two places', () => {
    expect(money.formatPrice(12)).toBe('£12');
    expect(money.formatPrice(12.5)).toBe('£12.50');
    expect(money.formatPrice(1860)).toBe('£1,860');
    expect(money.formatMinor(1250)).toBe('£12.50');
    expect(money.formatMinor(3000)).toBe('£30');
  });
});

describe('phone — GB', () => {
  it('has no strict rule set outside Norway, so it is loose', () => {
    const phone = createPhone(SECOND_CONFIG);
    expect(phone.validate).toBe('loose');
    expect(phone.looksValid('+44 20 7946 0958')).toBe(true);
    expect(phone.looksValid('020 7946 0958')).toBe(true);
    expect(phone.looksValid('123')).toBe(false);
    expect(phone.nationalDigits('(020) 7946-0958')).toBe('02079460958');
  });
});

describe('wizard — two invented groups and a party of two', () => {
  it('caps step 1 at the configured party size', () => {
    expect(wizard.maxPeople).toBe(2);
    const three = wizard.reduce(wizard.initialState(), {
      type: 'choosePeople',
      people: [{ key: 'guest:1' }, { key: 'guest:2' }, { key: 'guest:3' }],
    });
    expect(three.error).toBe('maxParty');
  });

  it('prices a Saturday with the service’s own surcharge on the studio’s calendar', () => {
    const saturday = london('2026-10-24T00:30:00+01:00');
    expect(wizard.itemPriceOre(KIDS_CUT, saturday)).toBe(1500);
    expect(wizard.itemPriceOre(KIDS_CUT, london('2026-10-23T23:30:00+01:00'))).toBe(1250);
  });

  it('says the summary in English, in pounds', () => {
    const state = wizard.reduce(wizard.initialState(), { type: 'pickService', service: ADULT_CUT });
    const picked = wizard.reduce(state, {
      type: 'pickSlot',
      startTs: london('2026-10-08T14:15:00+01:00'),
      resourceId: null,
    });
    expect(wizard.summaryLine(picked, () => null, london('2026-10-08T09:00:00+01:00'))).toBe(
      'Adult cut · First available · today 14:15 · £30'
    );
    expect(wizard.summaryLine(state, () => null)).toBe(
      'Adult cut · First available · Pick a time · £30'
    );
  });

  it('names a party’s seats and its basket with the English words', () => {
    const guests = wizard.reduce(wizard.initialState(), {
      type: 'choosePeople',
      people: [{ key: 'guest:1' }, { key: 'self', adult: true }],
    });
    expect(wizard.summaryLine(guests, () => null)).toBe('1 children, Me');
    const family = wizard.applyPrefill(
      wizard.initialState(),
      { serviceId: KIDS_CUT.id, party: 2 },
      { services: [KIDS_CUT], resources: [] }
    );
    expect(family.items).toHaveLength(2);
    expect(wizard.summaryLine(family, () => null)).toBe('2 services · 60 min in total · £25');
  });

  it('treats the configured child group as the kids’ path, and nothing else', () => {
    const adults = wizard.applyPrefill(
      wizard.initialState(),
      { serviceId: ADULT_CUT.id, party: 2 },
      { services: [ADULT_CUT], resources: [] }
    );
    expect(adults.items).toHaveLength(1);
    const held = wizard.reduce(wizard.initialState(), { type: 'holdService', service: KIDS_CUT });
    const seated = wizard.reduce(held, {
      type: 'choosePeople',
      people: [{ key: 'guest:1' }, { key: 'self', adult: true }],
    });
    expect(seated.choices).toEqual([KIDS_CUT, null]);
  });
});

describe('party slots — grouped by the studio’s day', () => {
  it('finds the parallel rescue on the London day, not the viewer’s', () => {
    const { partyAlternative } = createPartySlots(SECOND_CONFIG);
    const late = london('2026-10-08T23:30:00+01:00');
    const slot = { startTs: late, mode: 'parallel' as const, seats: [] };
    expect(partyAlternative({ sequential: [], parallel: [slot], dayTs: late - 3_600_000 })).toBe(
      slot
    );
  });
});

describe('links, paths and storage', () => {
  const links = createDeepLinks(SECOND_CONFIG);

  it('reads the English keys and values', () => {
    expect(links.parseCategory('KIDS')).toBe('kids');
    expect(links.parseCategory('barn')).toBeNull();
    expect(links.parseWho('grown-up')).toBe('grown-up');
    expect(links.parseWho('voksen')).toBeNull();
    expect(links.impliedParty(new URLSearchParams('category=kids'))).toEqual({ children: 1 });
    expect(links.impliedParty(new URLSearchParams('for=grown-up'))).toEqual({ adult: true });
    expect(links.impliedParty(new URLSearchParams('category=adults'))).toBeNull();
    expect(links.hasDeepLink(new URLSearchParams('with=sara'))).toBe(true);
    expect(links.hasDeepLink(new URLSearchParams('frisor=sara'))).toBe(false);
    expect(links.resumePath(new URLSearchParams('category=kids&party=2&kategori=barn'))).toBe(
      '/book?resume=1&category=kids&party=2'
    );
  });

  it('builds this site’s manage, portal and avatar paths', () => {
    const paths = createPaths(SECOND_CONFIG);
    expect(paths.managePath('a/b')).toBe('/book/manage/a%2Fb');
    expect(paths.isManagePath('/en-GB/book/manage/x')).toBe(true);
    expect(paths.isManagePath('/bestill/administrer/x')).toBe(false);
    expect(paths.isPortalPath('/account/sign-in')).toBe(true);
    expect(createDto(SECOND_CONFIG).avatarPath('res-1')).toBe('/api/book/avatar/res-1');
  });

  it('lets a login return only to this site’s booking page', () => {
    const safe = createReturnPath(SECOND_CONFIG);
    expect(safe('/book?resume=1')).toBe('/book?resume=1');
    expect(safe('/bestill')).toBeNull();
    expect(safe('/book/manage/token')).toBeNull();
  });

  it('derives the portal cookie names from the session cookie', () => {
    expect(SECOND_CONFIG.portal).toMatchObject({
      cookieName: 'booking_portal',
      nextCookieName: 'booking_portal_next',
      vippsBindingCookieName: '__Host-booking_portal_vipps_bind',
      vippsLinkCookieName: 'booking_portal_vipps_link',
    });
    expect(createSessionCookie(SECOND_CONFIG)).toMatchObject({
      PORTAL_SESSION_COOKIE: 'booking_portal',
      PORTAL_DASHBOARD_PATH: '/account',
      PORTAL_LOGIN_PATH: '/account/sign-in',
    });
  });

  it('namespaces every storage key', () => {
    const stores = createStores(SECOND_CONFIG.storageNamespace);
    expect(stores.DRAFT_STORAGE_KEY).toBe('studio:booking:draft');
    expect(stores.ATTEMPT_STORAGE_KEY).toBe('studio:booking:attempt');
  });

  it('stamps the calendar file with this site’s product id', () => {
    const ics = createIcs(SECOND_CONFIG).buildIcs({
      uid: 'bk-1@studio.example',
      startTs: 0,
      endTs: 1,
      summary: 'Kids cut',
      stampTs: 0,
    });
    expect(ics).toContain('PRODID:-//Studio Example//Booking//EN\r\n');
  });
});

describe('age — English words, a plain adult equivalent', () => {
  const age = createAge(SECOND_CONFIG);

  it('labels an age in the locale’s pack', () => {
    expect(age.ageLabel({ min: 7, max: 7 })).toBe('7 yrs');
    expect(age.ageLabel({ min: 7, max: 8 })).toBe('7–8 yrs');
  });

  it('grows every kids’ service into the one adult service that fits', () => {
    const kids = { id: 'k', name: 'Kids cut', category: 'kids', ageMaxYears: 12 };
    const adult = { id: 'a', name: 'Adult cut', category: 'adults', ageMinYears: 13 };
    expect(age.grownUpEquivalent(kids, [kids, adult], { min: 13, max: 13 })).toBe(adult);
  });
});
