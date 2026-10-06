/**
 * `useBooking()` — the booking wizard without its markup.
 *
 * Everything `<BookingWizard>` knows lives here, and the wizard is built on
 * it, so the headless path is never second-class: the machine (through
 * `useReducer`), the fetches to the site's own routes under `config.paths.api`
 * (availability, stylists, hours, the submission — the Medal key never leaves
 * the server), the draft / attempt / rebook stores, the restore of a booking
 * a reload or a Vipps login interrupted, the deep-link and «book again»
 * prefill, the 409 slot-taken refresh and the idempotency nonce.
 *
 * What it does NOT own is the page: focus, scrolling, which screen is drawn.
 * Those are the caller's (see `BookingWizard.tsx`).
 *
 * Moved from the source app's wizard shell with its behaviour unchanged; the
 * long-form reasoning for each rule is kept beside the rule.
 */

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { AgeRange } from '../core/age';
import { ATTEMPT_TTL_MS, type BookingAttempt, type SubmittedVisit } from '../core/attempt-store';
import { serviceMatches } from '../core/deep-link';
import { stylistDisplayName } from '../core/display-name';
import { DRAFT_MAX_AGE_MS, type WizardDraft } from '../core/draft-store';
import { fill, labelText } from '../core/labels';
import type {
  WizardAction,
  WizardPerson,
  WizardPrefill,
  WizardService,
  WizardState,
} from '../core/machine';
import { firstOpeningPerResource } from '../core/next-available';
import { type PartySlot, type SlotsByService, slotKeysFor } from '../core/party-slots';
import { stripVippsReturn, vippsConfirmFrom } from '../core/portal/vipps-return';
import type {
  BookingDayDto,
  BookingFamilyMember,
  BookingGuardian,
  BookingResourceDto,
  BookingServiceDto,
  BookingSlotDto,
  BookingSubmission,
} from '../core/types';
import { visitKey, visitServicesOf } from '../core/visit';
import type { BookingKit } from './kit';
import { type BookingOverrides, useBookingKit } from './Provider';

/**
 * What the booking page prefetched on the server. Structurally the `/next`
 * loader's seed; every part but `services` may be missing, and whatever is
 * missing is fetched on demand into the same place.
 */
export interface BookingSeed {
  /** The full catalogue. */
  services: BookingServiceDto[];
  /** The stylists, or `null`/absent when they could not be read. */
  resources?: BookingResourceDto[] | null;
  /** Openings by service id, unfiltered by stylist. */
  slots?: Record<string, BookingSlotDto[]>;
  /** The business's hours over the window, by service id. */
  schedules?: Record<string, BookingDayDto[]>;
  /** «Next available» per stylist, by service id. */
  nextAvailable?: Record<string, Record<string, number>>;
  /** The instant the seed's window starts at; pinned once when absent. */
  fromTs?: number;
}

export interface UseBookingOptions extends BookingOverrides {
  seed: BookingSeed;
  /**
   * The business's phone and address for this request, over `config.contact`
   * — what `/next`'s `loadBookingPage` answers as `contact`.
   */
  contact?: { phone?: string | null; address?: string | null };
  /** The parent the page found a portal session for; `null` for a guest. */
  guardian?: BookingGuardian | null;
  /** How many days the window covers. Default `config.window.rangeDays`. */
  rangeDays?: number;
}

/** A person's «same as last time», and the note when it was swapped for their age. */
export interface BookingSuggestion {
  service: BookingServiceDto;
  note?: string;
}

/** One booked line on the confirmation. */
export interface ConfirmedLine {
  item: SubmittedVisit['items'][number];
  bookingId: string;
  stylistName: string | null;
  manageHref: string | null;
}

/** The confirmation, once a booking came back. */
export interface BookingConfirmation {
  bookings: Array<{ id: string; manageHref: string | null }>;
  submitted: SubmittedVisit;
}

/** How long a replayed submission may take before the restore gate gives up. */
const REPLAY_TIMEOUT_MS = 15_000;

/** «hydrated» only ever flips once; `useSyncExternalStore` wants a subscription. */
function noSubscription(): () => void {
  return () => {
    // Nothing to unsubscribe from.
  };
}

/** The `freshSlots` of a `slotTaken` answer, narrowed to the lost visits' lists. */
function freshSlotsOf(raw: unknown, lost: ReadonlySet<string>): Record<string, BookingSlotDto[]> {
  if (typeof raw !== 'object' || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, BookingSlotDto[]] => lost.has(entry[0]) && Array.isArray(entry[1])
    )
  );
}

/**
 * The window query for ONE visit, named by its key (`a` or `a+b`): the first
 * service as `service_id`, the rest as `extra_service_ids`. The extras are
 * added only when there are some, so a one-service visit asks with exactly the
 * URL it always did — the slot cache and every seeded answer are keyed by it.
 */
function windowQuery(
  key: string,
  fromTs: number,
  toTs: number,
  resourceId?: string | null
): URLSearchParams {
  const [serviceId, ...extras] = key.split('+');
  return new URLSearchParams({
    service_id: serviceId,
    ...(extras.length === 0 ? {} : { extra_service_ids: extras.join(',') }),
    // Omitted for «first available»: an empty resource_id would still narrow.
    ...(resourceId ? { resource_id: resourceId } : {}),
    from_ts: String(fromTs),
    to_ts: String(toTs),
  });
}

/**
 * The submission with each line's extras on it. meda's details screen builds
 * the body from its own types, which have one service per line, so the shell
 * is the only place that knows the rest of a person's visit. Index-aligned with
 * the basket the screen was drawn from; a body of another length is not one
 * this basket produced, and is sent as it came rather than with extras pinned
 * to the wrong people.
 */
function withExtraServices(
  submission: BookingSubmission,
  items: ReadonlyArray<SubmittedVisit['items'][number]>
): BookingSubmission | null {
  if (!items.some((item) => (item.extraServices ?? []).length > 0)) return submission;
  // Lines that cannot be matched to the basket are REFUSED, not sent bare: a
  // body without the extras books the first service only, while the card and
  // the calendar entry would describe the whole visit.
  if (submission.items.length !== items.length) {
    console.warn(
      '[@medalsocial/booking] The submission has %d lines for a basket of %d; not sent.',
      submission.items.length,
      items.length
    );
    return null;
  }
  return {
    ...submission,
    items: submission.items.map((line, index) => {
      const extras = items[index].extraServices ?? [];
      return extras.length === 0
        ? line
        : { ...line, extraServiceIds: extras.map((service) => service.id) };
    }),
  };
}

/** What the create route said, narrowed to what the machine can hold. */
function asSubmitFailure(
  code: unknown
): Exclude<NonNullable<WizardState['error']>, 'slotTaken' | 'maxParty'> {
  switch (code) {
    case 'conflict':
    case 'invalidInput':
    case 'unconfigured':
    case 'inProgress':
      return code;
    default:
      return 'upstreamError';
  }
}

/** What the named stylist can do; `undefined` for «nobody named» or «not loaded». */
function serviceIdsOf(
  resources: BookingResourceDto[],
  resourceId: string | null
): readonly string[] | undefined {
  if (resourceId === null) return undefined;
  return resources.find((resource) => resource.id === resourceId)?.serviceIds;
}

/**
 * Whether a create answer is a whole one: exactly one booking, with its own
 * distinct id, per submitted line. Anything else — none, fewer, more, an id
 * missing or repeated — is not a
 * confirmation; the wizard shows it as the generic create failure
 * (`upstreamError`, «we still do not know»), whose attempt survives for the
 * replay under the same idempotency key.
 */
