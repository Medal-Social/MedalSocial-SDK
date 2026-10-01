/**
 * What a marketing link can ask `/bestill` for, and how the page and the wizard
 * read it — one place, so the server's prefetch and the client's first render
 * cannot disagree about which service `?tjeneste=farge-dame` means.
 *
 * `?kategori=barn`   opens that category on step 1
 * `?tjeneste=<id|slug>` picks the service (and advances, like a tap)
 * `?frisor=<id|navn>`   picks the stylist, when they can do the service
 * `?antall=2`           the party size (children, for a kids' service)
 * `?hvem=barn|voksen`   who is being cut, answering step 1 («Hvem skal klippes?»)
 *
 * A link that says who is coming skips step 1: `?kategori=barn` is one child
 * unless `?antall=` says more, `?hvem=voksen` is one grown-up. Step 1 is one
 * «Tilbake» away for the parent who meant something else.
 *
 * Every value is untrusted: an unknown one is ignored, never an error, because
 * the link may be a year old and there is nothing a parent could do about it.
 *
 * The key names above are the defaults; a site renames them through
 * `config.query`, the `?hvem=` values through `config.whoValues`, the
 * categories through `config.categories` and the page through `paths.booking`.
 * `createDeepLinks(config)` binds the ones that read any of those.
 */
import { isChildCategory } from './categories';
import type { BookingConfig } from './config';
import { stylistDisplayName } from './display-name';

type DeepLinkConfig = Pick<
  BookingConfig,
  'query' | 'whoValues' | 'categories' | 'fallbackCategory' | 'paths'
>;

/** `Farge dame` → `farge-dame`, `Bjarne (Salong Demo)` → `bjarne`. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** The slug form of a stylist's name, as a «Bestill hos …» link writes it. */
export function stylistSlug(name: string): string {
  return slugify(stylistDisplayName(name));
}

/** Whether `wanted` names this service, by id or by name slug. */
export function serviceMatches(service: { id: string; name: string }, wanted: string): boolean {
  const value = wanted.trim().toLowerCase();
  return value !== '' && (service.id.toLowerCase() === value || slugify(service.name) === value);
}

/** Whether `wanted` names this stylist: id, display name (any case) or its slug. */
export function resourceMatches(resource: { id: string; name?: string }, wanted: string): boolean {
  const value = wanted.trim().toLowerCase();
  if (value === '') return false;
  if (resource.id.toLowerCase() === value) return true;
  if (!resource.name) return false;
  const display = stylistDisplayName(resource.name).toLowerCase();
  return display === value || slugify(display) === slugify(value);
}

/** `?kategori=` as a category the wizard has, or `null`. */
function parseCategory(config: DeepLinkConfig, value: string | null | undefined): string | null {
  const wanted = value?.trim().toLowerCase();
  return config.categories.some((category) => category.key === wanted) ? (wanted as string) : null;
}

/** `?hvem=` as the answer to step 1, or `null`. */
function parseWho(config: DeepLinkConfig, value: string | null | undefined): string | null {
  const wanted = value?.trim().toLowerCase();
  return wanted === config.whoValues.child || wanted === config.whoValues.adult ? wanted : null;
}

/**
 * Who a link has already answered step 1 with: `n` children, one grown-up, or
 * nothing. `?antall=` wins; otherwise the kids' menu (`?kategori=barn`) or
 * `?hvem=barn` is one child — the common visit, and the one the home page's
 * «Bestill for barn» card means — and `?hvem=voksen` is one adult.
 */
function impliedParty(
  config: DeepLinkConfig,
  query: URLSearchParams | null
): { children: number } | { adult: true } | null {
  const party = parseParty(query?.get(config.query.party));
  if (party !== null) return { children: party };
  const who = parseWho(config, query?.get(config.query.who));
  if (who === config.whoValues.adult) return { adult: true };
  const category = parseCategory(config, query?.get(config.query.category));
  if (who === config.whoValues.child || (category !== null && isChildCategory(config, category))) {
    return { children: 1 };
  }
  return null;
}

