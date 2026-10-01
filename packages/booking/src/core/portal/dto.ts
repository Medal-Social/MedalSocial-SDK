/**
 * Where the portal's wire shape becomes this site's — one definition per shape.
 *
 * The same split `lib/booking/dto.ts` makes for the wizard: `medal-portal.ts`
 * types the wire honestly and does nothing to it, and the pages under
 * `/min-side` read only the camelCase projections defined here. Two consumers
 * need the same answers — the overview page and the server actions that hand
 * a refreshed profile back to the browser — so the projection is a module and
 * not a private function in either.
 *
 * One projection here is a security decision, not a rename. A booking on the
 * wire carries its `manage_token`, which is a live bearer credential for that
 * one appointment: whoever holds it can move or cancel it, with no session and
 * no login. The DTO does not keep it. It keeps the PATH the token is spent at —
 * the same `/bestill/administrer/<token>` the confirmation e-mail links to —
 * built by the one function in the app that knows how to build it. A page that
 * renders a link has everything it needs; a serialiser that dumps the DTO into
 * a prop or a log has no field named «token» to leak, and the credential
 * travels exactly as far as an `href` and no further.
 *
 * Free of `server-only` on purpose: a client component may import a DTO type,
 * and `rebookSuggestions` is pure. The wire types come from `@medalsocial/sdk`
 * as `import type`, so nothing here pulls the SDK into a browser bundle.
 */

import type {
  PortalBooking,
  PortalBookingStatus,
  PortalFamilyEntry,
  PortalPerson,
  PortalProfile,
} from '@medalsocial/sdk';
import type { BookingConfig } from '../config';
import { stylistDisplayName } from '../display-name';
import { createPaths } from '../paths';

/**
 * One child on the profile — a PERSON now, not a name (SP10).
 *
 * `personId` is what makes a child something this site can point at: the id
 * of the `contactPersons` row Medal keeps, stable across a rename through
 * `/me/persons/{id}`, and the key a past booking carries as
 * `booked_for_person_id`. It is `null` only against a Medal that sent neither
 * a `person_id` on the family entry nor one unambiguous person of that name
 * and year — the site then falls back to what it did before persons existed.
 *
 * `birthMonth`, `notes` («Notat til frisøren») and `preferredResourceId`
 * («Fast frisør») are SP10's portal-editable details; each is `null` when
 * unset AND when Medal predates them — see `personDetails` on the profile for
 * telling the two apart.
 */
export interface PortalFamilyMemberDto {
  personId: string | null;
  name: string;
  birthYear: number;
  birthMonth: number | null;
  notes: string | null;
  preferredResourceId: string | null;
}

/**
 * The bransjemal preset's words for who a booking is for — «Barn» for a
 * children's salon, «Familie» wherever the fallback still applies. `person` is the
 * singular a future per-row label would use; only `persons` is read today.
 */
export interface PortalLabels {
  person: string;
  persons: string;
}

export interface PortalProfileDto {
  contactId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  family: PortalFamilyMemberDto[];
  /**
   * Whether this Medal speaks SP10 persons — birth month, notes and preferred
   * stylist on each child, and the `/me/persons` endpoints that edit them.
   * Read off the wire (the fields are present, `null` or not), so the editor
   * offers the extra fields only where they can be saved. `false` also for a
   * profile with no persons at all, where there is nothing to read it off;
   * the person actions still try the endpoints and fall back on a 404.
   */
  personDetails: boolean;
  marketingConsent: boolean;
  labels?: PortalLabels;
  /**
   * Whether the parent's Vipps account is linked to this profile — present
   * only when Medal says (`vipps_linked`, with the «Koble til Vipps» routes).
   * ABSENT against a Medal that predates them, and then Min side → Profil
   * draws no Vipps row: a button whose route does not exist is a dead end.
   */
  vippsLinked?: boolean;
}

