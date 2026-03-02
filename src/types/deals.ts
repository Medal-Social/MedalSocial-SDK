import type { PaginationOptions } from "./common";

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

export type DealStatus =
  | "draft"
  | "open"
  | "won"
  | "lost"
  | "negotiating"
  | "proposal_sent"
  | "on_hold"
  | "churned";

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

export interface ListDealsOptions extends PaginationOptions {
  status?: DealStatus;
  search?: string;
}
