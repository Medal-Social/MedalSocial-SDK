/** A workspace data export request and its current status. */
export interface GdprExport {
  id: string;
  request_type: string;
  status: "pending" | "in_progress" | "completed" | "failed" | string;
  submitted_at: string | null;
  completed_at: string | null;
  due_date?: string | null;
  download_url?: string | null;
  expires_at?: string | null;
}

/** GDPR consent category. */
export type ConsentType = "marketing_email" | "analytics_tracking" | "third_party_sharing";

/** Input for recording a GDPR consent decision for a contact. */
export interface RecordConsentInput {
  email: string;
  consent_type: ConsentType;
  granted: boolean;
  source?: string;
  ip_address?: string;
  consent_text?: string;
  version?: string;
}

/** A stored consent record for a contact. */
export interface ConsentRecord {
  id: string;
  email: string;
  consent_type: ConsentType;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  source?: string;
  version?: string;
}

/** Result returned after recording a consent decision. */
export interface ConsentResult {
  id: string;
}

/** @deprecated Use `ConsentRecord[]` for `gdpr.getConsent()` responses. */
export type ContactConsents = ConsentRecord[];

/**
 * What happened to a visitor's cookie preferences.
 *
 * The endpoint records EVENTS, not a current state: `preferences_saved` when
 * the visitor chose, `preferences_revoked` when they withdrew,
 * `banner_displayed` when the banner was shown, `preferences_expired` when a
 * stored decision aged out.
 */
export type CookieConsentEvent =
  | "preferences_saved"
  | "preferences_revoked"
  | "banner_displayed"
  | "preferences_expired";

/**
 * The visitor's decision per category. Only these four keys are accepted —
 * the API rejects an unknown category rather than dropping it silently.
 *
 * `essential` is the cookies the site cannot run without and defaults to
 * `true`; the other three are `undefined` when the event does not state them
 * (a `banner_displayed` event, for instance, states no decision at all).
 */
export interface CookieConsentCategories {
  essential?: boolean;
  analytics?: boolean;
  marketing?: boolean;
  functional?: boolean;
}

/**
 * Input for recording a cookie consent event from an external site.
 *
 * Every string is bounded server-side; a value over its cap is a `400`, not a
 * truncation. `consentId` ≤ 128, `domain` ≤ 253, `visitorId` ≤ 128,
 * `ipAddress` ≤ 64, `userAgent` ≤ 512, `consentText` ≤ 2000,
 * `policyVersion` ≤ 64.
 *
 * The `domain` must be one your workspace's registered sites vouch for — its
 * host, the apex when the site was registered with a leading `www.`, or a
 * subdomain of either — otherwise the call is refused with `403`.
 */
export interface CookieConsentInput {
  /** What happened. */
  event: CookieConsentEvent;
  /** Your identifier for this consent record, unique per decision. */
  consentId: string;
  /** Hostname the consent was given on, e.g. `"example.com"`. */
  domain: string;
  /** Per-category decisions. */
  categories: CookieConsentCategories;
  /** Anonymous visitor identifier, if you keep one. */
  visitorId?: string;
  /**
   * Visitor IP. Optional — omit it and the API reads its trusted edge
   * headers. Either way only an anonymized value is ever stored (IPv4
   * truncated to /24, IPv6 to /48).
   */
  ipAddress?: string;
  /** Visitor user agent. Falls back to the request's own header. */
  userAgent?: string;
  /** The exact legal text the visitor was shown. */
  consentText?: string;
  /** Your cookie policy version, e.g. `"2.1"`. */
  policyVersion?: string;
  /**
   * When the visitor decided, in milliseconds since the epoch. Defaults to
   * the time the API receives it. Accepted up to 5 minutes ahead (clock skew)
   * and up to 7 days old.
   */
  timestamp?: number;
}

/** Result of recording a cookie consent event. */
export interface CookieConsentResult {
  success: boolean;
  /** Id of the audit log entry the event was written to. */
  logId?: string;
}

/**
 * @deprecated The API never accepted this shape. `cookieConsent()` was typed
 * against a `cookiePreferences` map of these objects, which the endpoint
 * rejects with `400`; it takes a flat `categories` object of booleans
 * (`CookieConsentCategories`). Kept only so the type name still resolves.
 */
export interface CookieCategoryConsent {
  allowed: boolean;
  cookieRecords?: {
    cookie: string;
    duration: string;
    description: string;
  }[];
}