export interface PortalBookingDto {
  bookingId: string;
  status: PortalBookingStatus;
  startTs: number;
  endTs: number;
  serviceId: string | null;
  serviceName: string | null;
  resourceId: string | null;
  resourceName: string | null;
  bookedForName: string | null;
  /**
   * Who the visit was for, by id — the `person_id` of one of the parent's
   * children, or `null` for a visit for the parent themselves, one made before
   * persons existed, or a Medal that does not send it yet (SP10). This is the
   * key «Samme som sist» joins on; the name is only the fallback.
   */
  bookedForPersonId: string | null;
  /** The birth year and month frozen onto the booking, when Medal sends them. */
  bookedForBirthYear: number | null;
  bookedForBirthMonth: number | null;
  amountOre: number | null;
  notes: string | null;
  /**
   * Where this booking is managed, or `null` when Medal issued no token for it
   * — a cancelled or completed row, or one made over the counter. The token
   * itself is deliberately not on this object; see the module comment.
   */
  managePath: string | null;
}

/*
 * The SP10 wire fields (`person_id` / `birth_month` on a family entry,
 * `birth_month` / `preferred_resource_id` on a person, `booked_for_*` on a
 * booking) are typed by the SDK since 1.12, but still READ defensively: a
 * Medal that predates SP10 omits every one of them, and `speaksPersonDetails`
 * keys on exactly that absence. The helpers below take `unknown` for that
 * reason, not because the types are missing.
 */

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 1–12, or `null` for anything else — absent, `null`, or nonsense. */
export function monthOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12
    ? value
    : null;
}

function yearOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * The person behind one `family` entry.
 *
 * By id where Medal sends one (SP10 puts `person_id` on every entry). Without
 * it — today's Medal — by name AND year among the active guardian-type
 * persons, and only when exactly ONE matches: that is the same pair Medal's
 * own `PATCH /me {family}` matches on, so an id found this way is the row that
 * patch would edit. Two same-named, same-year rows are nobody in particular.
 */
function personFor(member: PortalFamilyEntry, persons: PortalPerson[]): PortalPerson | undefined {
  const id = stringOrNull(member.person_id);
  if (id !== null) return persons.find((person) => person.person_id === id);
  const twins = persons.filter(
    (person) =>
      person.active !== false &&
      person.relation_type === 'guardian' &&
      person.name === member.name &&
      person.birth_year === member.birth_year
  );
  return twins.length === 1 ? twins[0] : undefined;
}

function toFamilyMemberDto(
  member: PortalFamilyEntry,
  persons: PortalPerson[]
): PortalFamilyMemberDto {
  const person = personFor(member, persons);
  return {
    personId: stringOrNull(member.person_id) ?? person?.person_id ?? null,
    name: member.name,
    birthYear: member.birth_year,
    birthMonth: monthOrNull(member.birth_month) ?? monthOrNull(person?.birth_month),
    notes: stringOrNull(person?.notes),
    preferredResourceId: stringOrNull(person?.preferred_resource_id),
  };
}

/** Whether the wire carries SP10's person fields at all; see `personDetails`. */
function speaksPersonDetails(family: PortalFamilyEntry[], persons: PortalPerson[]): boolean {
  return (
    family.some((member) => 'person_id' in member || 'birth_month' in member) ||
    persons.some((person) => 'birth_month' in person || 'preferred_resource_id' in person)
  );
}

/**
 * Nulls stay nulls. The page decides what a missing surname or phone number
 * reads as, and a `''` here would make «not given» and «given as blank»
 * indistinguishable to the form that edits them.
 */
export function toPortalProfileDto(profile: PortalProfile): PortalProfileDto {
  const family = profile.family;
  // `persons` is SP11's; a Medal (or a fixture) without it is a family of names.
  const persons = Array.isArray(profile.persons) ? profile.persons : [];
  return {
    contactId: profile.contact_id,
    email: profile.email,
    firstName: profile.first_name,
    lastName: profile.last_name,
    phone: profile.phone,
    family: family.map((member) => toFamilyMemberDto(member, persons)),
    personDetails: speaksPersonDetails(family, persons),
    marketingConsent: profile.marketing_consent,
    labels: profile.labels,
    ...vippsLinkedFrom(profile),
  };
}

/** `{ vippsLinked }` when the wire says, `{}` otherwise. TODO(sdk): typed once the SDK has it. */
function vippsLinkedFrom(profile: PortalProfile): { vippsLinked?: boolean } {
  const linked = (profile as PortalProfile & { vipps_linked?: unknown }).vipps_linked;
  return typeof linked === 'boolean' ? { vippsLinked: linked } : {};
}

