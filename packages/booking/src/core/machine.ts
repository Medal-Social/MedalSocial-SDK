/**
 * The wizard's brain: which step is reachable, what the sticky summary bar
 * says, and when submit is allowed. All of it lives here and nowhere else.
 *
 * Deliberately pure — no React, no fetch, no DOM — so every rule is testable
 * without rendering. `medal-client.ts` is `server-only` and must never be
 * imported from this file; the wizard runs in the browser.
 *
 * The step components (meda's `/booking` screens) are meant to be
 * presentational. If one of them would need an `if` about wizard state, that
 * `if` belongs here instead.
 *
 * Most of the machine is config-free and exported as is. `createWizard(config)`
 * binds the parts that are not: the party ceiling (`party.maxPeople`), which
 * category is the kids' path (`categories[].audience`), the weekend on the
 * business's clock, the currency, and the words the summary line uses.
 */

import { isChildCategory } from './categories';
import { createClock } from './clock';
import type { BookingConfig } from './config';
import { resourceMatches } from './deep-link';
import { fill, labelText, resolveLabels } from './labels';
import { createMoney } from './money';

/**
 * The three steps the design draws, and the three the machine holds.
 *
 * `when` is one screen and two questions — the stylist and the hour — because
 * that is what a parent answers in one breath and what the frames show as
 * «Frisør og tid». They were separate steps until the redesign, and the pair of
 * them cost a parent a whole extra «Neste» to say a thing they had already
 * decided.
 *
 * There is no `login` step, and there was one. It sat between the hour and
 * «Bekreft» and asked who the parent was — Vipps, an e-mail code, or neither —
 * at the one moment a walk-in parent least wants a decision. The login is an
 * offer in a sheet now (the login sheet), opened from a row
 * on `service` and `details`, and the machine knows nothing about it: a login
 * changes who the contact fields are filled from, never which step is next.
 */
export type WizardStep = 'who' | 'service' | 'when' | 'details';

/**
 * «Hvem skal klippes?» — step 1's answer (SP10), one entry per chair.
 *
 * The wizard used to learn who a haircut was for last, in two text fields on
 * «Bekreft», and a logged-in parent's children were a row of name chips there.
 * Asking first is what lets everything after it be ABOUT the child: step 2
 * offers «Samme som sist» for Theo, the ages that filter the menu are Theo's
 * on the appointment day, and the booking goes to Medal as Theo's person id
 * rather than a name a parent typed.
 *
 * `key` identifies the chair across edits and is never shown: `p:<id>` for a
 * saved child, `self` for the logged-in parent, `adult` for a guest adult,
 * `guest:<n>` for a guest's n-th child. Everything else is optional and ABSENT
 * rather than blank, the rule the line items follow — a guest child has no
 * name until «Bekreft» asks for one.
 */
export interface WizardPerson {
  key: string;
  /** A grown-up: no child fields on «Bekreft», the full menu on step 2. */
  adult?: boolean;
  /** Medal's id for a saved child — what `booked_for_person_id` carries. */
  personId?: string;
  name?: string;
  birthYear?: number;
  /** 1–12, when the parent gave one. */
  birthMonth?: number;
}

/** The logged-in parent themselves, on step 1's «Meg selv (voksen)». */
export const SELF_KEY = 'self';

/**
 * A seat only a GUEST's step 1 can draw: a count chip's `guest:n`, a child
 * named in the guest sheet (`new:…`), the «Voksen» chip's `adult`. A parent's
 * step 1 draws cards for saved children and «Meg selv» and nothing else — so
 * one of these under a family is a seat nobody can see or untick, counting
 * towards the three.
 */
export function isGuestSeat(person: WizardPerson): boolean {
  return person.key.startsWith('guest:') || person.key.startsWith('new:') || person.key === 'adult';
}

export interface WizardService {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  priceOre: number;
  maxPerBooking: number;
  /** Drives step 3's weekend note and the surcharged price shown on the chip. */
  weekendSurchargePct: number;
  /**
   * The salon's prep and cleanup time around this service, in minutes.
   *
   * Carried because a FAMILY needs them: two children seated back to back on
   * one stylist are separated by the first one's cleanup plus the second one's
   * prep, and `itemStartTimes` cannot honour a gap it does not know about.
   * Availability is asked per service and each opening is judged on its own, so
   * both instants can come back free while the engine refuses the combined
   * submission — a visit offered to the parent and then rejected.
   *
   * Zero is the ordinary value and the wire's own default.
   */
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /**
   * Who the service is for, in whole years, inclusive (SP10) — «Barnehageklipp»
   * up to 6, say. Used to SUGGEST, never to refuse: Medal does not reject a
   * booking on age, and a parent may know better. Absent is «any age».
   */
  ageMinYears?: number;
  ageMaxYears?: number;
}

export interface WizardItem {
  service: WizardService;
  /** The child this line is for. Asked inline in step 4. */
  bookedForName?: string;
  /** Optional fødselsår — powers "Jonas (9)" in the CRM later. */
  bookedForBirthYear?: number;
  /**
   * The saved child this line is for (SP10) — sent as `booked_for_person_id`
   * when the phone rule allows it (see the create route). Never typed: it
   * comes only from a child card on step 1.
   */
  bookedForPersonId?: string;
  /** The child's birth month, for the age on the appointment day. */
  bookedForBirthMonth?: number;
  /** A grown-up's line: «Bekreft» asks nothing about a child for it. */
  adult?: boolean;
}

export interface WizardState {
  step: WizardStep;
  /**
   * Who is coming — step 1's answer. One entry per chair, in the order the
   * line items follow: `items[i]` is `people[i]`'s haircut once every chair
   * has a service.
   */
  people: WizardPerson[];
  /**
   * Step 2's answers so far, one per person — `null` where that person has no
   * service yet. `items` is built from these and `people` only once none is
   * `null`, so a family half-way through step 2 has no basket and step 3
   * stays shut.
   */
  choices: Array<WizardService | null>;
  items: WizardItem[];
  /** null = «Første ledige» — the default, and the utilisation-maximising one. */
  resourceId: string | null;
  /**
   * Whether the stylist question has been ANSWERED, as against left at its
   * default.
   *
   * `resourceId` cannot say. `null` is «Første ledige», which is both the value
   * a fresh wizard starts on and a real choice a parent makes by tapping «Alle»
   * — and while the stylist and the hour were separate steps the difference was
   * legible in `step` alone: a visitor who had answered was on `time`. One
   * screen for both questions took that away, and the thing that noticed is
   * `applyPrefill`, whose whole contract is «fills blanks, never overwrites»:
   * without this a «Bestill igjen» link naming Sara would land on a parent who
   * had just tapped «Alle» and quietly replace their answer.
   *
   * Set by `pickResource` either way, and by the parallel `setPartyMode` — «two
   * stylists at once» is an answer about who cuts the hair even though it
   * clears the preference. Cleared whenever the preference itself is cleared
   * for a reason the parent did not choose: a replaced basket, or a sibling the
   * named stylist cannot take.
   */
  stylistAnswered: boolean;
  partyMode: 'sequential' | 'parallel';
  startTs: number | null;
  resolvedResourceId: string | null;
  /**
   * The stylist each line resolved to, in basket order — the half of a party
   * slot that `resolvedResourceId` cannot hold.
   *
   * `null` for everything except a party slot chosen on step 3, where
   * `resolvedResourceId` still answers for the whole visit. Non-null it is one
   * id per line item, and it is what a parallel party actually needs: two
   * children seen at the same instant are seen by two *different* stylists, so
   * there is no single id that describes the visit.
   *
   * Read through `itemResourceIds` rather than directly, so the submission and
   * the confirmation card cannot disagree about who is cutting whose hair.
   */
  partyResourceIds: string[] | null;
  contact: { phone: string; name: string; email: string };
  notes: string;
  consentTerms: boolean;
  consentMarketing: boolean;
  /**
   * A code, never a sentence. The Norwegian copy for each case belongs to the
   * component that shows it, so the same rule can be a toast in one place and
   * inline text in another without this file knowing either.
   *
   * Wider than what `reduce` can currently produce, on purpose. The submit route
   * answers with `conflict`, `invalidInput`, `unconfigured` and `upstreamError`
   * as well as `slotTaken`, and those have to land somewhere. Somewhere is here:
   * if the union only admitted what this file raises, the details step would grow
   * a second error slot of its own and the sticky bar and the form would start
   * disagreeing about whether anything is wrong.
   *
   * `upstreamError` is the create route's 502 — Medal answered something this
   * site has no mapping for, or did not answer at all. It is an outage rather
   * than a mistake the visitor made, but it arrives with them waiting on a
   * button they have just pressed, so it needs a sentence of its own rather
   * than being folded into `conflict` — which says «prøv en gang til», and
   * trying again is exactly what will not help here.
   */
  /**
   * A service a link named for a parent whose family is known, held until
   * step 1 says who it is for (`holdService`). Each person seated after that
   * starts on it where it suits them — a kids' service for a child, anything
   * else for a grown-up — instead of a guest chair being invented for it.
   */
  pendingService: WizardService | null;
  error:
    | 'maxParty'
    | 'slotTaken'
    | 'conflict'
    | 'invalidInput'
    | 'unconfigured'
    | 'upstreamError'
    /**
     * The create route's 409 for a submission Medal already holds under its
     * key: it may well be booked, so the parent is sent to their e-mail
     * rather than to the button.
     */
    | 'inProgress'
    | null;
}

