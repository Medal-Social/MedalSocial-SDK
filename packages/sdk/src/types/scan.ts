/** Input for creating a scan — provide exactly ONE of `url`, `orgnr`, or `name`. */
export interface ScanCreateInput {
  /** Website URL to scan directly (https is assumed when the scheme is missing). */
  url?: string;
  /** 9-digit Norwegian organisation number — resolved via the public registry. */
  orgnr?: string;
  /** Company name — resolved to the best registry match before scanning. */
  name?: string;
}

/** Reference returned when a scan job is queued (HTTP 202). */
export interface ScanCreateResult {
  id: string;
  status: "pending" | string;
  message?: string;
}

/** Lifecycle of an asynchronous scan job. */
export type ScanStatus = "pending" | "running" | "done" | "failed";

/** A company-registry search hit from `scan.companies()`. */
export interface ScanCompany {
  orgnr: string;
  name: string;
  org_form: string | null;
  industry: string | null;
  city: string | null;
  website: string | null;
}

/** Nettskår sub-scores (0–100); null = the axis could not be measured. */
export interface ScanSubScores {
  fart: number | null;
  google: number | null;
  ai: number | null;
  trygghet: number | null;
  omdomme: number | null;
}

/**
 * The versioned scan findings payload. Shapes within are additive per
 * `version`; string unions stay open (`| string`) so new detections never
 * break consumers.
 */
export interface ScanResultPayload {
  version: number;
  /** Weighted composite score (0–100); null when nothing could be measured. */
  nettskaar: number | null;
  subScores: ScanSubScores;
  registry?: {
    orgnr: string;
    navn: string;
    organisasjonsform?: string;
    naeringBeskrivelse?: string;
    antallAnsatte?: number;
    poststed?: string;
  };
  signals: {
    version: number;
    tech: string[];
    pixels: string[];
    consent: string[];
    commerce: string[];
    marketing?: string[];
    social: Record<string, string | undefined>;
    emailProvider?: string;
    unreachable?: boolean;
    inconclusive?: boolean;
    dnsPending?: boolean;
  };
  pagespeed?: {
    mobileScore?: number;
    lcpMs?: number;
    cls?: number;
    inpMs?: number;
    error?: string;
  };
  seo: {
    titleLength: number;
    metaDescriptionLength: number;
    h1Count: number;
    hasOg: boolean;
    hasCanonical: boolean;
    hreflangCount: number;
    hasViewport: boolean;
  };
  ai: {
    /** null = llms.txt could not be checked (unknown), false = confirmed absent. */
    llmsTxtFound: boolean | null;
    /** null = robots.txt could not be read (unknown, not "none blocked"). */
    blockedBots: string[] | null;
    jsonLdTypes: string[];
    faqFound: boolean;
  };
  gdpr: {
    /**
     * true = tracking pixels load with no consent platform; false = clean or
     * a consent platform is present; null = unknown (unreachable / JS-only).
     */
    trackingBeforeConsent: boolean | null;
    cmp: string | null;
    privacyPageFound: boolean;
  };
  mailAuth: {
    spf: "ok" | "missing" | "unknown" | string;
    dmarc: "ok" | "missing" | "unknown" | string;
    dmarcPolicy?: string;
  };
  httpsOk: boolean;
}

/** A scan job as returned by `scan.get()`. */
export interface ScanJob {
  id: string;
  status: ScanStatus | string;
  input: ScanCreateInput;
  resolved: {
    orgnr?: string;
    companyName?: string;
    websiteUrl?: string;
  } | null;
  result: ScanResultPayload | null;
  /** Public-safe failure code (`company_not_found`, `no_website`, …). */
  error: string | null;
  created_at: string | null;
  finished_at: string | null;
}

/** Options for `scan.waitForResult()`. */
export interface WaitForScanOptions {
  /** Poll interval in milliseconds. Default 2500. */
  intervalMs?: number;
  /** Give up after this long. Default 120000 (scans normally finish in ~30 s). */
  timeoutMs?: number;
}
