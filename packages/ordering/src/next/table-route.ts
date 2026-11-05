/**
 * The table route: resolves the token in a table's QR code to its location
 * and label, so the page can open the dine-in menu for that table.
 *
 * ```ts
 * // app/api/ordering/table/route.ts
 * export const GET = createTableRoute({ apiKey: process.env.MEDAL_API_KEY! });
 * ```
 *
 * `GET ?t=<token>` answers `{ data: OrderingTable }`, `private, no-store` as
 * Medal marks it. A malformed token is `400 INVALID_REQUEST` without a Medal
 * call; an unknown or archived table is `404 TABLE_NOT_FOUND`.
 */

import type { OrderingTable } from '@medalsocial/sdk';
import { parseTable, TABLE_QUERY_KEY } from '../core/deep-link';
import { invalidRequest, type RouteBaseOptions, readRoute } from './shared';

/** The slice of the SDK client the route uses — what a test injects. */
export interface TableClient {
  ordering: {
    table(token: string, request?: { signal?: AbortSignal }): Promise<{ data: OrderingTable }>;
  };
}

export type TableRouteOptions = RouteBaseOptions<TableClient>;

/** A Next App Router `GET` handler serving `{ data: OrderingTable }`. */
export function createTableRoute(
  options: TableRouteOptions
): (request: Request) => Promise<Response> {
  return readRoute<TableClient, string>(options, {
    parse(request) {
      const token = parseTable(new URL(request.url).searchParams.get(TABLE_QUERY_KEY));
      if (token === null) return { error: invalidRequest('t must be a table token.') };
      return { args: token };
    },
    call: (api, token, signal) => api.ordering.table(token, { signal }),
    notFound: { status: 404, code: 'TABLE_NOT_FOUND', message: 'No such table.' },
    cacheControl: 'private, no-store',
  });
}
