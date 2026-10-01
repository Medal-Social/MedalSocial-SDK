import type { WizardService } from './machine';

/**
 * The wizard-shaped contract: what this site's own route handlers emit and what
 * the step components take as props. Deliberately not Medal's wire types —
 * camelCase, no nulls where a null would only mean "the serialiser had nothing"
 * (`medal-client.ts` explains why every field arrives nullable), and epoch
 * milliseconds rather than ISO strings for anything the machine has to format.
 *
 * Shared from here rather than declared beside each route so a field added to
 * the payload cannot be added to only one of the two ends that read it.
 */

/**
 * One service as step 1 wants it: `WizardService` plus the flag that decides
 * whether the card is a button or a phone number.
 *
 * `bookableOnline` is not on `WizardService` because the wizard never carries a
 * service it cannot book. It has to travel anyway — J1 step 1 has «Hull i
 * ørene» rendering as «Ring oss for denne» rather than disappearing, so the
 * price list stays complete — and the card, not the machine, is what needs it.
 */
export interface BookingServiceDto extends WizardService {
  bookableOnline: boolean;
}

/**
 * One stylist as step 2 wants it.
 *
 * `serviceIds` is what makes the step honest: offering a stylist who cannot do
 * the chosen service is a server refusal three steps later, dressed up as a
 * choice. `photoUrl` and `bio` stay nullable because an unphotographed stylist
 * is the ordinary case, and the card falls back to initials.
 */
export interface BookingResourceDto {
  id: string;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  serviceIds: string[];
  sortOrder: number;
}

/**
 * One bookable slot, as step 3 wants it.
 *
 * `startTs` is epoch milliseconds, which is a translation and not a
 * relabelling: `formatBookingSlot` puts every timestamp through
 * `toISOString()`, but `pickSlot` stores `startTs` as a number and the sticky
 * summary bar formats it with `Intl.DateTimeFormat.format`. Relaying the string
 * would seat one in `state.startTs`, and the bar would throw on the visitor's
 * next keystroke.
 *
 * No `endTs`: the wizard has nowhere to put one. A slot's end is its start plus
 * the service's `durationMinutes`, which step 3 already has.
 *
 * `resourceId` stays nullable, unlike everything the services route emits. Here
 * `null` is an answer rather than a gap — it is «Første ledige» not yet
 * resolved to a stylist — and `pickSlot` takes it as one.
 */
export interface BookingSlotDto {
  startTs: number;
  resourceId: string | null;
}

/**
 * One date the salon keeps opening hours on, as step 3 wants it.
 *
 * The list is what lets the step tell «stengt» from «fullt». Availability
 * answers what can still be booked and its empty array says three things at
 * once — closed today, past closing today, every chair taken today — and a step
 * with one card for all three announced «Fullt i dag» at 18:45 on a Saturday
 * the salon shut at 17:00. A date MISSING from this list is one the salon keeps
 * no hours on; that absence is the answer, which is why there is no `closed`
 * field to read.
 *
 * `dayKey` is `salonDayKey`'s `2026-08-29`, so the step can look a day up
 * without re-deriving the salon's calendar date from an instant.
 *
 * `lastStartTs` is the last start THIS visit could occupy on the date, not the
 * closing time — the gap between them is a whole service's duration, and it is
 * the difference between «fullt» and «for sent i dag». Null when the salon
 * posts hours for the date but is shut on it outright, which is how a public
 * holiday arrives.
 */
export interface BookingDayDto {
  dayKey: string;
  opensTs: number;
  closesTs: number;
  lastStartTs: number | null;
}

/**
 * One booking as the manage page wants it — the screen reached from the link in
 * the confirmation e-mail.
 *
 * Deliberately carries no token. The token is the credential that produced this
 * object and it stays on the server that fetched it; the page puts it back into
 * its own URLs and nowhere else, and nothing here would let it leak into a
 * client-side prop, a log line or an analytics payload.
 *
 * `canCancel` / `canReschedule` are **the engine's answers, relayed** — never
 * this site's opinion. The engine enforces both windows on the write, and it
 * computes these two with the identical comparison at read time, so relaying
 * them is what stops the page offering a button that is certain to 409. There
 * is no deadline field on the wire, only the window in hours, so the *sentence*
 * about when free changes end is derived (`startTs - cancelWindowHours`); the
 * *buttons* are not.
 */
