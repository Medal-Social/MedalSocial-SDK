import type { PaginationOptions, TimestampInput } from "./common";

/**
 * The ISO-4217 codes a deal may carry.
 *
 * Closed on purpose: the API validates `currency` against exactly this list
 * (the same one the web picker enforces), so a code outside it is a
 * `400 VALIDATION_ERROR` rather than a stored value.
 */
export type DealCurrency = "USD" | "EUR" | "GBP" | "NOK";

/**
 * A sponsorship or brand deal in the workspace.
 *
 * **Date fields are asymmetric.** `start_date` / `end_date` are sent as ISO
 * 8601 (or `YYYY-MM-DD`) strings on `create` / `update`, but come BACK as Unix
 * milliseconds — the API stores them as ms and passes them straight through.
 * `created_at` / `updated_at` are always ISO 8601 strings.
 */
export interface Deal {
  id: string;
  title: string;
  description: string | null;
  /**
   * MAJOR currency units — 50000 is fifty thousand kroner, not 500. Decimals
   * are accepted (`1999.5`). Unlike bookings, which are integer øre
   * (`amount_ore`, `price_ore`), deals carry no minor-unit field at all, so a
   * caller that uses both surfaces must convert: `value = amount_ore / 100`.
   */
  value: number | null;
  currency: DealCurrency | null;
  status: DealStatus;
  brand_name: string | null;
  brand_website: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  /** Unix timestamp in milliseconds, or `null`. Sent as a string, returned as ms. */
  start_date: number | null;
  /** Unix timestamp in milliseconds, or `null`. Sent as a string, returned as ms. */
  end_date: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Result returned after creating a deal. */
export interface DealCreateResult {
  id: string;
}

/** Result returned after updating a deal. */
export interface DealUpdateResult {
  success: true;
}

/** Result returned after deleting a deal. */
export interface DealRemoveResult {
  success: true;
}

/**
 * Lifecycle stage of a sponsorship deal — the only six values a deal can hold.
 *
 * ```
 * draft → negotiating → offer_sent → signed → completed
 *                                          ↘ declined
 * ```
 *
 * A deal created through the API always starts at `draft`; `status` is only
 * accepted on `update`. Any other value is a `400 VALIDATION_ERROR`.
 */
export type DealStatus =
  | "draft"
  | "negotiating"
  | "offer_sent"
  | "signed"
  | "completed"
  | "declined";

/** Input for creating a new deal. */
export interface CreateDealInput {
  title: string;
  description?: string;
  value?: number;
  /** Defaults to the workspace currency when omitted. */
  currency?: DealCurrency;
  brand_name?: string;
  brand_website?: string;
  contact_id?: string;
  contact_name?: string;
  contact_email?: string;
  /** ISO 8601 date-time or `YYYY-MM-DD`. Read back as Unix ms on {@link Deal}. */
  start_date?: string;
  /** ISO 8601 date-time or `YYYY-MM-DD`. Read back as Unix ms on {@link Deal}. */
  end_date?: string;
  notes?: string;
}

/** Input for updating one or more fields on a deal. */
export interface UpdateDealInput {
  title?: string;
  description?: string;
  value?: number;
  /** Defaults to the workspace currency when omitted. */
  currency?: DealCurrency;
  status?: DealStatus;
  brand_name?: string;
  brand_website?: string;
  contact_id?: string | null;
  contact_name?: string;
  contact_email?: string;
  /** ISO 8601 date-time or `YYYY-MM-DD`. Read back as Unix ms on {@link Deal}. */
  start_date?: string;
  /** ISO 8601 date-time or `YYYY-MM-DD`. Read back as Unix ms on {@link Deal}. */
  end_date?: string;
  notes?: string;
}

/** Options for listing deals with pagination and filters. */
export interface ListDealsOptions extends PaginationOptions {
  status?: DealStatus;
  /** Free-text search across title, brand and contact fields. */
  search?: string;
  /** Inclusive lower bound on the deal's close (`end_date`). */
  close_date_from?: TimestampInput;
  /** Inclusive upper bound on the deal's close (`end_date`). */
  close_date_to?: TimestampInput;
  /** Only deals worth at least this much. */
  min_value?: number;
  /** Case-insensitive "contains" match against the brand / company name. */
  company_name?: string;
  /** Only deals linked to this contact. */
  contact_id?: string;
  /** Case-insensitive stage label match (e.g. `"offer sent"`). */
  stage?: string;
}