/** `?antall=` as a whole number ≥ 1, or `null` for anything else. Not yet
 * clamped to a service: the limit is the service's, and unknown here. */
export function parseParty(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,3}$/.test(value.trim())) return null;
  const count = Number.parseInt(value, 10);
  return count >= 1 ? count : null;
}

/** The `?…` a card appends, or the base untouched when it cannot be extended. */
export function withBookingQuery(base: string, query: string | undefined): string {
  if (!query || base.includes('?') || base.includes('#') || /^https?:\/\//i.test(base)) return base;
  return `${base}?${query}`;
}

/**
 * The parameters that make a visit a DEEP-LINKED one, whatever else is in the
 * address. `?service=` / `?stylist=` («Bestill igjen») are read by the
 * wizard's own prefill; these are the marketing pages' words.
 */
function deepLinkKeys(config: DeepLinkConfig): string[] {
  const { category, stylist, party, service, who } = config.query;
  return [category, stylist, party, service, who];
}

/**
 * Whether the address asks the wizard for anything — a category, a service, a
 * stylist or a party size — even something a stale catalogue can no longer
 * honour. The restore gate and the mount effect both ask it, so an old
 * confirmation this tab still remembers never swallows a link the parent has
 * just followed: they came to book, and «Bestill ny time» would throw the link
 * away.
 */
function hasDeepLink(config: DeepLinkConfig, query: URLSearchParams | null): boolean {
  return deepLinkKeys(config).some((key) => (query?.get(key)?.trim() ?? '') !== '');
}

/** The parts of a deep link that still mean something after a Vipps round
 * trip. `tjeneste` is not one: the service is in the draft by then, or was
 * never chosen. */
function resumableKeys(config: DeepLinkConfig): string[] {
  const { category, stylist, party, who } = config.query;
  return [category, stylist, party, who];
}

/** Long enough for any stylist slug; short enough that three of them keep the
 * path well inside `safeReturnPath`'s 512 characters. */
const RESUMABLE_VALUE_MAX = 64;

/**
 * Where a Vipps login started from the wizard comes back to:
 * `/bestill?resume=1`, plus whichever of `kategori`, `frisor` and `antall`
 * this visit arrived with.
 *
 * The draft carries the answers the parent GAVE; this carries what the link
 * asked for and they have not answered yet — a parent who opened «Bestill hos
 * Siv» on step 1 and logged in before tapping a service should come back to
 * Siv, not to a plain wizard. The path passes `safeReturnPath` (an exact
 * `/bestill` with its query kept), and nothing in it is personal.
 */
function resumePath(config: DeepLinkConfig, query: URLSearchParams | null): string {
  const out = new URLSearchParams({ [config.query.resume]: '1' });
  for (const key of resumableKeys(config)) {
    const value = query?.get(key)?.trim();
    if (value && value.length <= RESUMABLE_VALUE_MAX) out.set(key, value);
  }
  return `${config.paths.booking}?${out.toString()}`;
}

export interface DeepLinks {
  /** `?kategori=` as a configured category key, or `null`. */
  parseCategory(value: string | null | undefined): string | null;
  /** `?hvem=` as one of `config.whoValues`, or `null`. */
  parseWho(value: string | null | undefined): string | null;
  parseParty: typeof parseParty;
  impliedParty(query: URLSearchParams | null): { children: number } | { adult: true } | null;
  hasDeepLink(query: URLSearchParams | null): boolean;
  resumePath(query: URLSearchParams | null): string;
}

/** The link readers for this site's query keys, categories and booking path. */
export function createDeepLinks(config: DeepLinkConfig): DeepLinks {
  return {
    parseCategory: (value) => parseCategory(config, value),
    parseWho: (value) => parseWho(config, value),
    parseParty,
    impliedParty: (query) => impliedParty(config, query),
    hasDeepLink: (query) => hasDeepLink(config, query),
    resumePath: (query) => resumePath(config, query),
  };
}
