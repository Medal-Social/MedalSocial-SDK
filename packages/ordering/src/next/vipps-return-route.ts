/**
 * The Vipps return route: where Vipps sends the guest back after paying (the
 * place-order route's `returnUrl`). Medal adds `?order_id=`; the route checks
 * the order is one Medal knows and sends the guest on to its receipt page.
 *
 * ```ts
 * // app/api/ordering/vipps-return/route.ts
 * export const GET = createVippsReturnRoute({
 *   apiKey: process.env.MEDAL_API_KEY!,
 *   receiptPath: '/order',       // → /order/<order id>
 *   fallbackPath: '/checkout',   // no or unknown order
 * });
 * ```
 *
 * Always a `303` to a path on this site (both paths are checked when the
 * route is created), never cached:
 *
 * - a known order → `${receiptPath}/<id>`;
 * - Medal unreachable (5xx, 429, network, timeout) → the receipt too: it
 *   polls the order, and the guest has just paid;
 * - no id, a malformed one, an unknown order or any other refusal (or no
 *   API key) → `fallbackPath`.
 */

import type { OrderingOrderStatusView } from '@medalsocial/sdk';
import {
  apiFailure,
  deadline,
  lazyClient,
  READ_DEADLINE_MS,
  type RouteBaseOptions,
  readOrderId,
  reporter,
} from './shared';

/** The slice of the SDK client the route uses — what a test injects. */
export interface VippsReturnClient {
  ordering: {
    orders: {
      status(
        orderId: string,
        request?: { signal?: AbortSignal }
      ): Promise<{ data: OrderingOrderStatusView }>;
    };
  };
}

export interface VippsReturnRouteOptions extends RouteBaseOptions<VippsReturnClient> {
  /**
   * The receipt page, a path on this site (`/order`); the guest lands on
   * `${receiptPath}/<order id>`. Starts with a single `/`; no query or
   * fragment. Anything else throws a `RangeError` when the route is created.
   */
  receiptPath: string;
  /**
   * Where a guest with no or an unknown order lands, a path on this site
   * (`/checkout`), query allowed. Starts with a single `/`; anything else
   * throws a `RangeError` when the route is created.
   */
  fallbackPath: string;
}

/** A path on this site: one leading `/`, then no `/` or `\` (which would name another host), no spaces. */
const SITE_PATH = /^\/(?![/\\])[^\s\\]*$/;
const RECEIPT_PATH = /^\/(?![/\\])[^\s\\?#]*$/;

function checkPath(name: string, value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new RangeError(
      `createVippsReturnRoute: ${name} must be a path on this site starting with a single /, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

/** Medal may answer differently soon: a 5xx, a 429, or no answer at all. */
function isTransient(error: unknown): boolean {
  const failure = apiFailure(error);
  return failure === null || failure.status >= 500 || failure.status === 429;
}

/** A Next App Router `GET` handler sending the guest back from Vipps. */
export function createVippsReturnRoute(
  options: VippsReturnRouteOptions
): (request: Request) => Promise<Response> {
  const receiptPath = checkPath('receiptPath', options.receiptPath, RECEIPT_PATH).replace(
    /\/+$/,
    ''
  );
  const fallbackPath = checkPath('fallbackPath', options.fallbackPath, SITE_PATH);
  const medal = lazyClient(options);
  const report = reporter(options.onError);

  /**
   * A relative `Location`: the browser resolves it against the URL it asked
   * for. `request.url` can name an internal host on Cloudflare or behind a
   * proxy, which a guest coming back from Vipps could not reach. Both paths
   * start with a single `/` (checked above), so it never leaves the site.
   */
  function redirect(path: string): Response {
    return new Response(null, {
      status: 303,
      headers: { location: path, 'cache-control': 'no-store' },
    });
  }

  return async function GET(request: Request): Promise<Response> {
    const id = readOrderId(new URL(request.url).searchParams.get('order_id'));
    if (id === null) return redirect(fallbackPath);
    const receipt = `${receiptPath}/${encodeURIComponent(id)}`;
    const api = medal();
    if (!api) {
      report(new Error('The Medal API key is not configured'));
      return redirect(fallbackPath);
    }
    try {
      await api.ordering.orders.status(id, { signal: deadline(request, READ_DEADLINE_MS) });
      return redirect(receipt);
    } catch (error) {
      report(error);
      return redirect(isTransient(error) ? receipt : fallbackPath);
    }
  };
}
