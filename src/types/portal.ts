import type { BookingStatus } from "./bookings";

/** Input for starting an e-mail one-time-code login. */
export interface PortalLoginStartInput {
  /** The address the code is sent to. */
  email: string;
  /** Locale for the e-mail (e.g. `nb`, `en`); the workspace default when omitted. */
  locale?: string;
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
  contact: PortalContactSummary;
}

/** A family member the contact books on behalf of. */
export interface PortalFamilyMember {
  name: string;
  birth_year: number;
}

/** The signed-in contact's own profile. */
export interface PortalProfile {
  contact_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  family: PortalFamilyMember[];
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

/** Lifecycle state of a booking as seen from the portal. */
export type PortalBookingStatus = BookingStatus;

/** One of the signed-in contact's bookings. */
export interface PortalBooking {
  booking_id: string;
  status: PortalBookingStatus;
  /** Unix timestamp in milliseconds. */
  start_ts: number;
  /** Unix timestamp in milliseconds. */
  end_ts: number;
  service_id: string | null;
  service_name: string | null;
  resource_id: string | null;
  resource_name: string | null;
  booked_for_name: string | null;
  /** Integer øre, or `null` when the service has no price. */
  amount_ore: number | null;
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
  source: string;
}

/** Everything the workspace holds about the signed-in contact (GDPR Art. 15). */
export interface PortalExport {
  /** Unix timestamp in milliseconds. */
  exported_at: number;
  contact: PortalProfile;
  family: PortalFamilyMember[];
  consents: PortalConsentRecord[];
  bookings: PortalBooking[];
}
