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

export type ConsentType = "marketing_email" | "analytics_tracking" | "third_party_sharing";

export interface RecordConsentInput {
  email: string;
  consent_type: ConsentType;
  granted: boolean;
  source?: string;
  ip_address?: string;
  consent_text?: string;
  version?: string;
}

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

export interface ConsentResult {
  id: string;
}

/** @deprecated Use `ConsentRecord[]` for `gdpr.getConsent()` responses. */
export type ContactConsents = ConsentRecord[];

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

export interface CookieCategoryConsent {
  allowed: boolean;
  cookieRecords?: {
    cookie: string;
    duration: string;
    description: string;
  }[];
}
