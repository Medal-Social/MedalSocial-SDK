/**
 * What a site tells the booking package about itself.
 *
 * `BookingConfig` is CLIENT-SAFE by construction: it is serialised into the
 * page as a prop, so it never holds a key, a session secret or a cache handle.
 * Those live in `BookingServerOptions`, which only `/next` knows (P4).
 *
 * The package reads no environment variable and no CMS. A site resolves its
 * own switches (a handoff URL, whether accounts are on, the contact block) and
 * passes the answers in.
 *
 * Every field but `timeZone` has a default. `resolveBookingConfig` fills them,
 * validates the whole object with zod and freezes it, so a config that reached
 * a factory is one that passed.
 */

import { z } from 'zod';
import type { BookingLabels } from './labels';

/** A service group, in display order. Medal's free-string `category` maps onto `key`. */
export interface BookingCategory {
  key: string;
  /** Who the group is for. `child` is the kids' path: guest children, `?antall=`, the held link service. */
  audience: 'child' | 'adult' | 'any';
  /**
   * For a child's group: which adult group a service «grows up» into once the
   * child has outgrown the kids' menu. A plain key maps every service in the
   * group; a list maps by a word in the service name, first match wins
   * (`{ nameIncludes: 'gutt', category: 'herre' }`). Case-insensitive.
   */
  adultEquivalent?: string | ReadonlyArray<{ nameIncludes: string; category: string }>;
}

/** A named part of the day on the business's clock, in local hours `[from, to)`. */
export interface BookingDaypart {
  key: string;
  from: number;
  to: number;
}

export interface BookingConfig {
  /** IANA zone the business keeps its hours in. Required. */
  timeZone: string;
  /** BCP-47, for every `Intl` formatter and the label pack. */
  locale: string;
  /** ISO 4217. Amounts stay in minor units (øre, pence) on the wire. */
  currency: string;
  /** `NO` is the only strict rule set in 0.x; every other country is `loose`. */
  phone: { country: string; validate: 'strict' | 'loose' };
  /** URLs this site serves. */
  paths: {
    booking: string;
    /** Prefix of the manage page; the token is the next segment. */
    manage: string;
    /** `null` = no customer portal. */
    portal: string | null;
    portalLogin: string;
    api: string;
    portalApi: string;
    avatar: string;
  };
  /**
   * The query keys a link may carry into the booking page.
   *
   * `category`, `service`, `stylist`, `party` and `who` are the marketing
   * deep-link keys; `rebookService` / `rebookStylist` are the portal's «book
   * again» link, read by the wizard's own prefill; `resume` marks a return
   * from an external login; `time` is reserved for a pre-picked start.
   */
  query: {
    category: string;
    service: string;
    stylist: string;
    party: string;
    who: string;
    time: string;
    resume: string;
    rebookService: string;
    rebookStylist: string;
  };
  /** The values `query.who` accepts. */
  whoValues: { child: string; adult: string };
  /** Service groups, in display order. */
  categories: BookingCategory[];
  /** Where an unknown Medal category lands. Must be one of `categories`. */
  fallbackCategory: string;
  /** Step 1's rules. */
  party: { maxPeople: number; allowParallel: boolean; askWhoFirst: boolean };
  /** The bookable window and the page's prefetch. */
  window: { rangeDays: number; prefetchLimit: number; prefetchCategory: string | null };
  /** Named day parts for the time step, contiguous from 0 to 24. */
  dayparts: BookingDaypart[];
  /** Set = the booking path hands off (307) to this URL instead of rendering. */
  handoffUrl: string | null;
  /** The business's own contact, for «call us» and the unavailable screen. */
  contact: { phone: string | null; address: string | null; name: string };
  portal: {
    enabled: boolean;
    methods: Array<'email_code' | 'vipps'>;
    /** The session cookie. */
    cookieName: string;
    /** Where a login that left the site (Vipps) returns to; read once. */
    nextCookieName: string;
    /** Must be `__Host-`-prefixed: Secure, `Path=/`, no `Domain`. */
    vippsBindingCookieName: string;
    vippsLinkCookieName: string;
    /**
     * Where a finished login may send the visitor. `exact` matches the
     * pathname only (the booking page, so a deeper manage URL never
     * qualifies); `prefixes` matches anything below.
     */
    returnPaths: { exact: string[]; prefixes: string[] };
  };
  consent: {
    termsUrl: string | null;
    /** `null` = no marketing box. */
    marketing: { text: string; version: string } | null;
  };
  /** Namespaces browser storage keys: `<ns>:booking:draft`, … */
  storageNamespace: string;
  /**
   * `prodId` stamps every calendar file. `uidDomain` is for UIDs the package
   * mints itself (`/react`, 0.1.0); a booking id passed in as `uid` is used as
   * is, so a calendar entry made before a site moved onto the package is still
   * the same entry after it.
   */
  ics: { prodId: string; uidDomain: string };
  monitoring: { enabled: boolean; sampleRate: number };
  /** Copy, merged over the built-in pack for `locale`. */
  labels?: Partial<BookingLabels>;
}