function toPortalBookingDto(
  managePath: (token: string) => string,
  booking: PortalBooking
): PortalBookingDto {
  return {
    bookingId: booking.booking_id,
    status: booking.status,
    startTs: booking.start_ts,
    endTs: booking.end_ts,
    serviceId: booking.service_id,
    serviceName: booking.service_name,
    resourceId: booking.resource_id,
    // Cleaned once here for every portal card (upcoming, history, rebook).
    resourceName:
      booking.resource_name === null ? null : stylistDisplayName(booking.resource_name) || null,
    bookedForName: booking.booked_for_name,
    bookedForPersonId: stringOrNull(booking.booked_for_person_id),
    bookedForBirthYear: yearOrNull(booking.booked_for_birth_year),
    bookedForBirthMonth: monthOrNull(booking.booked_for_birth_month),
    amountOre: booking.amount_ore,
    notes: booking.notes,
    managePath: booking.manage_token ? managePath(booking.manage_token) : null,
  };
}

/**
 * What a «Bestill igjen» card carries: enough to prefill the wizard's three
 * questions (`?service&stylist&who`) and the two names it shows on the card.
 * No ids the wizard cannot vouch for are trusted downstream — `applyPrefill`
 * ignores a service or stylist the catalogue no longer lists — so this does
 * not need to check them either.
 */
export interface RebookSuggestion {
  serviceId: string;
  serviceName: string | null;
  resourceId: string | null;
  resourceName: string | null;
  bookedForName: string | null;
}

/**
 * The haircuts worth offering again, most recent first, at most `max` of them.
 *
 * Distinct by (service, stylist, child): a family that books the same cut for
 * the same child with the same stylist every six weeks has ONE habit, not ten,
 * and ten identical cards would push the second child's cut off the list.
 * «Any stylist» (`resourceId: null`) is its own key — a parent who never
 * chose is offered the same non-choice, not the stylist they happened to get.
 *
 * Only `completed` rows: a cancelled or no-show booking is not a haircut that
 * happened, and a pending or confirmed one is upcoming, not history — offering
 * to book it again would be offering a duplicate. A row whose `serviceId` is
 * null has nothing to link to and is skipped rather than rendered as a card
 * that opens the wizard on step 1.
 *
 * Sorts a copy: the caller's `past` array is rendered in its own order.
 */
export function rebookSuggestions(past: PortalBookingDto[], max = 4): RebookSuggestion[] {
  const seen = new Set<string>();
  const suggestions: RebookSuggestion[] = [];
  const newestFirst = [...past].sort((a, b) => b.startTs - a.startTs);

  for (const booking of newestFirst) {
    if (suggestions.length >= max) break;
    if (booking.status !== 'completed' || booking.serviceId === null) continue;

    // JSON rather than a joined string: a child's name can contain whatever
    // separator a `join` would pick, and `null` and `''` must stay distinct.
    const key = JSON.stringify([booking.serviceId, booking.resourceId, booking.bookedForName]);
    if (seen.has(key)) continue;
    seen.add(key);

    suggestions.push({
      serviceId: booking.serviceId,
      serviceName: booking.serviceName,
      resourceId: booking.resourceId,
      resourceName: booking.resourceName,
      bookedForName: booking.bookedForName,
    });
  }

  return suggestions;
}

export interface PortalDto {
  toPortalProfileDto: typeof toPortalProfileDto;
  /** The booking, with its manage token turned into this site's manage PATH (`paths.manage`). */
  toPortalBookingDto(booking: PortalBooking): PortalBookingDto;
  rebookSuggestions: typeof rebookSuggestions;
  monthOrNull: typeof monthOrNull;
}

export function createPortalDto(config: Pick<BookingConfig, 'paths'>): PortalDto {
  const { managePath } = createPaths(config);
  return {
    toPortalProfileDto,
    toPortalBookingDto: (booking) => toPortalBookingDto(managePath, booking),
    rebookSuggestions,
    monthOrNull,
  };
}