export type WizardAction =
  /**
   * Back to an empty wizard, for «Bestill ny time» on the confirmation.
   *
   * A parent who has just booked one child and needs a SEPARATE appointment —
   * another service whose `maxPerBooking` is 1, or a sibling who wants a
   * different hour — has to be able to start over. The confirmation is now
   * restored across a reload, so without this the only ways out of it are
   * closing the tab or waiting for the stored attempt to age out.
   */
  | { type: 'startOver' }
  /**
   * Step 1's answer: who is coming. Replaces the party; a person who stays
   * (the same `key`) keeps the service already chosen for them, so going back
   * to add a sibling does not re-ask the first child. `advance` moves on to
   * step 2 — a guest's «2 barn» chip is one tap, a logged-in parent ticks
   * children and presses «Neste».
   */
  | {
      type: 'choosePeople';
      people: WizardPerson[];
      advance?: boolean;
      /**
       * «Samme som sist»: a service to start each person NEW to the party on,
       * aligned with `people` — the child's last haircut, where the shell
       * knows one. A person already in the party keeps their own answer.
       */
      services?: ReadonlyArray<WizardService | null>;
    }
  /**
   * Step 2's answer for ONE person. For a party of one it is the old one-tap
   * `pickService` and moves on; for a family it fills that child's line and
   * waits for the rest. `resourceServiceIds` is `addService`'s: what the named
   * stylist can do, so a service they cannot do releases the preference.
   */
  | {
      type: 'pickServiceFor';
      index: number;
      service: WizardService;
      resourceServiceIds?: readonly string[];
    }
  | { type: 'pickService'; service: WizardService }
  /**
   * The parent's family has appeared (a login, a guardian read after the
   * first render) or step 1 is shown again under it: the guest seats go —
   * see `isGuestSeat` — and a guest «Voksen» becomes «Meg selv». Only while
   * nothing is held on them (steps 1 and 2); from the hour on they are real
   * chairs with a time, and «Bekreft» names them. A party emptied by it goes
   * back to step 1, where the children are.
   */
  | { type: 'seatFamily' }
  /**
   * One person joins the party as it is WHEN this lands — a child the parent
   * just created in Medal, after the await. Refused at the limit, a no-op for
   * somebody already seated.
   */
  | { type: 'addPerson'; person: WizardPerson }
  /** A link's service, held for the people step 1 is about to seat — see `pendingService`. */
  | { type: 'holdService'; service: WizardService | null }
  /**
   * A sibling, added on step 1 — and the one fact about the stylist catalogue
   * this file is allowed to know.
   *
   * `resourceServiceIds` is what the currently preferred stylist can do. It
   * rides on the action because the alternative was worse in both directions:
   * the machine cannot fetch the catalogue, and a shell that cleared the
   * preference itself would need an action that changes `resourceId` without
   * moving the visitor off step 1, which `pickResource` is not.
   *
   * Absent is «the caller does not know», not «the stylist does nothing». A
   * missing list keeps the preference, because silence is not evidence.
   */
  | { type: 'addService'; service: WizardService; resourceServiceIds?: readonly string[] }
  | { type: 'pickResource'; resourceId: string | null }
  | { type: 'pickSlot'; startTs: number; resourceId: string | null }
  /**
   * How the party is seen — step 2's second question, and the one that decides
   * which search step 3 runs.
   *
   * Its own action rather than a field on `pickResource`, because the two
   * answers are independent: «Sara» and «rett etter hverandre» are one visit,
   * and a parent who changes only the mode has not changed their mind about
   * the stylist.
   */
  | { type: 'setPartyMode'; mode: WizardState['partyMode'] }
  /**
   * A whole family seated in one tap: the instant the visit starts and the
   * stylist each child got.
   *
   * Separate from `pickSlot` because a party slot answers a question
   * `pickSlot` has no room for. `pickSlot` carries one resolved stylist, which
   * is all a single booking ever has; a party in `parallel` has one per child
   * and they are deliberately different people.
   *
   * `resourceIds` is one id per line item, in basket order — never null,
   * because a slot that cannot name the two stylists cannot promise that two
   * children are seen at once.
   *
   * `mode` travels with the slot rather than being read off the state, and it
   * is what makes step 3's «men begge kan tas samtidig kl. 15:00» work: that
   * offer appears while the machine still says `sequential`, and seating a
   * parallel slot sequentially would submit the second child half an hour
   * after a stylist who is free at the hour itself. Carrying it here also
   * removes the ordering trap — `setPartyMode` clears the slot, so a caller
   * that dispatched the two actions the other way round would throw away the
   * time the parent had just accepted.
   */
  | {
      type: 'pickPartySlot';
      startTs: number;
      resourceIds: string[];
      mode: WizardState['partyMode'];
    }
  | { type: 'slotTaken' }
  /**
   * A submission the create route refused, in the vocabulary `WizardState.error`
   * already speaks.
   *
   * Without it the four codes below are a union nothing can produce: the route
   * answers `conflict`, `invalidInput`, `unconfigured` and `upstreamError`, and
   * step 4 has a Norwegian sentence for each, but there was no action that could
   * put one into `state.error` — so the failure would have had to be held beside
   * the machine, in a second error slot the machine's own clearing rules never
   * touch.
   *
   * `slotTaken` and `maxParty` are excluded rather than admitted. Each already
   * has an action that does more than raise a code — `slotTaken` drops the slot
   * and sends the visitor back to step 3, `addService` refuses the child while
   * leaving the ones already chosen alone — and a second spelling of either is
   * how a stolen slot ends up raised without the slot being dropped.
   */
  | {
      type: 'submitFailed';
      error: Exclude<NonNullable<WizardState['error']>, 'slotTaken' | 'maxParty'>;
    }
  | { type: 'goToStep'; step: WizardStep }
  | { type: 'setContact'; field: keyof WizardState['contact']; value: string }
  /**
   * The two answers about the child, written onto the line item they belong to.
   *
   * Indexed rather than keyed by service, because two children in one party can
   * genuinely share a service and the index is the only thing that tells those
   * rows apart — the same reason step 4 keys its fields on it.
   *
   * Split over the two fields rather than taking a `Partial<WizardItem>`, so a
   * caller cannot reach through this action and overwrite `service`, which is
   * step 1's answer and not step 4's to change.
   */
  | { type: 'setItemField'; index: number; field: 'bookedForName'; value: string }
  /** `null` is «cleared», which an emptied year input is and `undefined` would
   * be ambiguous about — a patch that says nothing versus one that says nothing
   * is there. */
  | { type: 'setItemField'; index: number; field: 'bookedForBirthYear'; value: number | null }
  /** A saved child picked for a guest line on «Bekreft» (a family chip); `null` detaches. */
  | { type: 'setItemField'; index: number; field: 'bookedForPersonId'; value: string | null }
  | { type: 'setNotes'; value: string }
  /** One action for both boxes rather than two near-identical ones: they are the
   * same gesture, and the pair that must never be confused — a marketing opt-in
   * standing in for terms — is harder to write by accident when the difference
   * is a required discriminant. */
  | { type: 'setConsent'; which: 'terms' | 'marketing'; accepted: boolean }
  /**
   * A «Bestill igjen» link, applied. The shell dispatches this rather than
   * calling `applyPrefill` on the state it holds, because `useReducer` is the
   * only writer of that state — see `applyPrefill` for the rules.
   */
  | { type: 'prefill'; prefill: WizardPrefill; catalogue: WizardCatalogue };

