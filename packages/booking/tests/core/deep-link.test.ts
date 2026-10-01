import { describe, expect, it } from 'vitest';
import {
  createDeepLinks,
  parseParty,
  resourceMatches,
  serviceMatches,
  slugify,
  stylistSlug,
  withBookingQuery,
} from '../../src/core/deep-link';
import { createReturnPath } from '../../src/core/portal/return-path';
import { PARITY_CONFIG } from '../support/parity-config';

const { hasDeepLink, impliedParty, parseCategory, parseWho, resumePath } =
  createDeepLinks(PARITY_CONFIG);
const safeReturnPath = createReturnPath(PARITY_CONFIG);

describe('deep-link parsing', () => {
  it('slugifies names the way the links write them', () => {
    expect(slugify('Farge dame')).toBe('farge-dame');
    expect(stylistSlug('Bjarne (Salong Demo)')).toBe('bjarne');
    expect(stylistSlug('siv')).toBe('siv');
  });

  it('matches a service by id or slug, and nothing for blank', () => {
    const service = { id: 'Svc-1', name: 'Farge dame' };
    expect(serviceMatches(service, 'svc-1')).toBe(true);
    expect(serviceMatches(service, 'farge-dame')).toBe(true);
    expect(serviceMatches(service, ' ')).toBe(false);
    expect(serviceMatches(service, 'herre')).toBe(false);
  });

  it('matches a stylist by id, display name or slug', () => {
    const resource = { id: 'r1', name: 'bjarne (Salong Demo)' };
    for (const wanted of ['r1', 'Bjarne', 'BJARNE', 'bjarne']) {
      expect(resourceMatches(resource, wanted)).toBe(true);
    }
    expect(resourceMatches(resource, 'siv')).toBe(false);
  });

  it('accepts only known categories', () => {
    expect(parseCategory('barn')).toBe('barn');
    expect(parseCategory('DAME')).toBe('dame');
    expect(parseCategory('zzz')).toBeNull();
    expect(parseCategory(null)).toBeNull();
  });

  it('accepts only whole numbers of at least one as a party size', () => {
    expect(parseParty('2')).toBe(2);
    for (const bad of ['0', '-1', '1.5', 'to', '', null, undefined, '99999']) {
      expect(parseParty(bad)).toBeNull();
    }
  });

  it('appends a query to an internal path only', () => {
    expect(withBookingQuery('/bestill', 'kategori=barn')).toBe('/bestill?kategori=barn');
    expect(withBookingQuery('/bestill', '')).toBe('/bestill');
    expect(withBookingQuery('https://x.example/', 'a=b')).toBe('https://x.example/');
    expect(withBookingQuery('/bestill?x=1', 'a=b')).toBe('/bestill?x=1');
  });
});

describe('hasDeepLink', () => {
  it.each(['kategori=barn', 'tjeneste=x', 'frisor=sara', 'antall=2'])(
    'counts %s as a link',
    (search) => {
      expect(hasDeepLink(new URLSearchParams(search))).toBe(true);
    }
  );

  it('counts nothing else, and not an empty value', () => {
    expect(hasDeepLink(new URLSearchParams(''))).toBe(false);
    expect(hasDeepLink(new URLSearchParams('resume=1&utm_source=x'))).toBe(false);
    expect(hasDeepLink(new URLSearchParams('kategori=&frisor=%20'))).toBe(false);
    expect(hasDeepLink(null)).toBe(false);
  });
});

/**
 * A Vipps login from the wizard's first screen is a whole navigation away and
 * back. What the link asked for and the parent has not answered yet must come
 * back with them — and the path has to survive `safeReturnPath`, which is what
 * the portal's `next` cookie is checked with.
 */
describe('resumePath', () => {
  it('is the plain marker without a link', () => {
    expect(resumePath(null)).toBe('/bestill?resume=1');
    expect(resumePath(new URLSearchParams('utm_source=x'))).toBe('/bestill?resume=1');
  });

  it('carries kategori, frisor and antall — and not tjeneste', () => {
    const path = resumePath(
      new URLSearchParams('kategori=barn&frisor=siv&antall=2&tjeneste=gutteklipp&who=Jonas')
    );

    expect(path).toBe('/bestill?resume=1&kategori=barn&frisor=siv&antall=2');
    expect(safeReturnPath(path)).toBe(path);
  });

  it('drops a value too long to be a real one, so the path stays returnable', () => {
    const path = resumePath(new URLSearchParams(`frisor=${'x'.repeat(200)}&kategori=barn`));

    expect(path).toBe('/bestill?resume=1&kategori=barn');
    expect(safeReturnPath(path)).toBe(path);
  });
});

describe('who a link has already answered step 1 with', () => {
  const q = (search: string) => new URLSearchParams(search);

  it('reads ?hvem= as barn or voksen, and nothing else', () => {
    expect(parseWho('barn')).toBe('barn');
    expect(parseWho(' VOKSEN ')).toBe('voksen');
    expect(parseWho('hund')).toBeNull();
    expect(parseWho(null)).toBeNull();
  });

  it('seats one child for the kids’ menu, unless ?antall= says more', () => {
    expect(impliedParty(q('kategori=barn'))).toEqual({ children: 1 });
    expect(impliedParty(q('hvem=barn'))).toEqual({ children: 1 });
    expect(impliedParty(q('kategori=barn&antall=2'))).toEqual({ children: 2 });
    expect(impliedParty(q('antall=3'))).toEqual({ children: 3 });
  });

  it('seats one grown-up for ?hvem=voksen', () => {
    expect(impliedParty(q('hvem=voksen'))).toEqual({ adult: true });
  });

  it('answers nothing for a link that does not say who is coming', () => {
    expect(impliedParty(q(''))).toBeNull();
    expect(impliedParty(q('kategori=dame'))).toBeNull();
    expect(impliedParty(q('frisor=siv'))).toBeNull();
    expect(impliedParty(null)).toBeNull();
  });

  it('counts ?hvem= as a deep link and carries it through a Vipps round trip', () => {
    expect(hasDeepLink(q('hvem=voksen'))).toBe(true);
    expect(resumePath(q('hvem=voksen'))).toBe('/bestill?resume=1&hvem=voksen');
  });
});
