import type { PaginationOptions } from "./common";

/** A sponsorship or brand deal in the workspace. */
export interface Deal {
  id: string;
  title: string;
  description: string | null;
  value: number | null;
  currency: string | null;
  status: DealStatus;
  brand_name: string | null;
  brand_website: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  start_date: string | null;
  end_date: string | null;
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

/** Lifecycle stage of a sponsorship deal. */
export type DealStatus =
  | "draft"
  | "open"
  | "won"
  | "lost"
  | "negotiating"
  | "proposal_sent"
  | "on_hold"
  | "churned";

/** Input for creating a new deal. */
export interface CreateDealInput {
  title: string;
  description?: string;
  value?: number;
  currency?: string;
  brand_name?: string;
  brand_website?: string;
  contact_id?: string;
  contact_name?: string;
  contact_email?: string;
  start_date?: string;
  end_date?: string;
  notes?: string;
}

/** Input for updating one or more fields on a deal. */
export interface UpdateDealInput {
  title?: string;
  description?: string;
  value?: number;
  currency?: string;
  status?: DealStatus;
  brand_name?: string;
  brand_website?: string;
  contact_id?: string | null;
  contact_name?: string;
  contact_email?: string;
  start_date?: string;
  end_date?: string;
  notes?: string;
}

/** Options for listing deals with pagination and filters. */
export interface ListDealsOptions extends PaginationOptions {
  status?: DealStatus;
  search?: string;
}