/**
 * What a `/min-side` «Bestill igjen» link can carry into the wizard:
 * `?service=<id>&stylist=<id>` off the query string, and the child's name
 * from the tab's session store (`rebook-store.ts`) — never from the URL.
 *
 * Every field is optional AND nullable, because `URLSearchParams.get` answers
 * `null` for a missing key and the shell should not have to translate that.
 * An empty string means the same as absent.
 */
export interface WizardPrefill {
  serviceId?: string | null;
  /** An id, or — from a «Bestill hos Siv» link — a display name or its slug. */
  resourceId?: string | null;
  who?: string | null;
  /**
   * `?antall=`: how many children. Clamped to the service's `maxPerBooking`
   * and only meaningful for a kids' service, where it pre-creates that many
   * lines; ignored for anything else.
   */
  party?: number | null;
}

/**
 * What a prefill is checked against — the services step 1 would let the visitor
 * tap, and the stylists step 2 would show for them.
 *
 * The SHELL decides what goes in here, and that is the point: the machine has
 * no `bookableOnline` and no fetched stylist list, so «this id is one the
 * visitor could have chosen» is a fact only the caller can supply. An id absent
 * from the catalogue is ignored, whatever the link said.
 */
export interface WizardCatalogue {
  services: readonly WizardService[];
  resources: ReadonlyArray<{ id: string; name?: string; serviceIds: readonly string[] }>;
}

/**
 * The engine's own bound on `booked_for_name` — `maxLength: 200` in the SDK's
 * OpenAPI document. Step 4's input has no `maxLength`, so this is the one limit
 * that exists, and a prefilled name is cut to it rather than being carried into
 * a body the engine answers 400 to.
 */
export const BOOKED_FOR_NAME_MAX_LENGTH = 200;

const SEPARATOR = ' · ';

/** Stands in for a part the visitor has not chosen yet, so the bar keeps its
 * shape as they fill it in rather than growing under their thumb. */
const UNCHOSEN = '—';

export function initialState(): WizardState {
  return {
    step: 'who',
    people: [],
    choices: [],
    items: [],
    resourceId: null,
    stylistAnswered: false,
    partyMode: 'sequential',
    startTs: null,
    resolvedResourceId: null,
    partyResourceIds: null,
    contact: { phone: '', name: '', email: '' },
    notes: '',
    consentTerms: false,
    consentMarketing: false,
    pendingService: null,
    error: null,
  };
}

/**
 * The strictest service involved sets the party limit — and the service about to
 * be added counts, not just the ones already chosen. Mirroring the engine rather
 * than inventing a ceiling: `bookings.ts` takes `Math.min` over every service in
 * the request and imposes no cap of its own, so the salon's real ceiling is
 * whatever it seeded (`maxPerBooking: 3` for `barn`, 1 for everything else). A
 * hardcoded number here would be a second, invisible rule that silently
 * disagreed with the salon's the day they changed it.
 *
 * Counting the incoming service is what lets a strict one refuse at the tap
 * instead of at submit — the engine's own worked example is that a service with
 * `maxPerBooking: 1` cannot ride along in a party of four. It also disposes of
 * `Math.min()`-of-nothing: the spread always holds at least the incoming
 * service, so an empty basket yields that service's own limit rather than
 * `Infinity`, and `addService` cannot append forever.
 */
function partyLimit(items: WizardItem[], incoming: WizardService): number {
  return Math.min(incoming.maxPerBooking, ...items.map((item) => item.service.maxPerBooking));
}

/** The one stylist a seating chart names throughout, or `null` when it names
 * more than one. An empty chart has nobody, which is also `null`. */
function sharedResourceId(resourceIds: string[]): string | null {
  const [first] = resourceIds;
  if (first === undefined) return null;
  return resourceIds.every((id) => id === first) ? first : null;
}

/**
 * What `addService` does to the stylist preference: nothing, or release it.
 *
 * A patch rather than a boolean, so the case below spreads one expression and
 * says what it means — and so the empty object is the ordinary answer, which is
 * the point: adding a sibling is not a change of mind about Sara.
 *
 * `resourceServiceIds` absent is «the caller could not say», and it keeps the
 * preference. That direction is deliberate: a wizard whose stylist catalogue has
 * not loaded knows nothing about who does what, and discarding an answer the
 * visitor gave on the strength of that would be a guess dressed as a safeguard.
 * The catalogue is loaded by the time a stylist can be tapped at all, so the
 * case is a caller other than the wizard rather than a race.
 */
function stylistAfterAdd(action: Extract<WizardAction, { type: 'addService' }>): {
  resourceId?: null;
  stylistAnswered?: false;
} {
  const canServe =
    action.resourceServiceIds === undefined ||
    action.resourceServiceIds.includes(action.service.id);
  // Releasing the preference un-answers the question with it: the parent chose
  // Sara and the machine took her away, so the next thing that can fill the
  // blank — a «Bestill igjen» link, say — is filling a genuine blank.
  return canServe ? {} : { resourceId: null, stylistAnswered: false };
}

/**
 * A chosen slot belongs to the question it was chosen under, so every action
 * that changes that question has to drop it — the basket, the seating mode, and
 * the stylist alike. Adding a second child doubles the duration being asked for;
 * swapping the service changes it outright; naming a different stylist points it
 * at somebody else's diary. Either way the time the visitor tapped is no longer
 * a time the salon ever offered them.
 *
 * Left in place this stays invisible until the progress dots become tappable,
 * and then it is a genuinely bad bug rather than an untidy one: `canGoToStep`
 * treats any non-null `startTs` as reason enough to reach `details`, so going
 * back, changing an answer and jumping straight forward submits against a slot
 * that answered the old question — with the summary bar quoting the stale time
 * as if it were confirmed.
 *
 * This spread deliberately does NOT touch `resourceId`, because that is a
 * separate answer and each caller has its own view of it:
 *
 * - `pickResource` writes it — it *is* the new answer.
 * - `pickService` clears it, because the basket was replaced and step 2 only
 *   offers stylists who can do every service in it.
 * - `setPartyMode` clears it for `parallel`, which is two stylists by
 *   construction.
 * - `addService` keeps it, unless the child being added is one the named stylist
 *   cannot take. A parent adding a sibling has not changed their mind about
 *   Sara, so clearing unconditionally would re-ask every family in the common
 *   case where she can do both — but keeping it unconditionally left step 2 with
 *   nothing selected and step 3 filtered to somebody who cannot take the visit,
 *   which is «Fullt» on every day of the week at a salon with a free chair.
 *   The catalogue that tells the two apart is a fetch result the shell holds and
 *   this file cannot reach, so it arrives on the action as
 *   `resourceServiceIds`; absent, the preference is kept.
 *
 * `partyResourceIds` is the other half of a chosen slot and goes with it. Left
 * behind it would be a seating chart for a party that no longer has that many
 * children in it, and `itemResourceIds` would hand the submission a stylist for
 * a line item that does not exist.
 */
const clearedSlot = { startTs: null, resolvedResourceId: null, partyResourceIds: null };

/** The guest child in chair `n` (1-based) — a chip on step 1, or a sibling a link added. */
export function guestChild(n: number): WizardPerson {
  return { key: `guest:${n}` };
}

