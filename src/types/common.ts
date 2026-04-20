/** Successful API response wrapper */
export interface ApiResponse<T> {
  data: T;
}

/** Paginated API response */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
  };
}

/** API error thrown by the client */
export class MedalApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "MedalApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Pagination options for list endpoints */
export interface PaginationOptions {
  limit?: number;
  cursor?: string;
}
