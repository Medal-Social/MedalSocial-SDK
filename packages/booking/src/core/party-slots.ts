/**
 * Seating a family: which instants a whole party can actually be taken at, and
 * with whom.
 *
 * The engine answers «when is this ONE service free?» — one row per stylist per
 * instant, because `listSlots` returns a `resourceId` with every slot. Nothing
 * upstream answers «when can these two children be seen back to back?», and
 * nothing should: it is a question about a basket that only exists in this
 * wizard.
 *
 * Pure, and a sibling of `wizard-machine.ts` rather than part of it, for the
 * reason the machine states about itself — the search is where a family booking
 * goes wrong (a stylist who can only cut one of the two, a pair of times that
 * are an hour apart, the same stylist promised to both children at once), and
 * every one of those is provable without rendering anything.
 *
 * It imports `itemStartTimes` rather than restating the seating arithmetic:
 * step 4 submits with that function and the confirmation card reads it back, so
 * a search that laid the children out any other way would offer a slot the
 * submission then asked for at different times.
 */

import { type ClockConfig, createClock } from './clock';
import { itemStartTimes, type WizardItem, type WizardState } from './machine';
import type { BookingSlotDto } from './types';
import { visitKey } from './visit';

/** One child's place in the visit: when they sit down, and with whom. */
export interface PartySeat {
  startTs: number;
  /**
   * Never `null`, unlike `BookingSlotDto.resourceId`.
   *
   * «Første ledige» is an answer the engine can resolve for one booking, but a
   * party slot is a claim about *particular* people — that one stylist has a
   * clear hour, or that two different ones are free at the same minute. A seat
   * that could not name its stylist could not make either claim.
   */
  resourceId: string;
}

/** A whole family, seated. */
export interface PartySlot {
  /** When the visit starts — the first child sits down. */
  startTs: number;
  /** Which search produced it, so accepting the parallel alternative can also
   * switch the mode the submission is seated with. */
  mode: WizardState['partyMode'];
  /** One per line item, in basket order. */
  seats: PartySeat[];
}

/** Availability as the wizard collects it: one query per VISIT in the basket,
 * keyed by `visitKey` — a service id for a one-service visit, `a+b` for a
 * person having both. The server answers a visit as one list (spans as long as
 * the whole visit, on stylists who do every part of it), so it has to be stored
 * and read under the visit's key: the first service's own list would offer a
 * stylist who can cut but not wash. Two children sharing a visit share the
 * entry — which is exactly why the parallel search has to insist on distinct
 * stylists rather than trusting the lists to differ. */
export type SlotsByService = Readonly<Record<string, readonly BookingSlotDto[]>>;

/** The keys a basket's availability is fetched and stored under: each distinct
 * visit once, in basket order — the list the wizard asks the route for. */
export function slotKeysFor(items: readonly WizardItem[]): string[] {
  return [...new Set(items.map((item) => visitKey(item)))];
}

/** `resource@instant`, the unit both searches ask about. */
function seatKey(resourceId: string, startTs: number): string {
  return `${resourceId}@${startTs}`;
}

/**
 * The catalogue, indexed for the only question either search asks: is this
 * stylist free for this visit at this exact minute?
 *
 * Slots with no `resourceId` are dropped rather than treated as «anybody». The
 * wire type is nullable because `medal-client.ts` types every field the way the
 * serialiser emits it; a slot that arrived without one cannot be paired with a
 * second slot, since there would be no way to tell whether the pair is two
 * stylists or one stylist promised twice.
 */
function indexAvailability(slotsByService: SlotsByService): {
  free: (key: string, resourceId: string, startTs: number) => boolean;
  resourceOrder: string[];
} {
  const byVisit = new Map<string, Set<string>>();
  // First-encounter order across the whole catalogue: the tie-break when two
  // stylists could both take the same slot. It follows whatever order the
  // availability route returned, which is the engine's own resource order, so
  // the wizard offers the same stylist twice in a row rather than shuffling
  // under a re-render.
  const resourceOrder: string[] = [];
  const seen = new Set<string>();

  for (const [key, slots] of Object.entries(slotsByService)) {
    const keys = byVisit.get(key) ?? new Set<string>();
    for (const slot of slots) {
      if (slot.resourceId === null) continue;
      keys.add(seatKey(slot.resourceId, slot.startTs));
      if (!seen.has(slot.resourceId)) {
        seen.add(slot.resourceId);
        resourceOrder.push(slot.resourceId);
      }
    }
    byVisit.set(key, keys);
  }

  return {
    free: (key, resourceId, startTs) =>
      byVisit.get(key)?.has(seatKey(resourceId, startTs)) ?? false,
    resourceOrder,
  };
}