/** A person as a line item: the service, and what is known about who sits in the chair. */
function itemFor(person: WizardPerson, service: WizardService): WizardItem {
  return {
    service,
    ...(person.name === undefined ? {} : { bookedForName: person.name }),
    ...(person.birthYear === undefined ? {} : { bookedForBirthYear: person.birthYear }),
    ...(person.personId === undefined ? {} : { bookedForPersonId: person.personId }),
    ...(person.birthMonth === undefined ? {} : { bookedForBirthMonth: person.birthMonth }),
    ...(person.adult ? { adult: true } : {}),
  };
}

function basketOf(items: readonly WizardItem[]): string {
  return items.map((item) => item.service.id).join('|');
}

/**
 * `people` and `choices` in, the basket out — the one place `items` is built
 * from them. A basket whose services changed drops the slot, for the reason
 * `clearedSlot` gives; one that only changed WHO (a name typed on «Bekreft»,
 * say) keeps it.
 */
function withParty(
  state: WizardState,
  people: WizardPerson[],
  choices: Array<WizardService | null>
): WizardState {
  const complete = people.length > 0 && choices.every((choice) => choice !== null);
  const items = complete
    ? people.map((person, index) => itemFor(person, choices[index] as WizardService))
    : [];
  const changed = basketOf(items) !== basketOf(state.items);
  return { ...state, people, choices, items, ...(changed ? clearedSlot : {}) };
}

/** The people behind a basket built without step 1 — a link, a restored draft. */
function peopleFor(state: WizardState, count: number): WizardPerson[] {
  return Array.from({ length: count }, (_, index) => state.people[index] ?? guestChild(index + 1));
}

/**
 * One field of one line item, written the way the engine will have to read it:
 * **absent**, never blank.
 *
 * `booked_for_name` is `z.string().trim().min(1).optional()` upstream, where
 * `''` is a 400 rather than a shrug, and `booked_for_birth_year` is
 * `z.number().optional()`, which refuses the `null` an emptied input serialises
 * to. Storing the emptiness here and coalescing it at the edge would hold
 * exactly until something other than the create route read these items — the
 * confirmation card already does, to write «Gutteklipp for Jonas» — so the
 * emptiness never gets in.
 */
function withItemField(
  item: WizardItem,
  action: Extract<WizardAction, { type: 'setItemField' }>
): WizardItem {
  const next = { ...item };
  if (action.field === 'bookedForPersonId') {
    if (action.value !== null && action.value !== '') next.bookedForPersonId = action.value;
    else delete next.bookedForPersonId;
    return next;
  }
  if (action.field === 'bookedForName') {
    const trimmed = action.value.trim();
    if (trimmed.length > 0) next.bookedForName = trimmed;
    else delete next.bookedForName;
    return next;
  }
  // `Number.isFinite` rather than a truthiness test: a birth year is never 0,
  // but `NaN` is exactly what parsing «tjue» out of a text field yields, and it
  // passes every looser check on its way to a body the engine rejects.
  if (action.value !== null && Number.isFinite(action.value)) {
    next.bookedForBirthYear = action.value;
  } else {
    delete next.bookedForBirthYear;
  }
  return next;
}

/** The typed answers about a guest child, carried back onto their person. */
function withPersonFields(person: WizardPerson, item: WizardItem): WizardPerson {
  const { name: _name, birthYear: _year, personId: _id, ...rest } = person;
  return {
    ...rest,
    ...(item.bookedForName === undefined ? {} : { name: item.bookedForName }),
    ...(item.bookedForBirthYear === undefined ? {} : { birthYear: item.bookedForBirthYear }),
    ...(item.bookedForPersonId === undefined ? {} : { personId: item.bookedForPersonId }),
  };
}

/** `seatFamily` — see the action. */
function seatFamily(state: WizardState): WizardState {
  if (state.step !== 'who' && state.step !== 'service') return state;
  if (!state.people.some(isGuestSeat)) return state;
  const people: WizardPerson[] = [];
  const choices: Array<WizardService | null> = [];
  state.people.forEach((person, index) => {
    const seat = person.key === 'adult' ? { key: SELF_KEY, adult: true } : person;
    if (isGuestSeat(seat) || people.some((other) => other.key === seat.key)) return;
    people.push(seat);
    choices.push(state.choices[index] ?? null);
  });
  return {
    ...withParty(state, people, choices),
    step: people.length === 0 ? 'who' : state.step,
    error: null,
  };
}

/** `pickServiceFor` — see the action. */
function pickServiceFor(
  state: WizardState,
  action: Extract<WizardAction, { type: 'pickServiceFor' }>
): WizardState {
  if (!state.people[action.index] && !(action.index === 0 && state.people.length === 0)) {
    return state;
  }
  // A party of one is the old one-tap service card: select and move on.
  if (state.people.length <= 1) {
    const person = state.people[0] ?? guestChild(1);
    return {
      ...withParty(state, [person], [action.service]),
      ...clearedSlot,
      resourceId: null,
      stylistAnswered: false,
      step: 'when',
      error: null,
    };
  }
  // A family: the strictest service sets the limit, as `addService` has it.
  if (action.service.maxPerBooking < state.people.length) {
    return { ...state, error: 'maxParty' };
  }
  const choices = state.choices.map((choice, index) =>
    index === action.index ? action.service : choice
  );
  const canServe =
    action.resourceServiceIds === undefined ||
    action.resourceServiceIds.includes(action.service.id);
  return {
    ...withParty(state, state.people, choices),
    ...(canServe ? {} : { resourceId: null, stylistAnswered: false }),
    error: null,
  };
}

/** The wizard in order. Both `canGoToStep` and the progress dots read the
 * sequence from here rather than restating it, so a fourth step cannot be added
 * to one of them and forgotten in the other. */
const STEP_ORDER: readonly WizardStep[] = ['who', 'service', 'when', 'details'];

/**
 * Whether a given step has been answered. One definition, asked two ways —
 * `canAdvance` asks it about the step the visitor is on, `canGoToStep` asks it
 * about the ones behind the step they want. Keeping it in a single function is
 * what stops "step 3 is done" from meaning one thing to the Neste button and
 * another to the progress dots.
 */
function isSatisfied(state: WizardState, step: WizardStep): boolean {
  switch (step) {
    case 'who':
      // A basket built without step 1 — a link, a restored draft — has its
      // people too (`peopleFor`), so this is never the thing that shuts it.
      return state.people.length > 0 || state.items.length > 0;

    case 'service':
      return state.items.length > 0;

    case 'when':
      // The hour, and only the hour. The stylist half of this step has no
      // unanswered state — `null` is «Første ledige», which is both the default
      // and the choice the salon would rather you made — so a visit is settled
      // the moment an instant has been tapped.
      return state.startTs !== null;

    case 'details':
      // Trimmed: a phone field holding only the +47 prefix and a space is not a
      // phone number, and it is exactly what an abandoned form leaves behind.
      return state.contact.phone.trim().length > 0 && state.consentTerms;
  }
}

/**
 * True when the visitor may leave the current step — and on `details`, when they
 * may submit at all. Answers about `state.step` only, so a Neste button can be
 * `disabled={!canAdvance(state)}` and nothing else.
 */
export function canAdvance(state: WizardState): boolean {
  return isSatisfied(state, state.step);
}

/**
 * True when a step may be jumped to directly — the predicate behind whether a
 * progress dot is tappable, and the guard `goToStep` applies to itself.
 *
 * Bounded by what is *behind* the target, never the target itself: reaching
 * `details` requires a service and a time, but obviously not the contact
 * details you are going there to type. Going back is therefore always allowed,
 * because nothing precedes `service` — which is the case that matters, since
 * back is what the dots are mostly for.
 */
export function canGoToStep(state: WizardState, step: WizardStep): boolean {
  const index = STEP_ORDER.indexOf(step);
  // A step that is not in the order — a stale caller still naming the old
  // `login` step, say — is unreachable rather than `slice(0, -1)`: that would
  // ask about every step but the last and wave it through.
  if (index === -1) return false;
  return STEP_ORDER.slice(0, index).every((prior) => isSatisfied(state, prior));
}

