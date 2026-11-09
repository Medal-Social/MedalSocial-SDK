/**
 * Reserve with Google. Google appends `rwg_token` to its Book link; the wizard
 * keeps it for this visit and sends it with the booking, so Medal Social can
 * report the conversion from its server.
 *
 * `sessionStorage`, like the attempt: the referral belongs to one tab and is
 * gone when it closes. No cookie, and nothing goes to Google from the browser.
 */
const STORAGE_KEY = 'medal:booking:rwg';
/** Printable ASCII with no space: Google's token is opaque, so only its shape is checked. */
const TOKEN = /^[\x21-\x7E]{1,2048}$/;
/** Google attributes a booking to a click for 30 days. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface GoogleReferral {
  rwg_token: string;
  /** When the token first arrived in this tab, in epoch milliseconds. */
  captured_at: number;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage switched off: the booking goes on without the referral.
    return null;
  }
}

/** The stored referral, or null when there is none, it is malformed or it is too old. */
export function readGoogleReferral(now = Date.now()): GoogleReferral | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GoogleReferral> | null;
    if (typeof value?.rwg_token !== 'string' || !TOKEN.test(value.rwg_token)) return null;
    if (typeof value.captured_at !== 'number' || now - value.captured_at > TTL_MS) return null;
    return { rwg_token: value.rwg_token, captured_at: value.captured_at };
  } catch {
    return null;
  }
}

/**
 * Keep `rwg_token` from the landing URL's query string.
 *
 * A newer token replaces the stored one. The SAME token keeps its first
 * `captured_at`: a reload of the landing URL must not change the referral,
 * because a booking resent after that reload has to carry the body it was
 * first sent with (the create route's idempotency key covers a retry, and
 * Medal Social answers the same key with another body as a conflict).
 */
export function captureGoogleReferral(search: string, now = Date.now()): void {
  const token = new URLSearchParams(search).get('rwg_token');
  if (!token || !TOKEN.test(token)) return;
  if (readGoogleReferral(now)?.rwg_token === token) return;
  try {
    const referral: GoogleReferral = { rwg_token: token, captured_at: now };
    storage()?.setItem(STORAGE_KEY, JSON.stringify(referral));
  } catch {
    // A full or refused store loses the attribution, never the booking.
  }
}
