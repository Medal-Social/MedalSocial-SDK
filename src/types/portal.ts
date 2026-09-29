import type {
  BookingPaymentMode,
  BookingPaymentStatus,
  BookingStatus,
  RelationType,
} from "./bookings";

/**
 * Locale of the one-time-code e-mail. The API accepts exactly these two —
 * `nb`, `nn`, `no-NB` and every other spelling of Norwegian are a
 * `400 VALIDATION_ERROR`.
 */
export type PortalLocale = "no" | "en";

/** Input for starting an e-mail one-time-code login. */
export interface PortalLoginStartInput {
  /** The address the code is sent to. */
  email: string;
  /** Locale for the e-mail (`no` or `en`); the workspace default when omitted. */
  locale?: PortalLocale;
}

/**
 * Result of a login start. Always `"sent"`, whether or not the address is a
 * known contact — the route is enumeration-safe by design.
 */
export interface PortalLoginStartResult {
  status: "sent";
}

/** Input for exchanging an e-mailed code for a portal session. */
export interface PortalVerifyInput {
  /** The address the code was sent to. */
  email: string;
  /** The one-time code from the e-mail. */
  code: string;
}

/** The contact a portal session belongs to. */
export interface PortalContactSummary {
  contact_id: string;
  first_name: string | null;
}

/**
 * A portal session. `session_token` is a bearer credential for ONE contact —
 * keep it in an HttpOnly cookie on the site's server and never hand it to
 * the browser.
 */
export interface PortalSession {
  session_token: string;
  /** Unix timestamp in milliseconds. */
  expires_at: number;
  /** ISO 8601 twin of `expires_at`. */
  expires_at_iso: string;
  contact: PortalContactSummary;
}

/**
 * A family member as the contact WRITES it through `PATCH /me` `family`.
 * Entries match on `name` + `birth_year`; to edit one child without changing
 * its id, use `portal.persons.update(...)` instead.
 */
export interface PortalFamilyMember {
  name: string;
  birth_year: number;
  /**
   * Accepted so a client can send back what `GET /me` returned, and IGNORED —
   * entries still match on name and birth year.
   */
  person_id?: string;
  /** Accepted and ignored, like `person_id`. */
  birth_month?: number | null;
}

/**
 * A family member as the portal READS it back (`GET /me`, the export): the
 * written pair plus the person's stable id and birth month, so a client can
 * edit a child by id through `portal.persons.update(...)`.
 */
export interface PortalFamilyEntry {
  /** The stable id of the underlying {@link PortalPerson}. */
  person_id: string;
  name: string;
  birth_year: number;
  /** 1–12, or `null` when unknown. */
  birth_month: number | null;
}

/** A person the contact books for — a child, a pet — with no login of its own. */
export interface PortalPerson {
  person_id: string;
  name: string;
  birth_year: number | null;
  /** 1–12, or `null`. Makes the age exact across the birthday. */
  birth_month: number | null;
  relation_type: RelationType;
  relation_label: string | null;
  /** The customer-visible note; the salon's internal note is never exposed. */
  notes: string | null;
  /**
   * The resource (barber, chair) this person usually sees. A preference only —
   * availability does not honour it.
   */
  preferred_resource_id: string | null;
  /** `false` for a person the customer removed or that was promoted to its own contact; `me` returns active persons only, the export returns all. */
  active: boolean;
}

/** The workspace's own words for the person concept, e.g. `"Barn"`. */
export interface PortalLabels {
  person: string;
  persons: string;
}

/** The signed-in contact's own profile. */
export interface PortalProfile {
  contact_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  family: PortalFamilyEntry[];
  persons: PortalPerson[];
  labels: PortalLabels;
  marketing_consent: boolean;
  /** Unix timestamp in milliseconds. */
  created_at: number;
}

/** Fields the signed-in contact may change on their own profile. */
export interface PortalProfilePatch {
  first_name?: string;
  last_name?: string;
  /** `null` clears the number. */
  phone?: string | null;
  /** Replaces the whole list. */
  family?: PortalFamilyMember[];
  /** Records a marketing_email consent change with source 'portal'. */
  marketing_consent?: boolean;
}

/**
 * Input for `portal.persons.create(...)` — a child owned by the signed-in
 * contact, created with relation `guardian`. STRICT on the server: any other
 * key is a `400 VALIDATION_ERROR` naming it.
 */