/**
 * When each child in the party sits down.
 *
 * `sequential` is the report's default and the ordinary case — one stylist,
 * «rett etter hverandre», so the second child starts when the first is
 * finished. `parallel` is two stylists at once, and every line starts together.
 *
 * The engine takes a `start_ts` per line item rather than one for the visit, so
 * somebody has to do this arithmetic, and it is a rule about the booking rather
 * than about a screen. Step 4 submits with it and the confirmation card reads
 * «15:00 Jonas / 15:30 Emma» off the same function, which is the only way those
 * two can be made to agree.
 *
 * Task 9 owns the slot SEARCH for a party; this is only the seating of a slot
 * already chosen.
 */
export function itemStartTimes(
  items: WizardItem[],
  startTs: number,
  partyMode: WizardState['partyMode']
): number[] {
  let offset = 0;
  return items.map(({ service }, index) => {
    // The gap between two children on one chair is not the first cut's length.
    // It is that length PLUS the salon's cleanup after it PLUS the prep before
    // the next one — the interval the engine actually reserves. Advancing by
    // the duration alone seats the second child inside the first one's buffer,
    // and because availability is asked per service and each opening judged on
    // its own, both instants come back free while the engine refuses the
    // combined submission. The family is offered a visit that cannot be made,
    // and offered it again every time they try.
    if (partyMode === 'sequential' && index > 0) {
      const previous = items[index - 1].service;
      offset +=
        (previous.durationMinutes + previous.bufferAfterMinutes + service.bufferBeforeMinutes) *
        60_000;
    }
    return startTs + offset;
  });
}

/**
 * How long the family is in the salon — the number the summary bar quotes as
 * «60 min totalt» and the length of the .ics entry.
 *
 * The two modes are two different visits: `sequential` is one chair used twice,
 * so the minutes add up, while `parallel` is two chairs at once and the family
 * leaves when the *longest* cut finishes. Quoting the sum for a parallel party
 * would tell a parent to set aside an hour for a visit that takes half of one,
 * which is the whole reason «To frisører samtidig» is worth offering.
 *
 * `Math.max` seeded with 0 rather than spread over the durations alone:
 * `Math.max()` of nothing is `-Infinity`, and an empty basket is a visit of no
 * length rather than a negative one.
 */
export function visitMinutes(items: WizardItem[], partyMode: WizardState['partyMode']): number {
  if (partyMode === 'parallel') {
    return Math.max(0, ...items.map(({ service }) => service.durationMinutes));
  }
  // The inner gaps count, for the same reason `itemStartTimes` applies them: the
  // family is in the salon from the first cut starting to the last one ending,
  // and the second child cannot sit down until the chair is ready. The buffer
  // AFTER the last child is not part of it — they have left by then.
  return items.reduce(
    (total, { service }, index) =>
      total +
      service.durationMinutes +
      (index === 0 ? 0 : items[index - 1].service.bufferAfterMinutes + service.bufferBeforeMinutes),
    0
  );
}

/**
 * How much EARLIER a family has to start than a single first child would.
 *
 * The schedule endpoint answers for one service, so `lastStartTs` is «the last
 * start a Gutteklipp fits» — the last minute at which that service's prep,
 * duration and cleanup all land inside the day's window. A family needs its
 * whole chain to fit, so its own last start is earlier by exactly the part of
 * the chain that hangs off the end of the first child's busy span.
 *
 * NOT `visitMinutes - firstDuration`, which was the first attempt and is wrong
 * in a way that only shows on a mixed basket: `visitMinutes` deliberately
 * excludes the LAST child's cleanup — the family has left by then — so the
 * subtraction silently keeps the FIRST child's cleanup in place of the last
 * one's. Where the later service has the bigger `bufferAfterMinutes` the cutoff
 * comes out too late, which is the error in the direction that matters: it says
 * «Fullt» about an afternoon that is actually over.
 *
 * Sequential is the tail of the chain: every child after the first costs their
 * prep, their duration and their cleanup, and the first child's own cleanup is
 * already inside the number being adjusted. Parallel is one chair each, so what
 * has to fit is the LONGEST busy span rather than the sum.
 */
export function visitTailMinutes(items: WizardItem[], partyMode: WizardState['partyMode']): number {
  const first = items[0]?.service;
  if (first === undefined || items.length < 2) return 0;
  const busy = (service: WizardService) =>
    service.bufferBeforeMinutes + service.durationMinutes + service.bufferAfterMinutes;

  if (partyMode === 'parallel') {
    return Math.max(0, Math.max(...items.map(({ service }) => busy(service))) - busy(first));
  }
  return items
    .slice(1)
    .reduce(
      (total, { service }) =>
        total + service.bufferBeforeMinutes + service.durationMinutes + service.bufferAfterMinutes,
      0
    );
}

/** When the family leaves. The same arithmetic as `visitMinutes`, which is why
 * it is that function and not a second copy of it: an .ics that ended before
 * `visitMinutes` said the visit did would tell a calendar the parent was free
 * while a child was still in the chair. */
export function visitEndTs(
  items: WizardItem[],
  startTs: number,
  partyMode: WizardState['partyMode']
): number {
  return startTs + visitMinutes(items, partyMode) * 60_000;
}

/**
 * Whether step 2 asks how the party is seen.
 *
 * One child is not a party, and «Samme frisør, rett etter hverandre» is not a
 * choice when there is nobody to be after. The machine answers rather than the
 * component so that the picker and the search cannot disagree about when a
 * booking has become a family visit.
 */
export function showsPartyMode(state: WizardState): boolean {
  return state.items.length > 1;
}

/**
 * Who is cutting whose hair, one answer per line item.
 *
 * The single reader for both shapes the machine can be in: a party slot names a
 * stylist per child, and everything else has one answer for the whole visit —
 * including `null`, which is «Første ledige» still to be resolved by the engine.
 *
 * Step 4's submission and the confirmation card both read it, which is the only
 * way «hos Marcus» on the card can be guaranteed to be the `resource_id` that
 * was actually booked for that child.
 */
export function itemResourceIds(state: WizardState): Array<string | null> {
  return state.partyResourceIds ?? state.items.map(() => state.resolvedResourceId);
}

/**
 * The stylist, as a person rather than as a row id.
 *
 * The machine holds ids — that is what step 2 chose and what the availability
 * query filters on — so naming one takes the catalogue, which is a fetch result
 * and not a rule. Hence the resolver: the caller already has the stylists it
 * rendered on step 2, and an id it cannot name comes back `null` rather than
 * putting `res-7f3a…` under the visitor's thumb.
 *
 * `resolvedResourceId` wins where both are set, because it is who the visitor
 * actually got. That is also what fills this part in for «Første ledige», which
 * is a null preference and stays a dash until a slot resolves it to somebody.
 */
function stylistLabel(
  state: WizardState,
  resolveStylistName: (resourceId: string) => string | null
): string | null {
  const resourceId = state.resolvedResourceId ?? state.resourceId;
  return resourceId === null ? null : resolveStylistName(resourceId);
}

export type WizardConfig = Pick<
  BookingConfig,
  | 'party'
  | 'categories'
  | 'fallbackCategory'
  | 'timeZone'
  | 'locale'
  | 'currency'
  | 'dayparts'
  | 'labels'
>;

export interface Wizard {
  /**
   * The most chairs one visit can take (`party.maxPeople`). The business's own
   * ceiling is per service (`maxPerBooking`), and step 2 still honours it; this
   * is the ceiling of the question on step 1, before any service is known.
   */
  readonly maxPeople: number;
  initialState: typeof initialState;
  reduce(state: WizardState, action: WizardAction): WizardState;
  applyPrefill(state: WizardState, prefill: WizardPrefill, catalogue: WizardCatalogue): WizardState;
  canAdvance: typeof canAdvance;
  canGoToStep: typeof canGoToStep;
  itemPriceOre(service: WizardService, startTs: number | null): number;
  totalPriceOre(items: WizardItem[], startTs: number | null): number;
  itemStartTimes: typeof itemStartTimes;
  visitMinutes: typeof visitMinutes;
  visitTailMinutes: typeof visitTailMinutes;
  visitEndTs: typeof visitEndTs;
  showsPartyMode: typeof showsPartyMode;
  itemResourceIds: typeof itemResourceIds;
  summaryLine(
    state: WizardState,
    resolveStylistName: (resourceId: string) => string | null,
    now?: number
  ): string;
  guestChild: typeof guestChild;
  isGuestSeat: typeof isGuestSeat;
}

