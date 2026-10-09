/**
 * Secrets out of thrown errors — the portal session, the Vipps grant and the
 * token it buys, the API key — before anything up the stack logs them. One
 * helper for every server path that sends a secret to Medal: the portal seam
 * and the create route's forwarded session alike.
 */

/** What a portal session (or a token standing in for one) becomes in an error. */
export const REDACTED = '<session>';

/** A value that must not appear in an error, and the placeholder it becomes. */
export type Secret = { value: string; label: string };

/**
 * How far below the thrown error the scrub follows `cause` and
 * `AggregateError.errors`. Three is deeper than any chain the SDK or `fetch`
 * builds (undici wraps one `cause` under `fetch failed`), and a bound is
 * needed at all because `cause` may point back up the chain: an error that is
 * its own cause would otherwise recurse until the stack ran out.
 */
const REDACT_DEPTH = 3;

function scrub(text: string, session: string, label = REDACTED): string {
  return text.includes(session) ? text.split(session).join(label) : text;
}

/**
 * Scrub `message` and `stack` on `error` and on every `Error` hanging off it.
 *
 * `cause` and `errors` are followed because a logger prints them: Node's
 * `util.inspect`, Pino's error serializer and Sentry all walk the cause chain,
 * so a clean top-level message over an unscrubbed `cause.message` is the same
 * leak one level down. A string `cause` is rewritten in place for the same
 * reason; anything else there (a response object, say) is not a string a
 * logger prints verbatim and is left alone.
 */
function redactError(error: Error, session: string, depth: number, label = REDACTED): void {
  if (error.message.includes(session)) {
    // A getter-only `message` cannot be rewritten: leave it, scrub the rest.
    try {
      error.message = scrub(error.message, session, label);
    } catch {}
  }
  if (typeof error.stack === 'string' && error.stack.includes(session)) {
    error.stack = scrub(error.stack, session, label);
  }
  if (depth >= REDACT_DEPTH) return;
  if (error.cause instanceof Error) {
    redactError(error.cause, session, depth + 1, label);
  } else if (typeof error.cause === 'string') {
    error.cause = scrub(error.cause, session, label);
  }
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      if (inner instanceof Error) redactError(inner, session, depth + 1, label);
    }
  }
}

/**
 * Scrub `session` out of whatever was thrown, in place, and hand it back.
 *
 * In place rather than re-wrapped: callers up the stack switch on
 * `instanceof MedalApiError` and read `.status` / `.code`, and a fresh `Error`
 * would erase all three. `message` and `stack` are the two strings a logger
 * prints — on the error and, via `redactError`, on its `cause` chain;
 * `MedalApiError.details` is `readonly` and carries the engine's structured
 * body, which never echoes a request header.
 *
 * A non-`Error` throw that contains the session (a bare string, say) is
 * REPLACED — there is nothing else on it worth keeping, and nothing safe to
 * pass on.
 */
export function redactSession(error: unknown, session: string): unknown {
  return redactSecret(error, { value: session, label: REDACTED });
}

/** `redactSession` for any secret: the Vipps grant, the token it buys, the API key. */
export function redactSecret(error: unknown, secret: Secret): unknown {
  if (secret.value === '') return error;
  if (error instanceof Error) {
    redactError(error, secret.value, 0, secret.label);
    return error;
  }
  if (typeof error === 'string' && error.includes(secret.value)) {
    return new Error(scrub(error, secret.value, secret.label));
  }
  return error;
}