export function isCompleteConfirmation(
  bookings: ReadonlyArray<{ id?: unknown }> | null | undefined,
  itemCount: number
): boolean {
  if (!Array.isArray(bookings) || itemCount <= 0 || bookings.length !== itemCount) return false;
  const ids = bookings.map((booking) => booking?.id);
  // Distinct, too: one id on two lines is two calendar entries with one UID.
  return (
    ids.every((id) => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length
  );
}

/**
 * The basket and the create response, zipped by INDEX — each line its OWN
 * booking. Only a whole answer (`isCompleteConfirmation`) gets this far; a line
 * the answer has no booking for is left out rather than handed a sibling's id,
 * which would give two calendar entries one UID.
 */
export function confirmationLines(confirmation: BookingConfirmation): ConfirmedLine[] {
  const { submitted, bookings } = confirmation;
  return submitted.items.flatMap((item, index) => {
    const booking = bookings[index];
    if (booking === undefined) return [];
    return [
      {
        item,
        bookingId: booking.id,
        stylistName: submitted.stylistNames[index] ?? null,
        manageHref: booking.manageHref,
      },
    ];
  });
}

/** Only the stylist the visitor asked for. */
function onlyResource(slots: readonly BookingSlotDto[], resourceId: string): BookingSlotDto[] {
  return slots.filter((slot) => slot.resourceId === resourceId);
}

/** What a link asked for that needs no service to be true yet. */
interface DeepLink {
  category: string | null;
  stylist: string | null;
  party: number | null;
  seat: { children: number } | { adult: true } | null;
}

/** The catalogue a prefill is checked against: what step 2 lets the visitor TAP. */
function prefillCatalogue(services: BookingServiceDto[], resources: BookingResourceDto[]) {
  return { services: services.filter((service) => service.bookableOnline), resources };
}

/** A stylist without a service is nothing to finish. */
function stylistLeftToFill(prefill: WizardPrefill | null): WizardPrefill | null {
  return prefill?.serviceId && prefill.resourceId ? prefill : null;
}

/** Whether the stylist list can now vouch for the pending link. */
function canFinishStylist(
  pending: WizardPrefill | null,
  resources: BookingResourceDto[],
  primaryVisit: string | null
): pending is WizardPrefill {
  return pending !== null && resources.length > 0 && primaryVisit === pending.serviceId;
}

/**
 * A saved child as the person the machine seats: by `personId` when Medal has
 * one, else by their PLACE in the profile with name and year beside it, so two
 * «Emma 2018» are two seats and a reordered list matches nobody.
 */
export function personForChild(child: BookingFamilyMember, index: number): WizardPerson {
  return {
    key: child.personId ? `p:${child.personId}` : `n:${index}:${child.name}:${child.birthYear}`,
    name: child.name,
    birthYear: child.birthYear,
    ...(child.personId ? { personId: child.personId } : {}),
    ...(child.birthMonth ? { birthMonth: child.birthMonth } : {}),
  };
}

/** The pure parts of the wizard's setup, bound to one kit. */
function setupFor(kit: BookingKit) {
  const { config, wizard, deepLinks } = kit;
  const q = config.query;

  /** «Bestill igjen» (`?service=&stylist=`) or a marketing `?tjeneste=` link, or `null`. */
  function prefillFromQuery(
    query: URLSearchParams | null,
    services: BookingServiceDto[]
  ): WizardPrefill | null {
    if (query === null) return null;
    const linked = query.get(q.service);
    const linkedService = linked
      ? services.find((service) => service.bookableOnline && serviceMatches(service, linked))
      : undefined;
    const serviceId = query.get(q.rebookService) || linkedService?.id || null;
    const resourceId = query.get(q.rebookStylist) || (serviceId ? query.get(q.stylist) : null);
    if (!serviceId && !resourceId) return null;
    return {
      serviceId,
      resourceId,
      party: serviceId ? deepLinks.parseParty(query.get(q.party)) : null,
    };
  }

  function deepLinkFromQuery(query: URLSearchParams | null): DeepLink {
    return {
      category: deepLinks.parseCategory(query?.get(q.category)),
      stylist: query?.get(q.stylist)?.trim() || null,
      party: deepLinks.parseParty(query?.get(q.party)),
      seat: deepLinks.impliedParty(query),
    };
  }

  /** One grown-up seated, as the adult chip does. */
  function withAdult(): WizardState {
    return wizard.reduce(wizard.initialState(), {
      type: 'choosePeople',
      people: [{ key: 'adult', adult: true }],
      advance: true,
    });
  }

  /** `n` guest children seated, clamped to the chips there are. */
  function withGuests(party: number): WizardState {
    const count = Math.min(Math.max(1, party), wizard.maxPeople);
    const people = Array.from({ length: count }, (_, index) => wizard.guestChild(index + 1));
    return wizard.reduce(wizard.initialState(), { type: 'choosePeople', people, advance: true });
  }

  /** `state` with the link's service held for step 1, when the catalogue has it. */
  function heldLink(
    state: WizardState,
    prefill: WizardPrefill | null,
    services: BookingServiceDto[],
    resources: BookingResourceDto[]
  ): WizardState {
    const service = prefill?.serviceId
      ? prefillCatalogue(services, resources).services.find(
          (entry) => entry.id === prefill.serviceId
        )
      : undefined;
    return service === undefined ? state : wizard.reduce(state, { type: 'holdService', service });
  }

  /**
   * Where the wizard starts: empty, or with the link folded in — in the
   * reducer's initialiser, so the server render already shows that step.
   */
  function initialWizardState(
    prefill: WizardPrefill | null,
    services: BookingServiceDto[],
    resources: BookingResourceDto[],
    seat: DeepLink['seat'] = null,
    familyKnown = false
  ): WizardState {
    // A parent the page knows is asked who is coming FIRST, whatever the link says.
    if (familyKnown) return heldLink(wizard.initialState(), prefill, services, resources);
    // `party.askWhoFirst: false`: a guest starts on step 2 as the common visit —
    // one child where the site has a children's menu, else one grown-up — and
    // step 1 stays one tap back for a party.
    const unasked = config.party.askWhoFirst
      ? null
      : kit.childCategory !== null
        ? { children: 1 }
        : ({ adult: true } as const);
    const seated = seat ?? unasked;
    const base = seated !== null && 'adult' in seated ? withAdult() : wizard.initialState();
    if (prefill === null) {
      if (seated === null) return wizard.initialState();
      return 'adult' in seated ? withAdult() : withGuests(seated.children);
    }
    return wizard.applyPrefill(base, prefill, prefillCatalogue(services, resources));
  }

  return { prefillFromQuery, deepLinkFromQuery, heldLink, initialWizardState };
}

export function useBooking(options: UseBookingOptions) {
  const { kit } = useBookingKit(options, options.contact);
  const { config, labels, wizard, clock, age, phone, deepLinks } = kit;
  const services = options.seed.services;
  const arrivedAs = options.guardian ?? null;
  const rangeDays = options.rangeDays ?? config.window.rangeDays;
  const setup = useMemo(() => setupFor(kit), [kit]);

  /**
   * Who logged in from the login sheet — and whether anybody did, which is
   * not the same question: a good code whose profile read failed is still a
   * logged-in parent, who must not be offered the login again.
   */
  const [signedIn, setSignedIn] = useState<{ guardian: BookingGuardian | null } | null>(null);
  /**
   * The create route said nobody is logged in (`accountRequired`): the session
   * the page arrived with — or the one taken here — has run out. From then on
   * the parent the page found is not trusted; only a fresh login is.
   */
  const [sessionLost, setSessionLost] = useState(false);
  const arrivedAsNow = sessionLost ? null : arrivedAs;
  const guardian = signedIn?.guardian ?? arrivedAsNow;

  // The link, read ONCE, in the initialisers: a prefill that re-applied later
  // would answer questions the visitor has since changed their mind about.
  const query: URLSearchParams | null = useSearchParams();
  const [prefill] = useState(() => setup.prefillFromQuery(query, services));
  const [deepLink] = useState(() => setup.deepLinkFromQuery(query));
  const deepLinkPending = useRef(prefill === null || prefill.serviceId == null);
  const [linked] = useState(() => prefill !== null || deepLinks.hasDeepLink(query));
  const [vippsResumePath] = useState(() => deepLinks.resumePath(query));
  const [resuming] = useState(() => query?.get(config.query.resume) === '1');
  const [vippsConfirm] = useState<{ to: string | null } | null>(
    () => vippsConfirmFrom(query) ?? null
  );

  // The address bar is cleaned straight after the first render: the marker and
  // the masked address must not stay in the history entry.
  useEffect(() => {
    if (vippsConfirm !== null) stripVippsReturn();
  }, [vippsConfirm]);
  /** `false` on the server and through hydration, `true` from the first render after it. */
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );
  const [restoreExpected] = useState(
    () =>
      typeof window !== 'undefined' &&
      kit.restoreGate.restorePendingInStorage(
        kit.attempts.ATTEMPT_STORAGE_KEY,
        ATTEMPT_TTL_MS,
        kit.drafts.DRAFT_STORAGE_KEY,
        DRAFT_MAX_AGE_MS,
        linked,
        resuming
      )
  );
  const [restoreSettled, setRestoreSettled] = useState(false);
  const restoring = restoreExpected && !restoreSettled;
  const [state, dispatch] = useReducer(wizard.reduce, prefill, (initial) =>
    setup.initialWizardState(
      initial,
      services,
      options.seed.resources ?? [],
      deepLink.seat,
      arrivedAs !== null
    )
  );

  /** Children a logged-in parent added from step 1 during this visit. */
  const [addedChildren, setAddedChildren] = useState<BookingFamilyMember[]>([]);
  const family = useMemo(
    () => (guardian === null ? null : [...guardian.family, ...addedChildren]),
    [guardian, addedChildren]
  );
  /** Guest seats go when a family appears over them (`seatFamily`). */
  const guestSeated = family !== null && state.people.some(wizard.isGuestSeat);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-asked on every step change, as the source did.
  useEffect(() => {
    if (guestSeated) dispatch({ type: 'seatFamily' });
  }, [guestSeated, state.step]);

  /** A stylist a party link named, applied once the family reaches step 3. */
  const partyStylist = useRef<string | null>(
    arrivedAs !== null ? (prefill?.resourceId ?? deepLink.stylist) : null
  );
  const childByKey = useMemo(
    () => new Map((family ?? []).map((child, index) => [personForChild(child, index).key, child])),
    [family]
  );

  // Pinned once: the seeded slots and the day strip describe the same days.
  const [fromTs] = useState(() => options.seed.fromTs ?? Date.now());
  const { toTs, days } = useMemo(() => clock.window(fromTs, rangeDays), [clock, fromTs, rangeDays]);
  /** The business date the ages on steps 1 and 2 are read on: the chosen day, else today. */
  const ageDayKey = clock.dayKey(state.startTs ?? fromTs);

  /** A child's age on the business day `dayKey`; `null` for a grown-up or an unknown year. */
  function personAge(person: WizardPerson, dayKey: string): AgeRange | null {
    if (person.adult || person.birthYear === undefined) return null;
    return age.ageOnDay(person.birthYear, person.birthMonth, dayKey);
  }

  /** «Samme som sist»: the child's last visit, where it is still taken online. */
  const suggestionFor = (person: WizardPerson): BookingSuggestion | null => {
    const serviceId = childByKey.get(person.key)?.lastVisit?.serviceId;
    if (!serviceId) return null;
    const bookable = services.filter((entry) => entry.bookableOnline);
    const last = bookable.find((entry) => entry.id === serviceId);
    if (!last) return null;
    // Age on the appointment day, not the day of the last visit.
    const ageNow = personAge(person, ageDayKey);
    if (age.fitsAge(last, ageNow)) return { service: last };
    const grownUp = age.grownUpEquivalent(last, bookable, ageNow);
    if (!grownUp) return null;
    return {
      service: grownUp,
      note: fill(labels['wizard.suggestion.outgrown'], {
        last: last.name,
        name: person.name ?? labelText(labels['wizard.suggestion.someone']),
        next: grownUp.name,
      }),
    };
  };
  const pendingStylist = useRef(stylistLeftToFill(prefill));

  /**
   * Unfiltered openings, keyed by VISIT (`visitKey`): a service id for a
   * one-service visit — which is all the server seed ever holds — and `a+b`
   * for a person having both, whose list is the server's answer for the whole
   * visit rather than either service's own.
   */
  const [slots, setSlots] = useState<Record<string, readonly BookingSlotDto[]>>(
    () => options.seed.slots ?? {}
  );
  const [slotsFailed, setSlotsFailed] = useState(false);
  const [resources, setResources] = useState<BookingResourceDto[]>(
    () => options.seed.resources ?? []
  );
  /** Whether the stylist list has been answered at all — seeded, fetched or failed. */
  const [resourcesKnown, setResourcesKnown] = useState(() => options.seed.resources != null);
  const [seededNextAvailable, setSeededNextAvailable] = useState(() =>
    options.seed.resources ? (options.seed.nextAvailable ?? {}) : {}
  );
  const [seededSchedule] = useState(() => options.seed.schedules ?? {});
  /** The last «next available» answer, and for WHICH visit (its key). */
  const [fetchedNextAvailable, setFetchedNextAvailable] = useState<{
    key: string;
    times: Record<string, number>;
  } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  /**
   * The attempt (and its nonce), null until the browser has it: storage does
   * not exist during the server render, and reading it in an initialiser
   * would give the two sides different trees.
   */
  const [attempt, setAttempt] = useState<BookingAttempt | null>(null);
  /** The submission whose answer is still unknown; a retry resends THAT body. */
  const [pendingAttempt, setPendingAttempt] = useState<NonNullable<
    BookingAttempt['pending']
  > | null>(null);
  const submissionNonce = attempt?.nonce;
  /** The instant that was taken while the visitor was filling in the form. */
  const [takenSlotTs, setTakenSlotTs] = useState<number | null>(null);
  /** Set once, by a successful submission — one entry per line item. */
  const [confirmed, setConfirmed] = useState<BookingConfirmation | null>(null);

  const resumed = useRef(false);
  /** The whole «book again» link, kept to apply AGAIN after a refused replay. */
  const rebookLink = useRef<WizardPrefill | null>(prefill);
  const latestResources = useRef(resources);
  useEffect(() => {
    latestResources.current = resources;
  }, [resources]);

  // The child's name a «book again» tap stashed for this tab, taken once.
  const applyRebookWho = () => {
    const who = kit.rebook.takeRebookWho();
    if (who === null) return;
    rebookLink.current = { ...(rebookLink.current ?? {}), who };
    // A known parent: seat THEIR child by id, for a name exactly one child has.
    const known = guardian?.family ?? [];
    const named = known.filter((child) => child.name === who);
    if (named.length === 1) {
      const service = state.items[0]?.service ?? state.pendingService;
      dispatch({
        type: 'choosePeople',
        people: [personForChild(named[0], known.indexOf(named[0]))],
        services: [service],
      });
      if (service !== null) dispatch({ type: 'pickServiceFor', index: 0, service });
      return;
    }
    dispatch({ type: 'prefill', prefill: { who }, catalogue: prefillCatalogue(services, []) });
  };

  /** Put the «book again» link back onto a wizard that has just started over, once. */
  const restartFromLink = () => {
    const link = rebookLink.current;
    if (link === null) return;
    rebookLink.current = null;
    const current = latestResources.current;
    if (guardian !== null) {
      const held = setup.heldLink(wizard.initialState(), link, services, current);
      dispatch({ type: 'holdService', service: held.pendingService });
      partyStylist.current = link.resourceId ?? null;
      return;
    }
    dispatch({ type: 'prefill', prefill: link, catalogue: prefillCatalogue(services, current) });
    if (current.length === 0) pendingStylist.current = stylistLeftToFill(link);
  };

  /** The stylists a restored slot was booked with, until the catalogue can vouch for them. */
  const restoredStylists = useRef<string[] | null>(null);

  /**
   * A logged-in parent's saved children back in their chairs: each draft line
   * whose stored `personId` is a child of THIS guardian's family is reseated as
   * that child (`choosePeople`, then its service again), so it is submitted
   * with `booked_for_person_id` as it would have been without the round trip.
   * An id the family does not have — another parent's, a child removed since,
   * a hand-edited jar — is ignored, and its line restores as a name and a year
   * exactly as a draft without ids does. Returns the reseated line indexes.
   */
  const reseatFamily = (draft: WizardDraft, lines: BookingServiceDto[]): Set<number> => {
    const reseated = new Set<number>();
    if (family === null) return reseated;
    const keys = new Set<string>();
    // The seats `pickService` / `addService` just built (`peopleFor`), for the
    // lines that are not reseated. A parent known at mount starts with nobody
    // seated (`initialWizardState`), so every one of them is a guest chair.
    const people = draft.items.map((item, index) => {
      const built = wizard.guestChild(index + 1);
      const at = item.personId ? family.findIndex((child) => child.personId === item.personId) : -1;
      const child = at === -1 ? null : personForChild(family[at], at);
      if (child === null || keys.has(child.key)) {
        keys.add(built.key);
        return built;
      }
      keys.add(child.key);
      reseated.add(index);
      return child;
    });
    if (reseated.size === 0) return reseated;
    dispatch({ type: 'choosePeople', people });
    for (const index of reseated) {
      dispatch({ type: 'pickServiceFor', index, service: lines[index] });
    }
    return reseated;
  };

  /**
   * Each draft line's extras back on it, through `toggleServiceFor` like a tap.
   * Returns whether EVERY extra came back. The machine's refusals are checked
   * here first rather than read off its state, which a dispatch does not hand
   * back: an id the catalogue no longer books, one already on the line (a
   * toggle would take it OFF again), one past `maxServicesPerPerson`, or one
   * more taker than the service's `maxPerBooking` — each is skipped, as an
   * unknown main service is, and makes the answer `false`.
   */
  const restoreExtras = (
    draft: WizardDraft,
    lines: BookingServiceDto[],
    bookable: ReadonlyMap<string, BookingServiceDto>
  ): boolean => {
    let whole = true;
    const lists = lines.map((service) => [service]);
    draft.items.forEach((item, index) => {
      for (const id of item.extraServiceIds ?? []) {
        const service = bookable.get(id);
        const list = lists[index];
        const takers = lists.filter((other) => other.some((entry) => entry.id === id)).length;
        if (
          service === undefined ||
          list.some((entry) => entry.id === id) ||
          list.length >= config.party.maxServicesPerPerson ||
          takers + 1 > service.maxPerBooking
        ) {
          whole = false;
          continue;
        }
        list.push(service);
        dispatch({ type: 'toggleServiceFor', index, service });
      }
    });
    return whole;
  };

  /**
   * The booking a Vipps login interrupted, rebuilt through the machine's own
   * actions — so it obeys every rule a tapped one does — and trusting nothing
   * beyond the catalogue.
   */
  const restoreDraft = (draft: WizardDraft) => {
    const bookable = new Map(
      services.filter((service) => service.bookableOnline).map((service) => [service.id, service])
    );
    const resolved = draft.items.map((item) => bookable.get(item.serviceId));
    const [first, ...rest] = resolved;
    if (first === undefined || resolved.some((service) => service === undefined)) return;

    // A guest is reseated as they left; a family's seats are its own children.
    if (family === null && draft.items.every((item) => typeof item.adult === 'boolean')) {
      dispatch({
        type: 'choosePeople',
        people: draft.items.map((item, index) =>
          item.adult ? { key: 'adult', adult: true } : wizard.guestChild(index + 1)
        ),
        advance: true,
      });
    }
    dispatch({ type: 'pickService', service: first });
    // Every line resolved (checked above), so `rest` holds services only.
    for (const service of rest as BookingServiceDto[]) dispatch({ type: 'addService', service });
    const reseated = reseatFamily(draft, resolved as BookingServiceDto[]);
    // After the seats are final (a reseat moves people, and their extras with
    // them) and before the stylist, so no toggle is refused for a preference
    // the draft is about to restore anyway.
    const wholeVisits = restoreExtras(draft, resolved as BookingServiceDto[], bookable);
    // Before the stylist: `setPartyMode('parallel')` drops the preference.
    if (draft.partyMode === 'parallel') dispatch({ type: 'setPartyMode', mode: 'parallel' });
    dispatch({ type: 'pickResource', resourceId: draft.resourceId });
    draft.items.forEach((item, index) => {
      // A reseated child's name and year are the family's own, already on the line.
      if (reseated.has(index)) return;
      if (item.bookedForName !== null) {
        dispatch({
          type: 'setItemField',
          index,
          field: 'bookedForName',
          value: item.bookedForName,
        });
      }
      if (item.bookedForBirthYear !== null) {
        dispatch({
          type: 'setItemField',
          index,
          field: 'bookedForBirthYear',
          value: item.bookedForBirthYear,
        });
      }
    });

    // The hour was chosen for the visits as they were. One that came back
    // shorter — an extra retired since, or one the rules now refuse — would be
    // submitted at a time that was only ever free for the longer visit (or
    // offered for the shorter one by nobody), so the visitor picks again.
    if (draft.startTs === null || !wholeVisits) return;
    if (draft.partyResourceIds !== null && draft.partyResourceIds.length === resolved.length) {
      restoredStylists.current = draft.partyResourceIds;
      dispatch({
        type: 'pickPartySlot',
        startTs: draft.startTs,
        resourceIds: draft.partyResourceIds,
        mode: draft.partyMode,
      });
      return;
    }
    restoredStylists.current =
      draft.resolvedResourceId === null ? null : [draft.resolvedResourceId];
    dispatch({ type: 'pickSlot', startTs: draft.startTs, resourceId: draft.resolvedResourceId });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per mount; the ref, not the dependencies, makes it so.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const replay = restoreFromStorage();
    if (replay === null) setRestoreSettled(true);
    else void replay.finally(() => setRestoreSettled(true));
  }, []);

  /** What the mount effect restores, in order; the replay when it started one. */
  function restoreFromStorage(): Promise<void> | null {
    let stored = kit.attempts.readAttempt();
    // A fresh link beats a remembered confirmation (not a pending attempt).
    if (linked && stored.confirmed !== undefined && stored.pending === undefined) {
      kit.attempts.clearAttempt();
      stored = kit.attempts.readAttempt();
    }
    // A remembered confirmation that is not a whole one is no confirmation.
    if (
      stored.confirmed !== undefined &&
      !isCompleteConfirmation(stored.confirmed.bookings, stored.confirmed.submitted.items.length)
    ) {
      kit.attempts.clearAttempt();
      stored = kit.attempts.readAttempt();
    }
    setAttempt(stored);
    applyRebookWho();
    if (stored.confirmed !== undefined) {
      setConfirmed(stored.confirmed);
      return null;
    }
    if (stored.pending === undefined) {
      // Nothing owed an answer: the one moment a Vipps round trip gets its draft back.
      if (resuming) {
        const draft = kit.drafts.takeDraft();
        if (draft !== null) restoreDraft(draft);
      }
      return null;
    }
    // The OLD attempt comes first, and the link waits for its answer.
    if (rebookLink.current !== null) {
      pendingStylist.current = null;
      dispatch({ type: 'startOver' });
    }
    setPendingAttempt(stored.pending);
    return send(stored.pending.submission, stored.pending.submitted, { replay: true });
  }

  /** The draft, kept current on every answer rather than written on the Vipps tap. */
  useEffect(() => {
    if (confirmed !== null || state.items.length === 0) {
      kit.drafts.clearDraft();
      return;
    }
    kit.drafts.stashDraft({
      items: state.items.map((item) => ({
        serviceId: item.service.id,
        // Only when there are some: a one-service line is stored as it always was.
        ...(item.extraServices?.length
          ? { extraServiceIds: item.extraServices.map((service) => service.id) }
          : {}),
        bookedForName: item.bookedForName ?? null,
        bookedForBirthYear: item.bookedForBirthYear ?? null,
        adult: item.adult === true,
        personId: item.bookedForPersonId ?? null,
      })),
      resourceId: state.resourceId,
      partyMode: state.partyMode,
      startTs: state.startTs,
      resolvedResourceId: state.resolvedResourceId,
      partyResourceIds: state.partyResourceIds,
    });
  }, [
    kit,
    confirmed,
    state.items,
    state.resourceId,
    state.partyMode,
    state.startTs,
    state.resolvedResourceId,
    state.partyResourceIds,
  ]);

  /** A live mirror of the contact fields, for the prefill below. */
  const latestContact = useRef(state.contact);
  useEffect(() => {
    latestContact.current = state.contact;
  });

  /**
   * The logged-in parent's details into the fields — once per parent, into
   * fields still BLANK or still holding exactly what the PREVIOUS parent's
   * profile put there (a shared device), never over what the visitor typed.
   */
  const guardianFilled = useRef<{ email: string; wrote: WizardState['contact'] } | null>(null);
  useEffect(() => {
    if (guardian === null || guardianFilled.current?.email === guardian.email) return;
    const previous = guardianFilled.current?.wrote;
    const contact = latestContact.current;
    const wrote = {
      name: [guardian.firstName, guardian.lastName].filter(Boolean).join(' ').trim(),
      phone: guardian.phone === null ? '' : phone.nationalDigits(guardian.phone),
      email: guardian.email,
    };
    guardianFilled.current = { email: guardian.email, wrote };

    for (const field of ['name', 'phone', 'email'] as const) {
      const value = wrote[field];
      if (value === '') continue;
      const held = contact[field].trim();
      if (held !== '' && held !== previous?.[field]) continue;
      dispatch({ type: 'setContact', field, value });
    }
  }, [guardian, phone]);

  // One entry per distinct VISIT, not per service: a person having cut and wash
  // is one question to the engine (one stylist, back to back), and the cut's
  // own list would offer somebody who cannot wash.
  const basketVisits = useMemo(() => slotKeysFor(state.items), [state.items]);
  // A string, so an effect keyed on it does not refetch on every keystroke.
  // `|` between visits, as `+` is already inside one.
  const basketKey = basketVisits.join('|');
  const primaryServiceId = state.items[0]?.service.id ?? null;
  /**
   * The first person's whole visit, by key — what the stylists' «neste ledige»
   * and the business's hours are asked for. Equal to `primaryServiceId` for a
   * one-service visit, so the seed (keyed by service id, and only ever for one
   * service) answers exactly the visits it can, and a visit with extras is
   * fetched instead of being read off its first service's openings.
   */
  const primaryVisit = state.items[0] ? visitKey(state.items[0]) : null;

  const nextAvailableTs = useMemo<Record<string, number>>(() => {
    if (primaryVisit === null) return {};
    const seeded = seededNextAvailable[primaryVisit];
    if (seeded) return seeded;
    return fetchedNextAvailable?.key === primaryVisit ? fetchedNextAvailable.times : {};
  }, [primaryVisit, seededNextAvailable, fetchedNextAvailable]);

  const missingKey = basketVisits.filter((key) => !(key in slots)).join('|');
  /** Bumped to ask for the openings again after a failure. */
  const [slotsAttempt, setSlotsAttempt] = useState(0);
  const api = config.paths.api;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `slotsAttempt` is the retry trigger.
  useEffect(() => {
    if (missingKey === '') return;
    const wanted = missingKey.split('|');
    let cancelled = false;
    setSlotsFailed(false);

    (async () => {
      try {
        const fetched = await Promise.all(
          wanted.map(async (key) => {
            const response = await fetch(`${api}/availability?${windowQuery(key, fromTs, toTs)}`);
            if (!response.ok) throw new Error(`availability ${response.status}`);
            const body = (await response.json()) as { slots?: BookingSlotDto[] };
            // Stored under the WHOLE visit's key — the key it is read back by.
            return [key, body.slots ?? []] as const;
          })
        );
        if (cancelled) return;
        setSlots((previous) => ({ ...previous, ...Object.fromEntries(fetched) }));
      } catch {
        // Nothing is cached on a failure; the step says so rather than «full».
        if (!cancelled) setSlotsFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, missingKey, fromTs, toTs, slotsAttempt]);

  useEffect(() => {
    if (primaryVisit === null) return;
    if (primaryVisit in seededNextAvailable) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`${api}/resources?${windowQuery(primaryVisit, fromTs, toTs)}`);
        if (!response.ok) throw new Error(`resources ${response.status}`);
        const body = (await response.json()) as {
          resources?: BookingResourceDto[];
          nextAvailableTs?: Record<string, number>;
        };
        if (cancelled) return;
        setResources(body.resources ?? []);
        setResourcesKnown(true);
        setFetchedNextAvailable({ key: primaryVisit, times: body.nextAvailableTs ?? {} });
      } catch {
        // Answered «none» FOR THIS VISIT; the stylist LIST is kept.
        if (!cancelled) {
          setResourcesKnown(true);
          setFetchedNextAvailable({ key: primaryVisit, times: {} });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, primaryVisit, fromTs, toTs, seededNextAvailable]);

  /**
   * The stylist half of a «book again» link, once a list for its service has
   * landed. Compared by VISIT: the link named one service, and a visitor who
   * has since added a wash to it is asking a different question — the list now
   * in hand answers the longer visit, not the one the link vouched for.
   */
  useEffect(() => {
    const pending = pendingStylist.current;
    if (pending && primaryVisit !== null && primaryVisit !== pending.serviceId) {
      pendingStylist.current = null;
      return;
    }
    if (!canFinishStylist(pending, resources, primaryVisit)) return;
    pendingStylist.current = null;
    dispatch({
      type: 'prefill',
      prefill: pending,
      catalogue: prefillCatalogue(services, resources),
    });
  }, [resources, primaryVisit, services]);

  /** A party link's stylist, once the family has its services and is on step 3. */
  useEffect(() => {
    const wanted = partyStylist.current;
    if (wanted === null || state.step !== 'when' || primaryServiceId === null) return;
    if (resources.length === 0) return;
    partyStylist.current = null;
    dispatch({
      type: 'prefill',
      prefill: { serviceId: primaryServiceId, resourceId: wanted },
      catalogue: prefillCatalogue(services, resources),
    });
  }, [state.step, primaryServiceId, resources, services]);

  /** A restored slot whose stylist has left the roster, dropped before it is submitted. */
  useEffect(() => {
    const restored = restoredStylists.current;
    if (restored === null || resources.length === 0 || primaryServiceId === null) return;
    restoredStylists.current = null;
    const known = new Set(resources.map((resource) => resource.id));
    if (restored.every((id) => known.has(id))) return;
    dispatch({ type: 'pickResource', resourceId: null });
  }, [resources, primaryServiceId]);

  /**
   * The open dates over the window, for the first person's VISIT (cutoffs are
   * per service, and `visitTailMinutes` assumes the answer was for item 0's
   * whole visit — see the machine).
   *
   * The seed is the SALON's week, which is what «first available» draws. A named
   * stylist works a different week, so their hours are fetched with `resource_id`
   * and the seed is not allowed to answer for them — a seeded salon week would
   * otherwise paint every open day as theirs.
   */
  const [fetchedSchedule, setFetchedSchedule] = useState<{
    key: string;
    days: BookingDayDto[];
  } | null>(null);
  const [scheduleFailedFor, setScheduleFailedFor] = useState<string | null>(null);
  // The visit, plus the stylist when one is named. The two answers must not
  // share a key: a late salon response must not land on a stylist's calendar.
  const scheduleKey =
    primaryVisit === null
      ? null
      : state.resourceId === null
        ? primaryVisit
        : `${primaryVisit}#${state.resourceId}`;

  // `null`, not `[]`, until this service's hours are in hand: «we do not know».
  // A named stylist's own week replaces the salon's when it arrives. Until then
  // the salon answer stays, so the time step does not unmount mid-tap. A failed
  // read is not «still waiting»: their hours are unknown, and the salon week
  // must not stay on screen as theirs.
  const openDays = useMemo<BookingDayDto[] | null>(() => {
    if (primaryVisit === null || scheduleKey === null) return null;
    if (fetchedSchedule?.key === scheduleKey) return fetchedSchedule.days;
    if (state.resourceId === null) {
      return seededSchedule[primaryVisit] ?? null;
    }
    if (scheduleFailedFor === scheduleKey) return null;
    return (
      seededSchedule[primaryVisit] ??
      (fetchedSchedule?.key === primaryVisit ? fetchedSchedule.days : null)
    );
  }, [
    primaryVisit,
    state.resourceId,
    scheduleKey,
    seededSchedule,
    fetchedSchedule,
    scheduleFailedFor,
  ]);

  useEffect(() => {
    if (primaryVisit === null || scheduleKey === null) return;
    // The seed already answers «first available». A named stylist always asks.
    if (state.resourceId === null && primaryVisit in seededSchedule) return;
    let cancelled = false;
    const key = scheduleKey;
    const resourceId = state.resourceId;
    // A new read is not the previous failure. Leaving that flag set would settle
    // the retry before it has answered.
    setScheduleFailedFor((current) => (current === key ? null : current));

    (async () => {
      try {
        const response = await fetch(
          `${api}/schedule?${windowQuery(primaryVisit, fromTs, toTs, resourceId)}`
        );
        if (!response.ok) throw new Error(`schedule ${response.status}`);
        const body = (await response.json()) as { days?: BookingDayDto[] };
        if (cancelled) return;
        setFetchedSchedule({ key, days: body.days ?? [] });
      } catch {
        // Left `null`: the hours are unknown, which is not the same as «closed».
        // Keyed like the success, so one stylist's failure does not settle the next.
        if (!cancelled) {
          setScheduleFailedFor(key);
          // The previous success for this stylist is stale once this read failed.
          setFetchedSchedule((current) => (current?.key === key ? null : current));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, primaryVisit, fromTs, toTs, seededSchedule, state.resourceId, scheduleKey]);

  /** A stylist's display name for an id; `''` from Medal reads as none. */
  const resolveStylistName = useMemo(
    () => (resourceId: string) => {
      const name = resources.find((resource) => resource.id === resourceId)?.name;
      return name ? stylistDisplayName(name) || null : null;
    },
    [resources]
  );
  const chosenStylistName = state.resourceId === null ? null : resolveStylistName(state.resourceId);
  const chosenStylistServiceIds = serviceIdsOf(resources, state.resourceId);

  /**
   * A NAMED stylist restored before the list landed who turns out not to cover
   * this basket: «first available» instead, and said so — only on step 3, and
   * only against a list that actually arrived.
   */
  const [stylistNotice, setStylistNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!resourcesKnown || resources.length === 0) return;
    if (state.step !== 'when' || state.resourceId === null) return;
    const chosen = resources.find((resource) => resource.id === state.resourceId);
    // Every service of every visit: a stylist who cuts but does not wash cannot
    // take the person having both.
    const covers =
      chosen !== undefined &&
      state.items.every((item) =>
        visitServicesOf(item).every((service) => chosen.serviceIds.includes(service.id))
      );
    if (covers) return;
    dispatch({ type: 'pickResource', resourceId: null });
    setStylistNotice(labelText(labels['wizard.stylistGone']));
  }, [labels, resourcesKnown, resources, state.step, state.resourceId, state.items]);

  /** The open dates with the cutoffs pulled back to fit the WHOLE visit (the safe direction). */
  const openDaysForVisit = useMemo(() => {
    if (openDays === null) return null;
    const extraMs = wizard.visitTailMinutes(state.items, state.partyMode) * 60_000;
    if (extraMs <= 0) return openDays;
    return openDays.map((day) => ({
      ...day,
      lastStartTs: day.lastStartTs === null ? null : day.lastStartTs - extraMs,
    }));
  }, [wizard, openDays, state.items, state.partyMode]);

  const party = wizard.showsPartyMode(state);
  const haveEveryService = basketVisits.every((key) => key in slots);
  const scheduleSettled =
    openDays !== null || (scheduleKey !== null && scheduleFailedFor === scheduleKey);
  const nextAvailableLoading = party
    ? !haveEveryService && !slotsFailed
    : primaryVisit !== null &&
      !(primaryVisit in seededNextAvailable) &&
      fetchedNextAvailable?.key !== primaryVisit;

  /** The basket's openings, unfiltered — the parallel search needs two stylists. */
  const basketSlots: SlotsByService = useMemo(() => {
    const out: Record<string, readonly BookingSlotDto[]> = {};
    for (const id of basketKey === '' ? [] : basketKey.split('|')) out[id] = slots[id] ?? [];
    return out;
  }, [basketKey, slots]);

  const preferredSlots: SlotsByService = useMemo(() => {
    const preferred = state.resourceId;
    if (preferred === null) return basketSlots;
    return Object.fromEntries(
      Object.entries(basketSlots).map(([id, list]) => [id, onlyResource(list, preferred)])
    );
  }, [basketSlots, state.resourceId]);

  const partyNextAvailableTs = useMemo<Record<string, number>>(
    () =>
      party && state.partyMode === 'sequential' && haveEveryService
        ? kit.partySlots.firstPartyStartPerResource(state.items, basketSlots)
        : {},
    [kit, party, state.partyMode, haveEveryService, state.items, basketSlots]
  );

  const partySlots = useMemo(
    () =>
      party ? kit.partySlots.findPartySlots(state.items, preferredSlots, state.partyMode) : [],
    [kit, party, state.items, preferredSlots, state.partyMode]
  );

  /** The parallel visits, for the day with nothing back to back — over UNFILTERED slots. */
  const partyAlternatives = useMemo(
    () =>
      party && state.partyMode === 'sequential'
        ? kit.partySlots.findPartySlots(state.items, basketSlots, 'parallel')
        : [],
    [kit, party, state.items, basketSlots, state.partyMode]
  );

  const singleSlots = useMemo(() => {
    if (party || primaryVisit === null) return [];
    const list = slots[primaryVisit] ?? [];
    return state.resourceId === null ? [...list] : onlyResource(list, state.resourceId);
  }, [party, primaryVisit, slots, state.resourceId]);

  /** Create a logged-in parent's new child through the site's portal route. */
  async function saveChild(child: {
    name: string;
    birthYear: number;
    birthMonth?: number;
    notes?: string;
  }): Promise<{ ok: true; child: BookingFamilyMember } | { ok: false; message: string }> {
    const copy: Record<string, string> = {
      invalid: labelText(labels['wizard.addChild.invalid']),
      session: labelText(labels['wizard.addChild.session']),
      throttled: labelText(labels['wizard.addChild.throttled']),
    };
    const unreachable = labelText(labels['wizard.addChild.unreachable']);
    try {
      const response = await fetch(`${config.paths.portalApi}/persons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(child),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        child?: BookingFamilyMember;
        reason?: string;
        message?: string;
      } | null;
      if (body?.ok === true && body.child) return { ok: true, child: body.child };
      return { ok: false, message: body?.message ?? copy[body?.reason ?? ''] ?? unreachable };
    } catch {
      return { ok: false, message: unreachable };
    }
  }

  /**
   * Step 1's «+ add child». A logged-in parent's child is created first and
   * ticked once it exists; a guest's lives in this booking.
   */
  async function addChild(child: {
    name: string;
    birthYear: number;
    birthMonth?: number;
    notes?: string;
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const named = state.people.filter((person) => person.key.startsWith('new:'));
    const seated = guardian === null ? named : state.people;
    if (seated.length >= wizard.maxPeople) {
      return { ok: false, message: fill(labels['who.family.limit'], { max: wizard.maxPeople }) };
    }
    if (guardian === null) {
      // Out of the sheet's transition first: seated inside it, the child would
      // land a render AFTER the sheet that added them has closed.
      await Promise.resolve();
      const person: WizardPerson = {
        key: `new:${Date.now()}:${named.length}`,
        name: child.name,
        birthYear: child.birthYear,
        ...(child.birthMonth === undefined ? {} : { birthMonth: child.birthMonth }),
      };
      // A named child replaces the count chips.
      dispatch({ type: 'choosePeople', people: [...named, person], advance: false });
      return { ok: true };
    }
    const saved = await saveChild(child);
    if (!saved.ok) return saved;
    setAddedChildren((current) => [...current, saved.child]);
    // Against the party as it is NOW, placed after every child the list holds.
    // A guardian is known here, so `family` is their list.
    const known = family as BookingFamilyMember[];
    dispatch({ type: 'addPerson', person: personForChild(saved.child, known.length) });
    return { ok: true };
  }

  async function submit(submission: BookingSubmission) {
    // An unresolved attempt is resent VERBATIM: the key hashes nonce AND body.
    if (pendingAttempt !== null) {
      await send(pendingAttempt.submission, pendingAttempt.submitted, { pending: true });
      return;
    }
    // Read BEFORE the await: the card describes what left the browser.
    const resourceIds = wizard.itemResourceIds(state);
    const body = withExtraServices(submission, state.items);
    if (body === null) {
      dispatch({ type: 'submitFailed', error: 'invalidInput' });
      return;
    }
    await send(body, {
      items: state.items,
      startTs: state.startTs ?? 0,
      partyMode: state.partyMode,
      resourceIds,
      stylistNames: resourceIds.map((id) => (id === null ? null : resolveStylistName(id))),
    });
  }

  /** The POST, and everything that can come back from it (also the replay's). */
  async function send(
    submission: BookingSubmission,
    submitted: SubmittedVisit,
    sendOptions?: { replay?: boolean; pending?: boolean }
  ) {
    setSubmitting(true);
    const current = attempt ?? kit.attempts.readAttempt();
    if (attempt === null) setAttempt(current);
    // Written before the request leaves: the body must be there if the answer is not.
    kit.attempts.rememberPending(current, { submission, submitted });
    setPendingAttempt({ submission, submitted });
    if (sendOptions?.replay !== true && sendOptions?.pending !== true) rebookLink.current = null;
    try {
      const response = await fetch(`${api}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...submission, window: { fromTs, toTs } }),
        ...(sendOptions?.replay === true ? { signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS) } : {}),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        bookings?: Array<{ id: string; manageToken?: string }>;
        freshSlots?: Record<string, BookingSlotDto[]>;
      } | null;

      if (!response.ok) {
        // `upstreamError` is «we still do not know»: the attempt survives it.
        const definite = payload?.error !== undefined && payload.error !== 'upstreamError';
        if (definite) {
          kit.attempts.clearAttempt();
          setPendingAttempt(null);
        }
        // `account.required` and the session gone: the login again, not an
        // error. Nothing else moves — the wizard keeps the hour, and «Bekreft»
        // turns back into the login over it.
        const sessionGone = payload?.error === 'accountRequired';
        if (sessionGone) {
          setSignedIn(null);
          setSessionLost(true);
        }
        // A RESUMED replay (or the resend of one while a link waits) has no
        // basket to rescue: a clean wizard, or the link it came by.
        const wasResumed =
          sendOptions?.replay === true ||
          (sendOptions?.pending === true && rebookLink.current !== null);
        if (wasResumed) {
          if (definite) {
            dispatch({ type: 'startOver' });
            restartFromLink();
          } else dispatch({ type: 'submitFailed', error: 'upstreamError' });
          return;
        }
        if (sessionGone) return;
        if (payload?.error === 'slotTaken') {
          // From the SUBMITTED visit: after a reload there is no live basket.
          setTakenSlotTs(submitted.startTs);
          // The cache goes too, or the time step reopens on the SAME chip:
          // replaced by the 409's live `freshSlots`, else evicted for a re-read.
          // By VISIT, as the server keys `freshSlots` and the wizard its cache.
          const lost = new Set(submitted.items.map((item) => visitKey(item)));
          const fresh = freshSlotsOf(payload?.freshSlots, lost);
          setSlots((previous) => {
            const next = { ...previous };
            for (const key of lost) {
              if (key in fresh) next[key] = fresh[key];
              else delete next[key];
            }
            return next;
          });
          // «Next available» was read out of the same stale openings.
          const canSeed = resources.length > 0;
          setSeededNextAvailable((previous) => ({
            ...Object.fromEntries(Object.entries(previous).filter(([id]) => !lost.has(id))),
            ...(canSeed
              ? Object.fromEntries(
                  Object.entries(fresh).map(([id, list]) => [id, firstOpeningPerResource(list)])
                )
              : {}),
          }));
          setFetchedNextAvailable((previous) =>
            previous !== null && lost.has(previous.key) ? null : previous
          );
          kit.attempts.clearAttempt();
          dispatch({ type: 'slotTaken' });
          return;
        }
        if (payload?.error !== undefined && payload.error !== 'upstreamError') {
          kit.attempts.clearAttempt();
        }
        dispatch({ type: 'submitFailed', error: asSubmitFailure(payload?.error) });
        return;
      }

      const bookings = payload?.bookings ?? [];
      if (!isCompleteConfirmation(bookings, submitted.items.length)) {
        // A 201 with no booking in it is not a booking, and one short of the
        // basket is not a confirmation: the attempt stays pending.
        dispatch({ type: 'submitFailed', error: 'upstreamError' });
        return;
      }
      // Every token: each is returned in plaintext exactly once.
      const confirmedBookings = bookings.map((booking) => ({
        id: booking.id,
        manageHref: booking.manageToken ? kit.paths.managePath(booking.manageToken) : null,
      }));
      setConfirmed({ bookings: confirmedBookings, submitted });
      // Kept, not cleared, so a refresh cannot take the manage links with it.
      kit.attempts.rememberConfirmed(current, { bookings: confirmedBookings, submitted });
      setPendingAttempt(null);
    } catch {
      dispatch({ type: 'submitFailed', error: 'upstreamError' });
    } finally {
      setSubmitting(false);
    }
  }

  /** «Book again» on the confirmation: a clean wizard with a fresh attempt. */
  function startOver() {
    kit.attempts.clearAttempt();
    setAttempt(kit.attempts.readAttempt());
    setPendingAttempt(null);
    // The openings were read before the booking just made: drop them.
    setSlots({});
    setSlotsFailed(false);
    setConfirmed(null);
    setTakenSlotTs(null);
    dispatch({ type: 'startOver' });
    restartFromLink();
  }

  /** A service tap on step 2 for a party of one — the first carries the link's stylist. */
  function pickService(service: BookingServiceDto) {
    const first = deepLinkPending.current && state.items.length === 0;
    deepLinkPending.current = false;
    if (first && deepLink.stylist && resources.length === 0) {
      pendingStylist.current = { serviceId: service.id, resourceId: deepLink.stylist };
    }
    if (!first) {
      dispatch({ type: 'pickService', service });
      return;
    }
    dispatch({
      type: 'prefill',
      prefill: { serviceId: service.id, resourceId: deepLink.stylist, party: null },
      catalogue: prefillCatalogue(services, resources),
    });
  }

  /** One family member's service on step 2. */
  function pickServiceFor(index: number, service: WizardService) {
    if (deepLinkPending.current) {
      deepLinkPending.current = false;
      partyStylist.current = deepLink.stylist;
    }
    dispatch({
      type: 'pickServiceFor',
      index,
      service,
      resourceServiceIds: chosenStylistServiceIds,
    });
  }

  /**
   * The multi-select card: person `index` gains `service`, or loses it if they
   * have it. Never moves the visitor — they say when their list is done with
   * `continueFromService`. The named stylist's services ride along as for
   * `pickServiceFor`, so a stylist who cannot do the longer visit is released.
   */
  function toggleServiceFor(index: number, service: WizardService) {
    if (deepLinkPending.current) {
      deepLinkPending.current = false;
      partyStylist.current = deepLink.stylist;
    }
    dispatch({
      type: 'toggleServiceFor',
      index,
      service,
      resourceServiceIds: chosenStylistServiceIds,
    });
  }

  /** «Neste» under a multi-select card: on to the hour once everybody has a service. */
  function continueFromService() {
    if (state.step !== 'service' || !wizard.canAdvance(state)) return;
    dispatch({ type: 'goToStep', step: 'when' });
  }

  function pickResource(resourceId: string | null) {
    setStylistNotice(null);
    dispatch({ type: 'pickResource', resourceId });
  }

  function pickSlot(slot: BookingSlotDto) {
    setTakenSlotTs(null);
    dispatch({ type: 'pickSlot', startTs: slot.startTs, resourceId: slot.resourceId });
  }

  function pickPartySlot(slot: PartySlot) {
    setTakenSlotTs(null);
    dispatch({
      type: 'pickPartySlot',
      startTs: slot.startTs,
      resourceIds: slot.seats.map((seat) => seat.resourceId),
      // The slot's own mode: accepting the parallel offer changes both at once.
      mode: slot.mode,
    });
  }

  /** Who a parent seats on step 1; each new child starts on «same as last time». */
  function choosePeople(people: WizardPerson[], advance: boolean) {
    dispatch({
      type: 'choosePeople',
      people,
      advance,
      services: people.map((person) => suggestionFor(person)?.service ?? null),
    });
  }

  /** The step after this one, as «Next» means it. */
  function next() {
    const order = ['who', 'service', 'when', 'details'] as const;
    const following = order[order.indexOf(state.step) + 1];
    if (following) dispatch({ type: 'goToStep', step: following });
  }

  const action = (value: WizardAction) => dispatch(value);

  return {
    kit,
    state,
    dispatch: action,
    /**
     * The parent: who arrived (`null` once the create route said the session
     * ran out), who logged in from the sheet, the merged answer, and whether
     * anybody is logged in at all (a good code whose profile read failed is).
     */
    login: {
      arrivedAs: arrivedAsNow,
      signedIn,
      guardian,
      loggedIn: signedIn !== null || arrivedAsNow !== null,
      signIn: (who: BookingGuardian | null) => setSignedIn({ guardian: who }),
      vippsConfirm,
      resumePath: vippsResumePath,
    },
    people: {
      family,
      ageDayKey,
      personAge,
      suggestionFor,
      choosePeople,
      addChild,
    },
    catalogue: {
      services,
      resources,
      resourcesKnown,
      resolveStylistName,
      chosenStylistName,
      stylistNotice,
      deepLinkCategory: deepLink.category,
    },
    slots: {
      fromTs,
      toTs,
      days,
      single: singleSlots,
      party: partySlots,
      alternatives: partyAlternatives,
      failed: slotsFailed,
      ready: haveEveryService && scheduleSettled,
      takenSlotTs,
      nextAvailableTs: party ? partyNextAvailableTs : nextAvailableTs,
      nextAvailableLoading,
    },
    schedule: { openDays: openDaysForVisit, settled: scheduleSettled },
    derived: {
      canAdvance: wizard.canAdvance(state),
      party,
      total: wizard.totalPriceOre(state.items, state.startTs),
      summary: wizard.summaryLine(state, resolveStylistName),
      visitEnd:
        state.startTs === null
          ? null
          : wizard.visitEndTs(state.items, state.startTs, state.partyMode),
    },
    pickService,
    pickServiceFor,
    toggleServiceFor,
    continueFromService,
    pickResource,
    pickSlot,
    pickPartySlot,
    next,
    submit,
    submitting,
    submissionNonce,
    confirmed,
    startOver,
    /** Ask for the openings again after a failure. */
    refresh: () => setSlotsAttempt((n) => n + 1),
    restore: { hydrated, restoring, linked, resuming },
  };
}

export type BookingController = ReturnType<typeof useBooking>;