export interface PortalPersonCreateInput {
  /** Trimmed, 1–60 characters. */
  name: string;
  /** An integer within the last 18 years — the portal's persons are children. */
  birth_year: number;
  /** 1–12; not later than the current month when `birth_year` is this year. */
  birth_month?: number;
  /** The customer-visible note, at most 2000 characters. */
  notes?: string;
  /** A live resource of this workspace, or `404 NOT_FOUND`. */
  preferred_resource_id?: string;
}

/**
 * Input for `portal.persons.update(...)`. Partial and STRICT; `null` clears
 * `birth_month`, `notes` and `preferred_resource_id`. An empty patch changes
 * nothing. The `person_id` never changes.
 */
export interface PortalPersonPatch {
  name?: string;
  birth_year?: number;
  birth_month?: number | null;
  notes?: string | null;
  preferred_resource_id?: string | null;
}

/** Lifecycle state of a booking as seen from the portal. */
export type PortalBookingStatus = BookingStatus;

/** One of the signed-in contact's bookings. */
export interface PortalBooking {
  booking_id: string;
  status: PortalBookingStatus;
  /**
   * Unix timestamp in MILLISECONDS — unlike `/api/v1/bookings/*`, where
   * `start_ts` is an ISO 8601 string. The portal endpoints answer both forms:
   * the number here and the ISO twin below. (The API is inconsistent between
   * the two surfaces; the SDK encodes what each endpoint actually returns
   * rather than normalising one into the other.)
   */
  start_ts: number;
  /** Unix timestamp in milliseconds. */
  end_ts: number;
  /** ISO 8601 twin of `start_ts`. */
  start_ts_iso: string;
  /** ISO 8601 twin of `end_ts`. */
  end_ts_iso: string;
  service_id: string | null;
  service_name: string | null;
  resource_id: string | null;
  resource_name: string | null;
  booked_for_name: string | null;
  /**
   * The `person_id` of the contact's {@link PortalPerson} this visit is for;
   * `null` when it is for the contact themselves. Stable across a rename —
   * join on this, not on `booked_for_name`.
   */
  booked_for_person_id: string | null;
  /** The birth year recorded on the booking when it was made. */
  booked_for_birth_year: number | null;
  /** The birth month (1–12) recorded beside the year when the person had one; `null` otherwise. */
  booked_for_birth_month: number | null;
  /** Integer øre, or `null` when the service has no price. */
  amount_ore: number | null;
  /** What the booking required when it was made. */
  payment_mode: BookingPaymentMode;
  /** What has actually been paid. */
  payment_status: BookingPaymentStatus;
  notes: string | null;
  /** Present only while the booking is upcoming and manageable; opens the site's manage page. */
  manage_token: string | null;
  can_manage: boolean;
}

/** The signed-in contact's bookings, split around now. */
export interface PortalBookings {
  upcoming: PortalBooking[];
  past: PortalBooking[];
}

/** A consent decision included in a portal data export. */
export interface PortalConsentRecord {
  consent_type: string;
  granted: boolean;
  /** Unix timestamp in milliseconds, or `null`. */
  granted_at: number | null;
  /** Unix timestamp in milliseconds, or `null`. */
  revoked_at: number | null;
  /** ISO 8601 twin of `granted_at`. */
  granted_at_iso: string | null;
  /** ISO 8601 twin of `revoked_at`. */
  revoked_at_iso: string | null;
  source: string;
}

/** A relation the exporting contact is a party to; only the counterpart's display name is exposed. */
export interface PortalExportRelation {
  direction: "outgoing" | "incoming";
  type: RelationType;
  custom_label: string | null;
  since: number | null;
  note: string | null;
  counterpart_name: string;
}

/** Everything the workspace holds about the signed-in contact (GDPR Art. 15). */
export interface PortalExport {
  /** Unix timestamp in milliseconds. */
  exported_at: number;
  contact: PortalProfile;
  family: PortalFamilyEntry[];
  consents: PortalConsentRecord[];
  bookings: PortalBooking[];
  relations: PortalExportRelation[];
}

// -- "Log in with Vipps" (Medal Bookings SP8a) --