/**
 * The instants the party could begin at: every time the FIRST child's visit is
 * free, with anybody, in ascending order and without repeats.
 *
 * The first child is the right anchor for both modes — sequential seats the
 * rest after them and parallel seats the rest alongside them — and starting
 * anywhere else would offer a visit whose opening line was never free.
 *
 * Deliberately does NOT re-filter the stylist-less slots that `indexAvailability`
 * drops. An instant only survives if some real stylist can be seated at it, and
 * that is the index's answer to give: a second copy of the rule here would be a
 * place for the two to disagree, and it would pass every test the index's own
 * guard already passes.
 *
 * Deduplicated, because two stylists free at the same minute are one offer to a
 * parent. Without the `Set` the same visit would be built once per stylist and
 * step 3 would draw the identical chip twice.
 */
function candidateStarts(items: WizardItem[], slotsByService: SlotsByService): number[] {
  const first = slotsByService[visitKey(items[0])] ?? [];
  return [...new Set(first.map((slot) => slot.startTs))].sort((a, b) => a - b);
}

/**
 * One stylist for the whole visit.
 *
 * `every`, over every line item and not just the first: the report's example is
 * Sara doing Gutteklipp *and* Jenteklipp, and a search that only checked the
 * service the visitor happened to tap first would offer a stylist who cannot
 * cut the second child — a refusal the engine issues at submit, dressed up here
 * as a slot.
 *
 * The times come from `itemStartTimes`, so «contiguous» is enforced rather than
 * hoped for: the second child's slot has to exist at exactly the minute the
 * first one's service ends. 15:00 and 16:30 are two openings, not an hour.
 */
function seatSequentially(
  items: WizardItem[],
  starts: number[],
  index: ReturnType<typeof indexAvailability>
): string[] | null {
  for (const resourceId of index.resourceOrder) {
    const fits = items.every((item, position) =>
      index.free(visitKey(item), resourceId, starts[position])
    );
    if (fits) return items.map(() => resourceId);
  }
  return null;
}

/**
 * A different stylist per child, all at the same minute.
 *
 * Backtracking rather than a greedy pass, because greedy is wrong on the case
 * the salon actually has: three children where Sara is the only one who can
 * take the third, and Sara is also the first name on the list for the first
 * two. Handing her to child one and giving up leaves a seating that exists
 * unfound. A party is small — the salon's kids' services cap it at three, and
 * `maxPerBooking` caps it at whatever the salon seeds — so the search space is
 * trivial and correctness is free.
 *
 * `taken` is what makes the stylists distinct — the rule that one person cannot
 * cut two children at once, which no amount of availability data states on its
 * own, since one free slot is genuinely free for either child.
 */
function seatInParallel(
  items: WizardItem[],
  starts: number[],
  index: ReturnType<typeof indexAvailability>
): string[] | null {
  const taken = new Set<string>();

  function assign(position: number): string[] | null {
    if (position === items.length) return [];
    for (const resourceId of index.resourceOrder) {
      if (taken.has(resourceId)) continue;
      if (!index.free(visitKey(items[position]), resourceId, starts[position])) continue;
      taken.add(resourceId);
      const rest = assign(position + 1);
      taken.delete(resourceId);
      if (rest !== null) return [resourceId, ...rest];
    }
    return null;
  }

  return assign(0);
}

/**
 * Every instant the whole party can be taken at, in the mode the visitor chose.
 *
 * At most one slot per instant. Two stylists who could both take the same hour
 * back to back are one offer to a parent, not two identical chips — step 3 asks
 * «når passer det?», and the stylist question was step 2's.
 */
