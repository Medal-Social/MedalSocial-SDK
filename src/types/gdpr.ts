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

/** Input for recording cookie consent from an external site. */
export interface CookieConsentInput {
  domain: string;
  consentStatus: "granted" | "denied" | "partial" | string;
  consentTimestamp: string;
  ipAddress?: string;
  userAgent?: string;
  cookiePreferences: {
    necessary?: CookieCategoryConsent;
    analytics?: CookieCategoryConsent;
    marketing?: CookieCategoryConsent;
    functional?: CookieCategoryConsent;
    [key: string]: CookieCategoryConsent | undefined;
  };
}

/** Consent decision and optional cookie records for a single cookie category. */
export interface CookieCategoryConsent {
  allowed: boolean;
  cookieRecords?: {
    cookie: string;
    duration: string;
    description: string;
  }[];
}
