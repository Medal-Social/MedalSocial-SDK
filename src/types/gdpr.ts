export interface GdprExport {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  requested_at: number;
  completed_at: number | null;
  download_url: string | null;
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
  consent_type: ConsentType;
  granted: boolean;
  granted_at: number | null;
  revoked_at: number | null;
  source: string;
}

export interface ConsentResult {
  consent_id: string;
  email: string;
  consent_type: ConsentType;
  granted: boolean;
}

export interface ContactConsents {
  email: string;
  consents: ConsentRecord[];
}

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