/** The machine for one site: its party ceiling, kids' categories, clock, currency and words. */
export function createWizard(config: WizardConfig): Wizard {
  const maxPeople = config.party.maxPeople;
  const clock = createClock(config);
  const money = createMoney(config);
  const labels = resolveLabels(config.locale, config.labels);

  /** `choosePeople` — see the action. */
  function choosePeople(
    state: WizardState,
    action: Extract<WizardAction, { type: 'choosePeople' }>
  ): WizardState {
    if (action.people.length > maxPeople) return { ...state, error: 'maxParty' };
    // A person who stays keeps their service; a new one has none yet.
    const before = (person: WizardPerson) =>
      state.people.findIndex((previous) => previous.key === person.key);
    const choices = action.people.map((person, position) => {
      const index = before(person);
      if (index !== -1) return state.choices[index] ?? null;
      // The link the parent followed beats «Samme som sist»: it is what they
      // asked for a moment ago.
      return heldFor(state.pendingService, person) ?? action.services?.[position] ?? null;
    });
    // A guest chair that stays keeps what «Bekreft» was told about it: going
    // back and tapping «2 barn» again must not forget the names typed.
    const people = action.people.map((person) => {
      const index = before(person);
      return index === -1 || person.personId !== undefined
        ? person
        : { ...state.people[index], ...person };
    });
    // The stylist preference stays: every service chosen for a NEW person goes
    // through `pickServiceFor`, which releases a stylist who cannot do it —
    // adding a sibling is not a change of mind about Sara.
    return {
      ...withParty(state, people, choices),
      step: action.advance ? 'service' : state.step,
      error: null,
    };
  }

  /** The held link service, if it suits this person: kids' cuts for children only. */
  function heldFor(service: WizardService | null, person: WizardPerson): WizardService | null {
    if (service === null) return null;
    const forChildren = isChildCategory(config, service.category);
    return forChildren === !person.adult ? service : null;
  }

  /** `addPerson` — see the action. */
  function addPerson(state: WizardState, person: WizardPerson): WizardState {
    if (state.people.some((other) => other.key === person.key)) return state;
    if (state.people.length >= maxPeople) return { ...state, error: 'maxParty' };
    return choosePeople(state, { type: 'choosePeople', people: [...state.people, person] });
  }

  function reduce(state: WizardState, action: WizardAction): WizardState {
    switch (action.type) {
      case 'startOver':
        // `initialState()` rather than a hand-written blank: a field added there
        // and forgotten here is one the second booking would silently inherit
        // from the first.
        return initialState();

      case 'choosePeople':
        return choosePeople(state, action);

      case 'pickServiceFor':
        return pickServiceFor(state, action);

      case 'seatFamily':
        return seatFamily(state);

      case 'addPerson':
        return addPerson(state, action.person);

      case 'holdService':
        return { ...state, pendingService: action.service };

      case 'pickService':
        // One tap, not two: tapping a card both selects and advances. Picking
        // *replaces* the basket so that changing your mind on step 1 cannot
        // quietly leave the previous service booked alongside the new one.
        //
        // And the stylist goes with it, unlike every other user of `clearedSlot`.
        // Step 2 only offers stylists who can do EVERY service in the basket, so a
        // preference recorded against the old one may name somebody the new list
        // does not contain: the card is gone from the screen, nothing reads as
        // selected, and «Neste» is enabled anyway — because `isSatisfied` treats
        // any answer as an answer. The visitor lands on step 3 with availability
        // filtered to a stylist who cannot do this service, sees «Fullt» on every
        // day of the week, and is handed the telephone by a salon that is open.
        //
        // `null` is «Første ledige», which is both the default and the answer the
        // salon would rather they gave.
        return {
          ...withParty(state, peopleFor(state, 1), [action.service]),
          ...clearedSlot,
          resourceId: null,
          stylistAnswered: false,
          step: 'when',
          error: null,
        };

      case 'addService':
        if (state.items.length >= partyLimit(state.items, action.service)) {
          // "Changes nothing else" is the whole point: a refused fourth child
          // must leave the three already chosen exactly as they were.
          return { ...state, error: 'maxParty' };
        }
        // No step change — adding a sibling happens on step 1, and yanking the
        // visitor forward mid-basket is how the third child gets lost.
        return {
          ...withParty(state, peopleFor(state, state.items.length + 1), [
            ...state.items.map((item) => item.service),
            action.service,
          ]),
          ...clearedSlot,
          // The named stylist has to cover the whole basket, and the basket just
          // grew. A stylist who cannot do the new child's service is one step 2
          // will no longer offer, so keeping them would leave the step showing
          // nothing selected while step 3 filtered every day to their empty diary.
          // Back to «Første ledige», which is where step 2 opens anyway.
          ...stylistAfterAdd(action),
          error: null,
        };

      case 'pickResource':
        // Re-affirming the answer already on screen is not a change of mind, and
        // must not cost the visitor the time they picked under it. Tapping the
        // highlighted card is how a parent says «yes, still Sara, carry on» —
        // step 2 keeps its selection when they come back to it, so it is the
        // obvious way forward from there and it happens often.
        if (action.resourceId === state.resourceId) {
          return { ...state, stylistAnswered: true, step: 'when', error: null };
        }
        // Otherwise the slot goes with the stylist, for the same reason it goes
        // with the service. A time chosen from Sara's openings is Sara's time;
        // changing to Marcus leaves an instant nobody ever offered for him — and
        // because `isSatisfied('when')` asks only whether `startTs` is non-null,
        // the surviving one made `details` reachable again. Going back, choosing a
        // different stylist and jumping straight forward would then submit the old
        // slot with the old stylist: somebody the parent did not choose, at a time
        // they were never shown for them.
        //
        // `resourceId` is this action's own answer, written onto the same object
        // after the spread, so `clearedSlot` leaving it alone costs nothing here.
        return {
          ...state,
          ...clearedSlot,
          resourceId: action.resourceId,
          stylistAnswered: true,
          step: 'when',
          error: null,
        };

      case 'pickSlot':
        // Two fields rather than one, and both earn their keep today. `resourceId`
        // holds the visitor's *preference* (null = «Første ledige»), which is what
        // step 2 renders as selected on a `goToStep` back and what filters the
        // availability query; `resolvedResourceId` holds the stylist this
        // particular slot turned out to be with, and is what gets submitted.
        // Collapsing them would mean a «Første ledige» booking silently pinning
        // itself to whoever happened to be free first, and a `slotTaken` — which
        // clears the resolution but keeps the preference — having nothing left to
        // re-query with.
        return {
          ...state,
          startTs: action.startTs,
          resolvedResourceId: action.resourceId,
          step: 'details',
          error: null,
        };

      case 'setPartyMode': {
        // A site that seats families one after another only (`party.allowParallel`)
        // has no parallel mode to switch to.
        if (action.mode === 'parallel' && !config.party.allowParallel) return state;
        // «To frisører samtidig» and «jeg vil til Sara» cannot both be true — one
        // stylist cannot cut two children at once — so choosing the parallel mode
        // drops the named preference rather than leaving step 2 showing a stylist
        // the search is quietly ignoring. Every slot it could find would be with
        // somebody else.
        //
        // Sequential does not restore it: the machine has nowhere to remember a
        // preference it has already discarded, and «Første ledige» is both the
        // default and the choice the salon would rather the visitor made.
        // «To frisører samtidig» clears the preference and ANSWERS the question at
        // the same time: it is a deliberate statement about who cuts the hair, so
        // a link naming one stylist must not fill the blank it leaves.
        const preference =
          action.mode === 'parallel' ? { resourceId: null, stylistAnswered: true } : {};
        // The slot goes for the ordinary reason: a slot found «rett etter
        // hverandre» seats the second child half an hour after the first, and the
        // same hour in parallel seats them together with a different stylist. The
        // instant may survive the switch; the seating never does.
        return { ...state, ...clearedSlot, ...preference, partyMode: action.mode, error: null };
      }

      case 'pickPartySlot':
        if (action.mode === 'parallel' && !config.party.allowParallel) return state;
        // A seating chart that names a different number of children than the
        // basket holds is the caller's bug, and gets the answer `setItemField`
        // gives one: the identical object. Booking on it would submit a stylist
        // for a child who is not coming, or none for one who is.
        if (action.resourceIds.length !== state.items.length) return state;
        return {
          ...state,
          startTs: action.startTs,
          partyResourceIds: action.resourceIds,
          // The mode of the slot that was actually tapped, which is not always
          // the mode the visitor chose on step 2 — accepting step 3's parallel
          // alternative is a change of mind about both at once.
          partyMode: action.mode,
          // The whole visit's stylist where there is one — a sequential party is
          // one person, back to back — and `null` where there is not, which is
          // every parallel party. A parallel visit has two stylists and naming
          // either of them as *the* one would be false on the confirmation card.
          resolvedResourceId: sharedResourceId(action.resourceIds),
          step: 'details',
          error: null,
        };

      case 'slotTaken':
        // The resolved stylist belonged to the slot that just vanished. Carrying
        // it forward would submit an assignment nobody ever offered — and for a
        // party that is a whole seating chart, not one id.
        return {
          ...state,
          startTs: null,
          resolvedResourceId: null,
          partyResourceIds: null,
          step: 'when',
          error: 'slotTaken',
        };

      case 'submitFailed':
        // Nothing else moves. The visitor is standing on step 4 with a button they
        // have just pressed, and every one of these four is either theirs to fix
        // in the form or ours to fix upstream — neither is a reason to throw away
        // the slot they chose, which is what leaving `details` would do.
        return { ...state, error: action.error };

      case 'goToStep':
        // Refused jumps return the *same object*, not a copy: the progress dots
        // decide whether they are tappable with `canGoToStep`, so arriving here
        // with an unreachable step is a bug in the caller rather than something
        // the visitor did, and there is no error copy to show for it. Returning
        // the identical reference also means React re-renders nothing.
        if (!canGoToStep(state, action.step)) return state;
        return { ...state, step: action.step, error: null };

      case 'setContact':
        return {
          ...state,
          contact: { ...state.contact, [action.field]: action.value },
          error: null,
        };

      case 'setItemField': {
        // An index that names no line item is the caller's bug, and the same
        // answer `goToStep` gives one: the identical object, so nothing re-renders
        // and no phantom item is conjured at index 7 of a party of one.
        if (!state.items[action.index]) return state;
        const item = withItemField(state.items[action.index], action);
        return {
          ...state,
          items: state.items.map((current, index) => (index === action.index ? item : current)),
          // Mirrored onto the person, so a basket rebuilt from `people` — a
          // service changed on step 2 after a name was typed — keeps the name.
          people: state.people.map((person, index) =>
            index === action.index ? withPersonFields(person, item) : person
          ),
          error: null,
        };
      }

      case 'setNotes':
        return { ...state, notes: action.value, error: null };

      case 'setConsent':
        // Spread of one key or the other, rather than two cases: the two boxes
        // differ only in which flag they set, and the shape below makes it plain
        // that ticking the marketing box cannot touch the terms flag — which is
        // the confusion that would actually matter, since terms gate submit.
        return {
          ...state,
          ...(action.which === 'terms'
            ? { consentTerms: action.accepted }
            : { consentMarketing: action.accepted }),
          error: null,
        };

      case 'prefill':
        return applyPrefill(state, action.prefill, action.catalogue);
    }
    // No `default`. The switch is exhaustive over `WizardAction`, so a new action
    // added later fails to compile here instead of silently doing nothing.
  }

  /** The children a family link asked for (`?antall=` also applies to a
   * «Bestill igjen» `?service=` link, intentionally), up to what the salon allows and only
   * on a kids' service. Through `addService`, so the party limit is the machine's
   * own and a clamped request raises no error. */
  function withLinkedParty(
    state: WizardState,
    service: WizardService,
    party?: number | null
  ): WizardState {
    if (!party || !isChildCategory(config, service.category)) return state;
    const wanted = Math.min(party, Math.max(1, service.maxPerBooking));
    let next = state;
    while (next.items.length < wanted) {
      const after = reduce(next, { type: 'addService', service });
      // A refusal leaves the basket as it was; stop rather than spin.
      /* v8 ignore next -- defensive: `wanted` never exceeds the service's own limit */
      if (after.items.length === next.items.length) break;
      next = after;
    }
    return next;
  }

  /**
   * A «Bestill igjen» link, folded into the state — so a parent re-booking from
   * `/min-side` opens the wizard with the service, the stylist and the child
   * already answered and only the time left to pick.
   *
   * FILLS BLANKS, NEVER OVERWRITES. Each of the three answers is written only
   * where the visitor has not given one: the service into an empty basket, the
   * name onto a line that has none, the stylist while step 2 is still the open
   * question — nothing answered (`stylistAnswered`, because «Alle» tapped and
   * «Alle» never touched are the same `null`), no slot chosen, and the visitor
   * still ON that step. This is not caution for its own sake. The stylist list is fetched
   * FOR a service, so it does not exist at the moment the link is read; the shell
   * therefore applies the same prefill twice — once with no stylists, once when
   * they land — and in between the visitor may have tapped anything. A second
   * pass that only fills blanks finishes what the first began and cannot undo a
   * tap. It also makes the function idempotent, which is what lets the shell not
   * care whether it has already run.
   *
   * NOTHING IS TRUSTED BEYOND THE CATALOGUE. The link may be a year old: the
   * stylist may have left, the service may have been re-created under a new id.
   * An id the catalogue does not hold is ignored — silently, because there is no
   * error a parent could act on, and the wizard they are left with is the
   * ordinary one. A stylist is accepted only if they can do EVERY service in the
   * basket, which is the rule `StylistStep` filters by; accepting them on the
   * link's word alone would leave step 2 with nothing selected and step 3
   * filtered to a diary that cannot take the visit — «Fullt» on every day of the
   * week at a salon with a free chair, the very failure `pickService` exists to
   * prevent.
   *
   * WHERE IT LANDS is the earliest step with a question still open: nothing
   * applied → wherever the visitor was; a service → step 2, because «who» has
   * not been answered even though «Første ledige» would be a valid default; a
   * stylist too → step 3. Those are the steps the machine's own `pickService` and
   * `pickResource` move to, and this function reaches them by dispatching those
   * actions rather than by writing `step` itself — so a prefilled basket obeys
   * every rule a tapped one does, including the slot-clearing ones.
   *
   * Returns the IDENTICAL object when nothing applies, for the same reason
   * `goToStep` does: React then re-renders nothing, and a test can tell «ignored»
   * from «rewritten to look the same».
   */
  function applyPrefill(
    state: WizardState,
    prefill: WizardPrefill,
    catalogue: WizardCatalogue
  ): WizardState {
    let next = state;

    if (next.items.length === 0 && prefill.serviceId) {
      const service = catalogue.services.find((entry) => entry.id === prefill.serviceId);
      if (service !== undefined) {
        next = reduce(next, { type: 'pickService', service });
        next = withLinkedParty(next, service, prefill.party);
      }
    }

    // No basket means nothing to name and nobody to book with: the service was
    // unknown, or the link never named one.
    if (next.items.length === 0) return state;

    if (prefill.who) {
      // Trimmed first, so the cut falls on the name and not on leading
      // whitespace; `setItemField` trims once more for whatever the cut leaves
      // at the end, and stores nothing at all for a blank.
      const who = prefill.who.trim().slice(0, BOOKED_FOR_NAME_MAX_LENGTH);
      if (who.length > 0 && next.items[0].bookedForName === undefined) {
        next = reduce(next, { type: 'setItemField', index: 0, field: 'bookedForName', value: who });
      }
    }

    if (
      prefill.resourceId &&
      next.step === 'when' &&
      !next.stylistAnswered &&
      next.resourceId === null &&
      next.startTs === null
    ) {
      const wantedResource = prefill.resourceId;
      const resource = catalogue.resources.find((entry) => resourceMatches(entry, wantedResource));
      const basket = next.items.map((item) => item.service.id);
      if (resource !== undefined && basket.every((id) => resource.serviceIds.includes(id))) {
        next = reduce(next, { type: 'pickResource', resourceId: resource.id });
      }
    }

    return next;
  }

  /**
   * What ONE line costs, in øre, at the time the visit was booked for.
   *
   * The single definition of «what this child's haircut costs», and the reason
   * `totalPriceOre` below is a sum of it rather than a second copy of the rule:
   * the confirmation card prints a price per child and a total underneath them,
   * and a card whose lines were priced by one rule and whose total was priced by
   * another read «490 kr + 490 kr = 1 078 kr» to the parent about to pay it.
   *
   * The surcharge is per SERVICE — Medal carries `weekend_surcharge_pct` on each
   * one — so it is applied here, per line, and never as one percentage over a
   * basket that may hold two different ones.
   *
   * `clock.isWeekend` and not `getDay()`: a Saturday 00:30 slot is still Saturday
   * to the salon while UTC — and a viewer in London — still calls it Friday, and
   * the surcharge follows the salon's calendar because that is who charges it.
   *
   * A null `startTs` means no slot has been chosen yet, which is the base price
   * rather than a guess at a surcharge.
   *
   * `startTs` is the VISIT's start, not the line's own — the two differ only for
   * a sequential party that crosses midnight into or out of a weekend, which the
   * salon's opening hours do not permit, and pricing every line off the same
   * instant is what makes the lines add up to the total the parent agreed to on
   * step 4.
   */
  function itemPriceOre(service: WizardService, startTs: number | null): number {
    const multiplier =
      startTs !== null && clock.isWeekend(startTs) ? 1 + service.weekendSurchargePct / 100 : 1;
    return Math.round(service.priceOre * multiplier);
  }

  /**
   * What the visit costs, in øre, at the time it was booked for.
   *
   * Here rather than in either component that shows it, because both of them show
   * it: step 4's «Bekreft time – 539 kr betales i salongen» and the confirmation
   * card's «Totalt» have to be the same number, and the surcharge is exactly the
   * sort of rule that gets applied in one of two places.
   */
  function totalPriceOre(items: WizardItem[], startTs: number | null): number {
    return items.reduce((sum, { service }) => sum + itemPriceOre(service, startTs), 0);
  }

  /**
   * What is being booked.
   *
   * One child gets the service by name, which is what they chose and what they
   * will look for. A family gets the report's aggregate — «2 tjenester · 60 min
   * totalt» — because three service names joined by the same separator the bar
   * uses between its own parts is a sentence nobody can parse at the bottom of a
   * phone, and because the minutes are the thing a parent planning the afternoon
   * actually needs.
   */
  function serviceLabel(state: WizardState): string | null {
    const { items } = state;
    if (items.length === 0) return null;
    // `showsPartyMode` and not a second `length > 1`: the bar changing shape and
    // step 2 growing a question are the same event, and two spellings of it is
    // how the bar ends up aggregating a booking the wizard still calls single.
    if (!showsPartyMode(state)) return items[0].service.name;
    return `${fill(labels['summary.services'], { count: items.length })}${SEPARATOR}${fill(
      labels['summary.totalMinutes'],
      { minutes: visitMinutes(items, state.partyMode) }
    )}`;
  }

  /** «Theo, Emma», «2 barn», «Voksen» — who the visit is for, before what. */
  function peopleLabel(people: readonly WizardPerson[]): string {
    const guests = people.filter((person) => person.key.startsWith('guest:')).length;
    const parts = people
      .filter((person) => !person.key.startsWith('guest:'))
      .map(
        (person) =>
          person.name ??
          labelText(person.key === SELF_KEY ? labels['people.self'] : labels['people.adult'])
      );
    if (guests > 0) parts.unshift(fill(labels['people.children'], { count: guests }));
    return parts.join(', ');
  }

  /**
   * `i dag 15:00`, not `15:00`.
   *
   * The bar is read at the bottom of a screen the visitor has been scrolling for
   * a minute, often after tapping between two days on step 3 — and a bare hour
   * there is the one part of the summary they can misread without noticing. The
   * day comes from `salon-clock.ts` along with the hour, so the bar and the chip
   * the visitor tapped read the same; one of them being on the viewer's clock is
   * exactly how they stop.
   */
  function timeLabel(startTs: number | null, now: number): string | null {
    return startTs === null ? null : clock.when(startTs, now);
  }

  /**
   * What the visit costs so far.
   *
   * Never a dash: from the moment there is a service there is a price, and it is
   * `totalPriceOre` — the same function step 4's button and the confirmation card
   * read — so the three cannot quote different numbers. It can *rise* when the
   * visitor picks a Saturday, which is the surcharge arriving rather than the bar
   * changing its mind, and is why the number is recomputed here from `startTs`
   * instead of being frozen when the service was chosen.
   */
  function priceLabel(state: WizardState): string | null {
    /* v8 ignore next -- defensive: `summaryLine` asks only once there is a basket */
    if (state.items.length === 0) return null;
    return money.formatMinor(totalPriceOre(state.items, state.startTs));
  }

  /**
   * The single source for the sticky bar, so the bar can never disagree with the
   * state it is summarising. Chosen parts are joined; parts still to come render
   * as what is left to do — «Første ledige» for a stylist nobody named, «Velg
   * tid» for the hour — which is what makes the bar a promise of what is left
   * rather than a receipt for what is done. A named stylist the catalogue cannot
   * name is still `—`.
   *
   * `now` is a parameter rather than a `Date.now()` inside `clock.when`, because
   * «i dag» is a claim about when the bar is being *read*: a component that wants
   * one instant for a whole render — the confirmation card already does this — has
   * to be able to say so, and a test that asserts «i dag» has to be able to pin it.
   */
  function summaryLine(
    state: WizardState,
    resolveStylistName: (resourceId: string) => string | null,
    now: number = Date.now()
  ): string {
    /**
     * A family bar is the report's three parts — «2 tjenester · 60 min totalt ·
     * 980 kr» — and drops the stylist and the hour rather than dashing them.
     *
     * Not brevity: a parallel party has two stylists and no single one to name,
     * so that part could only ever be a dash, and a dash that can never be filled
     * in is a promise the bar cannot keep. The when-and-with-whom is on step 3's
     * chip while the visitor is choosing it and on the confirmation card once
     * they have, both of which can say «15:00 (Jonas hos Marcus · Emma hos Sara)»
     * where a one-line sticky bar cannot.
     */
    // Step 1 answered, step 2 not yet: say who, so the bar is already about them.
    if (state.items.length === 0 && state.people.length > 0) return peopleLabel(state.people);
    const party = showsPartyMode(state);
    const service = serviceLabel(state);
    if (party) {
      return [service, priceLabel(state)].filter((part) => part !== null).join(SEPARATOR);
    }
    // Nothing chosen at all: the bar has its own placeholder for step 1, and a
    // row of «Første ledige · Velg tid» with no service in front says nothing.
    if (service === null) return '';
    const unnamedPreference = (state.resolvedResourceId ?? state.resourceId) === null;
    return [
      service,
      stylistLabel(state, resolveStylistName) ??
        (unnamedPreference ? labelText(labels['summary.firstAvailable']) : UNCHOSEN),
      timeLabel(state.startTs, now) ?? labelText(labels['summary.pickTime']),
      // Defensive: a service in the bar means a price.
      /* v8 ignore start */
      priceLabel(state) ?? UNCHOSEN,
      /* v8 ignore stop */
    ].join(SEPARATOR);
  }

  return {
    maxPeople,
    initialState,
    reduce,
    applyPrefill,
    canAdvance,
    canGoToStep,
    itemPriceOre,
    totalPriceOre,
    itemStartTimes,
    visitMinutes,
    visitTailMinutes,
    visitEndTs,
    showsPartyMode,
    itemResourceIds,
    summaryLine,
    guestChild,
    isGuestSeat,
  };
}
