/**
 * The request guards the portal routes share: same-origin checks, a bounded
 * body read and the origin a request arrived on.
 */

/** The subset of `Headers` these helpers read. Keeps them callable from tests. */
export type RequestHeaders = { get(name: string): string | null };

function isLocalhost(url: string): boolean {
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

/**
 * The host the browser asked for: `x-forwarded-host` when present, else `host`.
 *
 * Behind a proxy the bare `host` is the last hop, not what was typed. Only the
 * first value of a comma-joined list is used — the rest are upstream hops.
 */
function forwardedHost(headers: RequestHeaders): string | undefined {
  return (headers.get('x-forwarded-host') ?? headers.get('host'))?.split(',')[0]?.trim();
}

/**
 * The origin a request arrived on, from its headers, or `fallback`.
 *
 * For code that runs inside a Server Action, which has no `Request` to read
 * `url` from the way a route handler does. `x-forwarded-host` and
 * `x-forwarded-proto` win over `host` because on Cloudflare and behind Next's
 * own proxying they name the host the browser typed; a bare `host` is the
 * last hop. HTTPS is assumed whenever the proto header is missing and the
 * host is not local — an absolute URL handed to a third party should not
 * guess `http`.
 */
export function originFromHeaders(headers: RequestHeaders, fallback: string): string {
  const host = forwardedHost(headers);
  if (!host) return fallback;
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || (isLocalhost(`http://${host}`) ? 'http' : 'https');
  const origin = `${proto}://${host}`;
  try {
    return new URL(origin).origin;
  } catch {
    return fallback;
  }
}

/**
 * Whether the submission came from a page on somebody else's origin.
 *
 * The threat this answers is a page on another origin POSTing here on a
 * visitor's behalf — for which comparing the declared origin to this site's
 * own is sufficient, because a browser sets `Origin` on a cross-site POST and
 * will not let the page lie about it.
 *
 * A request that declares NEITHER `Origin` nor `Referer` is let through here;
 * the routes that mint a session refuse it on their own (`declaresNoOrigin`).
 *
 * An origin that will not parse — `null` from a sandboxed frame, or a garbled
 * one — is treated as somebody else's. It is not this site's.
 */
export function isCrossOriginRequest(request: Request): boolean {
  const declared = request.headers.get('origin') ?? request.headers.get('referer');
  if (!declared) return false;

  let declaredOrigin: string;
  try {
    declaredOrigin = new URL(declared).origin;
  } catch {
    return true;
  }

  // The host the browser typed, not the last hop: on Cloudflare the Worker's
  // own `request.url` can name an internal hostname the `Origin` never will.
  let ownOrigin: string;
  try {
    ownOrigin = new URL(request.url).origin;
  } catch {
    return true;
  }
  return declaredOrigin !== originFromHeaders(request.headers, ownOrigin);
}

/** Neither `Origin` nor `Referer`: every browser sends `Origin` on a `fetch` POST. */
export function declaresNoOrigin(request: Request): boolean {
  return !request.headers.get('origin') && !request.headers.get('referer');
}

/**
 * The request body as text, or `null` if it is over the ceiling.
 *
 * Read in pieces and counted in BYTES, which is the whole point of both
 * halves. `request.text()` buffers everything before anything can judge it,
 * and a decoded string's `.length` is UTF-16 code units, not bytes — so
 * measuring the decoded string against a byte limit lets a multibyte body
 * several times the ceiling straight through.
 *
 * The stream is cancelled the moment the count passes the ceiling, so the
 * remainder is never pulled across.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const body = request.body;
  // No stream to read — an empty body, or a runtime that does not expose one.
  // `text()` is bounded by the same ceiling rather than trusted.
  if (!body) {
    const fallback = await request.text();
    return new TextEncoder().encode(fallback).byteLength > maxBytes ? null : fallback;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