/** Input for starting a Vipps login. */
export interface PortalVippsStartInput {
  /**
   * Where Vipps sends the customer back. Must be an `https` URL under one of the
   * workspace's own sites, or the call is refused with
   * `400 INVALID_RETURN_URL` — the allow-list is the salon's site origins, not
   * a pattern you supply.
   */
  return_url: string;
  /**
   * Optional, recommended: an opaque value (32–128 characters) your server
   * mints per login attempt and also sets as an HttpOnly SameSite=Lax cookie
   * (Medal stores only its SHA-256), then sends again
   * with {@link PortalVippsLinkVerifyInput.browser_binding}. It ties a
   * `confirm_email` link to the browser that started the login, so a link
   * copied into another browser cannot be confirmed there.
   */
  browser_binding?: string;
  /**
   * Language of the code e-mail Medal sends when the login lands on
   * `confirm_email`. Defaults to `no`.
   */
  locale?: PortalLocale;
}

/** What `portal.login.vipps.start(...)` hands back. */
export interface PortalVippsStart {
  /**
   * Send the customer here UNCHANGED. It carries a one-time `state`, so it is
   * never cached and never reused — start again instead.
   */
  authorize_url: string;
}

/** Input for exchanging the one-time grant the callback put on your return URL. */
export interface PortalVippsExchangeInput {
  /**
   * The `grant` query parameter Vipps' callback appended to your `return_url`.
   * Single-use: a second exchange answers `404 GRANT_NOT_FOUND`, which is also
   * the answer for an expired grant or one minted under another workspace.
   */
  grant: string;
}

/**
 * A portal session minted from a Vipps login. Same credential as
 * {@link PortalSession}, plus the ISO twin of `expires_at`; it carries no
 * `contact` summary — read {@link PortalProfile} through
 * `medal.portal.session(token).profile()` when you need the name.
 */
export interface PortalVippsSession {
  session_token: string;
  /** Unix timestamp in milliseconds. */
  expires_at: number;
  /** ISO 8601 twin of `expires_at`. */
  expires_at_iso: string;
}

/**
 * What the Vipps callback appended to your `return_url` — the `vipps` query
 * parameter. Absent entirely on success, when `grant` is set instead.
 *
 * - `confirm_email` — Vipps verified the customer and they match one existing
 *   contact that could not be linked on its own. Medal e-mailed a six-digit
 *   code to that contact's address; ask for it and call
 *   `portal.login.vipps.verifyLink({ link, code })`. `link` and (usually) `to`
 *   come with it — see {@link PortalVippsCallbackParams}.
 * - `cancelled` — the customer declined at Vipps.
 * - `needs_email_login` — no contact could be decided safely, or Vipps returned
 *   no verified e-mail: offer the e-mail code login.
 * - `failed` — the exchange with Vipps failed after a valid start: retry.
 */
export type PortalVippsCallbackOutcome =
  | "confirm_email"
  | "cancelled"
  | "needs_email_login"
  | "failed";

/**
 * The query parameters the Vipps callback appends to your `return_url`.
 * Exactly one of `grant` or `vipps` is set.
 */
export interface PortalVippsCallbackParams {
  /** Success: exchange it with `portal.login.vipps.exchange({ grant })` within 60 seconds. */
  grant?: string;
  vipps?: PortalVippsCallbackOutcome;
  /** With `vipps=confirm_email`: the pending link to confirm (single use, 15 minutes). */
  link?: string;
  /**
   * With `vipps=confirm_email`: the address the code went to, masked
   * (`k•••@g•••.com`). Present only when the contact was found by the
   * Vipps-verified e-mail; absent when it was found by phone — show a generic
   * "we sent you a code" then. Render it as text only, never send it back, and
   * strip `grant` / `link` / `to` from the address bar and keep them out of
   * analytics and logs.
   */
  to?: string;
}

/** Input for confirming a pending Vipps link with the e-mailed code. */
export interface PortalVippsLinkVerifyInput {
  /** The `link` the callback put on your return URL with `?vipps=confirm_email`. */
  link: string;
  /** The six-digit code the customer received at the masked address. */
  code: string;
  /**
   * The same value you sent as {@link PortalVippsStartInput.browser_binding}
   * when this login started, read back from the customer's cookie. REQUIRED
   * when start carried one — missing or different is the same
   * `401 PORTAL_CODE_INVALID` as a wrong code.
   */
  browser_binding?: string;
}