type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** What a site passes: `timeZone`, and whatever it wants to change. */
export type BookingConfigInput = { timeZone: string } & DeepPartial<
  Omit<BookingConfig, 'timeZone'>
>;

const DEFAULT_PATHS: BookingConfig['paths'] = {
  booking: '/bestill',
  manage: '/bestill/administrer',
  portal: '/min-side',
  portalLogin: '/min-side/logg-inn',
  api: '/api/booking',
  portalApi: '/api/portal',
  avatar: '/api/booking/avatar',
};

/** Everything but `timeZone` (required) and the portal cookie names (derived). */
function defaults(): Omit<BookingConfig, 'timeZone' | 'portal'> & {
  portal: Omit<
    BookingConfig['portal'],
    'nextCookieName' | 'vippsBindingCookieName' | 'vippsLinkCookieName' | 'returnPaths'
  >;
} {
  return {
    locale: 'nb-NO',
    currency: 'NOK',
    phone: { country: 'NO', validate: 'strict' },
    paths: { ...DEFAULT_PATHS },
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
      { key: 'barn', audience: 'child' },
      { key: 'annet', audience: 'any' },
    ],
    fallbackCategory: 'annet',
    party: { maxPeople: 3, allowParallel: true, askWhoFirst: true },
    window: { rangeDays: 7, prefetchLimit: 4, prefetchCategory: null },
    dayparts: [
      { key: 'formiddag', from: 0, to: 12 },
      { key: 'ettermiddag', from: 12, to: 17 },
      { key: 'kveld', from: 17, to: 24 },
    ],
    handoffUrl: null,
    contact: { phone: null, address: null, name: '' },
    portal: { enabled: false, methods: ['email_code'], cookieName: 'booking_portal' },
    consent: { termsUrl: null, marketing: null },
    storageNamespace: 'medal',
    ics: { prodId: '-//Medal Social//Booking//EN', uidDomain: 'booking.invalid' },
    monitoring: { enabled: true, sampleRate: 1 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Objects merge key by key; arrays, scalars and `null` replace. Only
 * `undefined` keeps the default — `paths.portal: null` means «no portal».
 */
function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (!isRecord(base) || !isRecord(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = merge(base[key], value);
  return out;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

const path = z.string().regex(/^\/[^\s?#]*$/, 'must be a root-relative path');
const key = z.string().regex(/^[\w-]{1,64}$/, 'must be 1–64 word characters');
/** Group keys and `?hvem=` values are matched against a lower-cased query value. */
const lowerKey = z.string().regex(/^[a-z0-9_-]{1,64}$/, 'must be 1–64 lower-case word characters');
/** A prefix must end at a segment boundary, or `/flow` would also admit `/flow-evil`. */
const prefix = path.refine((value) => value.endsWith('/'), 'a prefix must end with /');
/** RFC 6265 token characters, which is every name a browser keeps intact. */
const cookieName = z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/);

const schema = z
  .object({
    timeZone: z.string().refine(validTimeZone, 'must be an IANA time zone'),
    locale: z.string().refine(validLocale, 'must be a BCP-47 locale'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code'),
    phone: z.object({
      country: z.string().regex(/^[A-Z]{2}$/),
      validate: z.enum(['strict', 'loose']),
    }),
    paths: z.object({
      booking: path,
      manage: path,
      portal: path.nullable(),
      portalLogin: path,
      api: path,
      portalApi: path,
      avatar: path,
    }),
    query: z.object({
      category: key,
      service: key,
      stylist: key,
      party: key,
      who: key,
      time: key,
      resume: key,
      rebookService: key,
      rebookStylist: key,
    }),
    whoValues: z.object({ child: lowerKey, adult: lowerKey }),
    categories: z
      .array(
        z.object({
          key: lowerKey,
          audience: z.enum(['child', 'adult', 'any']),
          adultEquivalent: z
            .union([
              lowerKey,
              z.array(z.object({ nameIncludes: z.string().min(1), category: lowerKey })),
            ])
            .optional(),
        })
      )
      .min(1),
    fallbackCategory: lowerKey,
    party: z.object({
      maxPeople: z.number().int().min(1).max(20),
      allowParallel: z.boolean(),
      askWhoFirst: z.boolean(),
    }),
    window: z.object({
      rangeDays: z.number().int().min(1).max(62),
      prefetchLimit: z.number().int().min(0).max(20),
      prefetchCategory: lowerKey.nullable(),
    }),
    dayparts: z
      .array(
        z.object({
          key,
          from: z.number().int().min(0).max(23),
          to: z.number().int().min(1).max(24),
        })
      )
      .min(1),
    handoffUrl: z.url({ protocol: /^https?$/ }).nullable(),
    contact: z.object({
      phone: z.string().nullable(),
      address: z.string().nullable(),
      name: z.string(),
    }),
    portal: z.object({
      enabled: z.boolean(),
      methods: z.array(z.enum(['email_code', 'vipps'])),
      cookieName,
      nextCookieName: cookieName,
      vippsBindingCookieName: cookieName.refine(
        (name) => name.startsWith('__Host-'),
        'must carry the __Host- prefix'
      ),
      vippsLinkCookieName: cookieName,
      returnPaths: z.object({ exact: z.array(path), prefixes: z.array(prefix) }),
    }),
    consent: z.object({
      termsUrl: z.string().min(1).nullable(),
      marketing: z.object({ text: z.string().min(1), version: z.string().min(1) }).nullable(),
    }),
    storageNamespace: key,
    ics: z.object({ prodId: z.string().regex(/^-\/\/.+\/\/.+$/), uidDomain: z.string().min(1) }),
    monitoring: z.object({ enabled: z.boolean(), sampleRate: z.number().min(0).max(1) }),
    labels: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((config, ctx) => {
    const keys = config.categories.map((category) => category.key);
    const known = new Set(keys);
    if (known.size !== keys.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['categories'],
        message: 'category keys must be unique',
      });
    }
    if (!known.has(config.fallbackCategory)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fallbackCategory'],
        message: 'must be one of the categories',
      });
    }
    if (config.window.prefetchCategory !== null && !known.has(config.window.prefetchCategory)) {
      ctx.addIssue({
        code: 'custom',
        path: ['window', 'prefetchCategory'],
        message: 'must be one of the categories',
      });
    }
    config.categories.forEach((category, index) => {
      const targets =
        category.adultEquivalent === undefined
          ? []
          : typeof category.adultEquivalent === 'string'
            ? [category.adultEquivalent]
            : category.adultEquivalent.map((rule) => rule.category);
      for (const target of targets) {
        if (!known.has(target)) {
          ctx.addIssue({
            code: 'custom',
            path: ['categories', index, 'adultEquivalent'],
            message: `«${target}» is not one of the categories`,
          });
        }
      }
    });
    // Contiguous and covering the whole day, so every hour has exactly one part.
    let hour = 0;
    config.dayparts.forEach((part, index) => {
      if (part.from !== hour || part.to <= part.from) {
        ctx.addIssue({
          code: 'custom',
          path: ['dayparts', index],
          message: 'dayparts must run contiguously from 0 to 24',
        });
      }
      hour = part.to;
    });
    if (hour !== 24) {
      ctx.addIssue({ code: 'custom', path: ['dayparts'], message: 'dayparts must end at 24' });
    }
    if (config.portal.methods.length === 0 && config.portal.enabled) {
      ctx.addIssue({
        code: 'custom',
        path: ['portal', 'methods'],
        message: 'an enabled portal needs a login method',
      });
    }
  });

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Thrown with zod's issue list when a config does not validate. */
export class BookingConfigError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    super(
      `Invalid booking config:\n${issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`
    );
    this.name = 'BookingConfigError';
    this.issues = issues;
  }
}

/**
 * The site's partial config with every default filled, validated and frozen.
 *
 * The portal's three secondary cookie names derive from `cookieName` unless
 * set, and a login may return to the booking page unless `returnPaths` says
 * otherwise. Idempotent: a resolved config resolves to an equal one.
 */
export function resolveBookingConfig(input: BookingConfigInput): Readonly<BookingConfig> {
  const merged = merge(defaults(), input) as Omit<BookingConfig, 'portal'> & {
    portal: Partial<BookingConfig['portal']> & Pick<BookingConfig['portal'], 'cookieName'>;
  };
  const session = merged.portal.cookieName;
  const candidate = {
    ...merged,
    portal: {
      ...merged.portal,
      nextCookieName: merged.portal.nextCookieName ?? `${session}_next`,
      vippsBindingCookieName:
        merged.portal.vippsBindingCookieName ?? `__Host-${session}_vipps_bind`,
      vippsLinkCookieName: merged.portal.vippsLinkCookieName ?? `${session}_vipps_link`,
      returnPaths: {
        exact: merged.portal.returnPaths?.exact ?? [merged.paths.booking],
        prefixes: merged.portal.returnPaths?.prefixes ?? [],
      },
    },
  };
  const result = schema.safeParse(candidate);
  if (!result.success) {
    throw new BookingConfigError(
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    );
  }
  return deepFreeze(result.data as BookingConfig);
}
