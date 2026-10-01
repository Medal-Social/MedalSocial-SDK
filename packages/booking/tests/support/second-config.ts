/**
 * A second site, as unlike the parity fixture as a config can make it:
 * another zone and DST calendar, an English locale, a currency with minor
 * units, two invented groups instead of six Norwegian ones, English query keys
 * and paths. If a Norwegian assumption survived the parameterisation, a test
 * against this config finds it.
 */

import { resolveBookingConfig } from '../../src/core/config';

export const SECOND_CONFIG = resolveBookingConfig({
  timeZone: 'Europe/London',
  locale: 'en-GB',
  currency: 'GBP',
  phone: { country: 'GB' },
  paths: {
    booking: '/book',
    manage: '/book/manage',
    portal: '/account',
    portalLogin: '/account/sign-in',
    api: '/api/book',
    portalApi: '/api/account',
    avatar: '/api/book/avatar',
  },
  query: {
    category: 'category',
    service: 'service',
    stylist: 'with',
    party: 'party',
    who: 'for',
    time: 'at',
    resume: 'resume',
    rebookService: 'again',
    rebookStylist: 'again-with',
  },
  whoValues: { child: 'kid', adult: 'grown-up' },
  categories: [
    { key: 'kids', audience: 'child', adultEquivalent: 'adults' },
    { key: 'adults', audience: 'adult' },
  ],
  fallbackCategory: 'adults',
  party: { maxPeople: 2 },
  window: { rangeDays: 5, prefetchCategory: 'kids' },
  dayparts: [
    { key: 'morning', from: 0, to: 12 },
    { key: 'afternoon', from: 12, to: 18 },
    { key: 'evening', from: 18, to: 24 },
  ],
  contact: { phone: '020 7946 0958', address: '1 High Street', name: 'Studio Example' },
  storageNamespace: 'studio',
  ics: { prodId: '-//Studio Example//Booking//EN', uidDomain: 'studio.example' },
});