export interface BookingManageDto {
  bookingId: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  /** The booking this one was moved from, when it is itself a move — the id the
   * customer's calendar entry was created under. */
  rescheduledFromId: string | null;
  startTs: number;
  endTs: number;
  serviceId: string | null;
  /** «Unknown service» when the catalogue row was deleted; never blank. */
  serviceName: string;
  resourceId: string | null;
  resourceName: string;
  /** The child, when the parent named one. */
  bookedForName: string | null;
  /** Non-null when this booking is one child of a family visit. */
  partySequenceId: string | null;
  /** What the salon charged for THIS booking, surcharge included. */
  amountOre: number;
  cancelWindowHours: number;
  rescheduleWindowHours: number;
  canCancel: boolean;
  canReschedule: boolean;
}

/**
 * One line of a submission: a service, an instant, and whichever of the two
 * optional answers about the child the parent actually gave.
 *
 * Every optional field here is optional in the strict sense — **absent**, never
 * blank. The engine takes `booked_for_name` as `z.string().trim().min(1)
 * .optional()`, where `''` is a 400 rather than a shrug, and
 * `booked_for_birth_year` as `z.number().optional()`, which refuses the `null`
 * an emptied input serialises to. The create route coalesces as a second line
 * of defence; the step still has to send nothing rather than send emptiness,
 * because the moment anything else consumes this shape the coalescing is gone.
 */
export interface BookingSubmissionItem {
  serviceId: string;
  /** The stylist the slot RESOLVED to, not the visitor's «Første ledige»
   * preference — absent when the engine is still to choose. */
  resourceId?: string;
  startTs: number;
  bookedForName?: string;
  bookedForBirthYear?: number;
  /**
   * The saved child this line is for (SP10). Sent only when the parent is
   * logged in AND the phone being submitted is theirs — Medal resolves the
   * contact by phone, and an id under somebody else's number fails the whole
   * booking. The create route checks the same rule again.
   */
  bookedForPersonId?: string;
}

/**
 * What step 4 hands its caller, and what `POST /api/booking/create` takes.
 *
 * `consentMarketing` travels even though the engine's create body has nowhere
 * to put it: it is written separately to the GDPR consent endpoint once the
 * booking has succeeded. Leaving it off this shape would mean a box that is
 * ticked and then forgotten, which is worse than not offering it.
 */
export interface BookingSubmission {
  items: BookingSubmissionItem[];
  contact: { phone: string; name?: string; email?: string };
  notes?: string;
  consentTerms: boolean;
  consentMarketing: boolean;
  /**
   * Identifies the submission *attempt*, not the booking — one value minted
   * when step 4 comes up and resent unchanged on every retry of it.
   *
   * It is what turns a double-tapped «Bekreft» into one booking: the create
   * route hashes it together with this body to derive the `Idempotency-Key`, so
   * an identical retry derives an identical key. Absent, the route falls back to
   * a per-request key and the retry books twice — which is why it is on this
   * shape rather than added by whoever posts it.
   */
  submissionNonce?: string;
}

/**
 * The logged-in parent, as the wizard's «Bekreft» step wants them.
 *
 * A narrowing of `PortalProfileDto`, and the narrowing is the point. The
 * booking page reads the portal profile on the server when the visitor happens
 * to hold a Min side cookie, and hands the browser only what a booking form
 * has a use for: the name and number that prefill step 4, the address the
 * confirmation is sent to, and the children whose names step 4 asks for.
 * `contactId`, the marketing flag and the bransjemal labels stay on the server
 * — a prop that travels is a prop in the HTML, and none of those three is
 * anything the wizard renders.
 *
 * Nulls stay nulls, as in the portal DTO: `''` would make «Vipps gave us no
 * surname» indistinguishable from «the parent cleared the field».
 */
export interface BookingGuardian {
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  /** The children on the profile, for step 1's «Hvem skal klippes?». */
  family: BookingFamilyMember[];
}

/**
 * One child on the logged-in parent's profile, as the wizard sees them.
 *
 * `personId` is the id Medal keeps for the child (SP10/SP11), absent when the
 * profile could not name one — see `PortalFamilyMemberDto`. It is what a line
 * item is booked for (`booked_for_person_id`) and what «Samme som sist» joins
 * a past visit on. Optional fields are ABSENT rather than null, the rule every
 * wizard-shaped value follows.
 */
export interface BookingFamilyMember {
  name: string;
  birthYear: number;
  personId?: string;
  /** 1–12, when the parent gave one — makes the age exact across the birthday. */
  birthMonth?: number;
  /** «Fast frisør»: the stylist this child usually sees. A preference only. */
  preferredResourceId?: string;
  /**
   * The child's last COMPLETED visit, for the card's «Sist: Gutteklipp, 12.
   * aug» and step 2's «Samme som sist». Absent for a child with none, or one
   * the site cannot tell apart from a sibling.
   */
  lastVisit?: BookingLastVisit;
}

export interface BookingLastVisit {
  serviceId: string;
  serviceName: string | null;
  resourceId: string | null;
  startTs: number;
}