export function findPartySlots(
  items: WizardItem[],
  slotsByService: SlotsByService,
  mode: WizardState['partyMode']
): PartySlot[] {
  if (items.length === 0) return [];

  const index = indexAvailability(slotsByService);
  const seat = mode === 'parallel' ? seatInParallel : seatSequentially;
  const found: PartySlot[] = [];

  for (const startTs of candidateStarts(items, slotsByService)) {
    const starts = itemStartTimes(items, startTs, mode);
    const resourceIds = seat(items, starts, index);
    if (resourceIds === null) continue;
    found.push({
      startTs,
      mode,
      seats: resourceIds.map((resourceId, position) => ({
        startTs: starts[position],
        resourceId,
      })),
    });
  }

  return found;
}

/**
 * The report's rescue: «Ingen ledige timer rett etter hverandre torsdag – men
 * begge kan tas samtidig kl. 15:00.»
 *
 * Returns the earliest parallel slot on the day being looked at, and only when
 * the sequential search has genuinely found nothing on that same day. Offering
 * it alongside slots that do exist would be answering a question nobody asked;
 * withholding it when there are none is the empty day the report is trying to
 * prevent.
 *
 * The day is the salon's, not the viewer's — `clock.dayKey` rather than a date
 * string — for the reason every other clock face in this flow is: a 00:30 slot
 * belongs to the day the salon is open on, whatever UTC calls it.
 */
function partyAlternative(
  dayKey: (ts: number) => string,
  args: {
    sequential: readonly PartySlot[];
    parallel: readonly PartySlot[];
    dayTs: number;
  }
): PartySlot | null {
  const day = dayKey(args.dayTs);
  if (args.sequential.some((slot) => dayKey(slot.startTs) === day)) return null;
  return args.parallel.reduce<PartySlot | null>(
    (earliest, slot) =>
      dayKey(slot.startTs) === day && (earliest === null || slot.startTs < earliest.startTs)
        ? slot
        : earliest,
    null
  );
}

/**
 * «Neste ledige» for a family: the earliest minute each stylist can take the
 * WHOLE party back to back.
 *
 * The single-service answer (`firstOpeningPerResource`, and the resources
 * route) is the first minute a stylist can take ONE child. Printed on a party's
 * stylist card it would quote a time the search on the time step then fails to
 * find for that stylist — the second child's slot need not be free straight
 * after. So this runs the very search `findPartySlots` runs once the visitor
 * picks the stylist (sequential, narrowed to that one person) and keeps the
 * first hit: the card and the day strip under it cannot disagree.
 *
 * Sequential only, deliberately. The parallel mode draws no stylist list — two
 * children at once are two people — so there is no card to hang an answer on.
 *
 * A stylist with no seating in the window gets no entry, the same «promise
 * nothing we do not know» rule the single-service line follows.
 */
export function firstPartyStartPerResource(
  items: WizardItem[],
  slotsByService: SlotsByService
): Record<string, number> {
  if (items.length === 0) return {};

  const index = indexAvailability(slotsByService);
  const earliest: Record<string, number> = {};
  let left = index.resourceOrder.length;

  for (const startTs of candidateStarts(items, slotsByService)) {
    if (left === 0) break;
    const starts = itemStartTimes(items, startTs, 'sequential');
    for (const resourceId of index.resourceOrder) {
      if (resourceId in earliest) continue;
      const fits = items.every((item, position) =>
        index.free(visitKey(item), resourceId, starts[position])
      );
      if (!fits) continue;
      earliest[resourceId] = startTs;
      left -= 1;
    }
  }

  return earliest;
}

export interface PartySlots {
  findPartySlots: typeof findPartySlots;
  firstPartyStartPerResource: typeof firstPartyStartPerResource;
  partyAlternative(args: {
    sequential: readonly PartySlot[];
    parallel: readonly PartySlot[];
    dayTs: number;
  }): PartySlot | null;
}

/** The party search on this business's calendar. Only `partyAlternative` needs the clock. */
export function createPartySlots(config: ClockConfig): PartySlots {
  const clock = createClock(config);
  return {
    findPartySlots,
    firstPartyStartPerResource,
    partyAlternative: (args) => partyAlternative(clock.dayKey, args),
  };
}
