/**
 * The parity fixture: the values the first site on this package runs with
 * today, so the tests that moved here with the code run against exactly the
 * configuration they were written for. (The plan's name for it names the
 * customer; this public repository does not.)
 *
 * Values only — no customer name, copy or URL. Where the real value would
 * name the business (the portal cookie names, the storage namespace, the ICS
 * product id, the consent sentence) it is replaced by a neutral stand-in, and
 * parity for those few is proven by the site's own suite when it moves onto
 * the package.
 */

import { resolveBookingConfig } from '../../src/core/config';

export const PARITY_CONFIG = resolveBookingConfig({
  timeZone: 'Europe/Oslo',
  locale: 'nb-NO',
  currency: 'NOK',
  phone: { country: 'NO', validate: 'strict' },
  paths: {
    booking: '/bestill',
    manage: '/bestill/administrer',
    portal: '/min-side',
    portalLogin: '/min-side/logg-inn',
    api: '/api/booking',
    portalApi: '/api/portal',
    avatar: '/api/booking/avatar',
  },
  query: {
    category: 'kategori',
    service: 'tjeneste',
    stylist: 'frisor',
    party: 'antall',
    who: 'hvem',
    time: 'tid',
    resume: 'resume',
    rebookService: 'service',
    rebookStylist: 'stylist',
  },
  whoValues: { child: 'barn', adult: 'voksen' },
  categories: [
    {
      key: 'barn',
      audience: 'child',
      adultEquivalent: [
        { nameIncludes: 'gutt', category: 'herre' },
        { nameIncludes: 'jente', category: 'dame' },
      ],
    },
    { key: 'dame', audience: 'adult' },
    { key: 'herre', audience: 'adult' },
    { key: 'farge', audience: 'any' },
    { key: 'foliestriper', audience: 'any' },
    { key: 'annet', audience: 'any' },
  ],
  fallbackCategory: 'annet',
  party: { maxPeople: 3, allowParallel: true, askWhoFirst: true, maxServicesPerPerson: 1 },
  window: { rangeDays: 7, prefetchLimit: 4, prefetchCategory: 'barn' },
  dayparts: [
    { key: 'formiddag', from: 0, to: 12 },
    { key: 'ettermiddag', from: 12, to: 17 },
    { key: 'kveld', from: 17, to: 24 },
  ],
  handoffUrl: null,
  contact: { phone: '22 33 44 55', address: 'Torget 1, 0001 Oslo', name: 'Salong Demo' },
  portal: {
    enabled: true,
    methods: ['email_code', 'vipps'],
    // Stand-ins: the real names carry the business's initials.
    cookieName: 'demo_portal',
    nextCookieName: 'demo_portal_next',
    vippsBindingCookieName: '__Host-demo_vipps_bind',
    vippsLinkCookieName: 'demo_vipps_link',
    returnPaths: { exact: ['/bestill'], prefixes: ['/barnehage/'] },
  },
  consent: {
    termsUrl: '/vilkar',
    marketing: {
      text: 'Minn meg på når det er på tide med ny klipp, og send meg tilbud fra Salong Demo.',
      version: 'demo-booking-2026-08',
    },
  },
  storageNamespace: 'demo',
  ics: { prodId: '-//Salong Demo//Booking//NO', uidDomain: 'booking.demo.invalid' },
  monitoring: { enabled: true, sampleRate: 1 },
});

/** The parity fixture with the multi-select service step on: up to 3 services a person. */
export const MULTI_SERVICE_CONFIG = {
  ...PARITY_CONFIG,
  party: { ...PARITY_CONFIG.party, maxServicesPerPerson: 3 },
};
