import type { PaginationOptions } from "./common";

export interface Deal {
  id: string;
  title: string;
  value: number | null;
  currency: string | null;
  status: DealStatus;
  contact_id: string | null;
  stage_id: string | null;
  pipeline_id: string | null;
  expected_close_date: number | null;
  start_date: number | null;
  end_date: number | null;
  created_at: number;
  updated_at: number | null;
}

export type DealStatus =
  | "open"
  | "won"
  | "lost"
  | "negotiating"
  | "proposal_sent"
  | "on_hold"
  | "churned";

export interface CreateDealInput {
  title: string;
  value?: number;
  currency?: string;
  status?: DealStatus;
  contact_id?: string;
  stage_id?: string;
  pipeline_id?: string;
  expected_close_date?: number;
  start_date?: number;
  end_date?: number;
}

export interface UpdateDealInput {
  title?: string;
  value?: number;
  currency?: string;
  status?: DealStatus;
  contact_id?: string;
  stage_id?: string;
  pipeline_id?: string;
  expected_close_date?: number;
  start_date?: number;
  end_date?: number;
}

export interface ListDealsOptions extends PaginationOptions {
  status?: DealStatus;
  contact_id?: string;
}
