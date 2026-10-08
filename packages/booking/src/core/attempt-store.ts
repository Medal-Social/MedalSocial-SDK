import type { WizardItem, WizardState } from './machine';
import type { BookingSubmission } from './types';

/**
 * One booking attempt, kept where a page reload cannot reach it.
 *
 * The wizard's own state is React state, and React state does not survive a
 * reload — which would be unremarkable if reloading were not the visitor's ONLY
 * escape from a create request that never answers. Everything here exists for
 * that one moment: the engine has committed the appointment, the response was
 * lost, and the browser is now showing a spinner that will never stop.
 *
 * Three things have to outlive the page for that to end well:
 *
 * 1. The NONCE, which is half the create route's `Idempotency-Key`.
 * 2. The SUBMISSION it was sent with, which is the other half. A nonce alone is
 *    not enough and it took a second look to see why: after the reload the
 *    wizard restarts empty, and if the booking did commit then the slot the
 *    visitor had is now occupied by their own appointment and gone from
 *    availability. They cannot reconstruct the body even if they want to, so
 *    they pick a different time — a different body, a different key, and a
 *    second haircut for the same child.
 * 3. The CONFIRMATION, when one was received. The engine mints each manage
 *    token once and returns the plaintext exactly once; it stores only a hash.
 *    So a refresh of the confirmation screen before the visitor has saved the
 *    calendar file used to take every manage link with it, permanently, for a
 *    booking made without an e-mail address.
 *
 * `sessionStorage` and not `localStorage`: an attempt belongs to one tab. A
 * second tab booking a sibling is a different attempt and must not share a key.
 *
 * WHAT THIS PUTS AT REST, said plainly: a stored confirmation contains the
 * manage links, and a manage link is a bearer credential for that appointment.
 * It is the same credential that is already in the visitor's address bar, in
 * their e-mail, and in the calendar file they are about to download — so this
 * is not a new exposure so much as a shorter-lived copy of an existing one:
 * same origin, same tab, gone when the tab closes. The alternative is losing
 * the appointment's only handle to a refresh.
 */

/** `<namespace>:booking:attempt`. */
export function attemptStorageKey(namespace: string): string {
  return `${namespace}:booking:attempt`;
}

/**
 * How long a stored attempt is worth restoring.
 *
 * The point is to survive a refresh, which happens in seconds. An hour is
 * generous for that and short enough that a visitor coming back to `/bestill`
 * later in the same session gets the wizard rather than last time's
 * confirmation.
 *
 * The TTL is no longer the ONLY way out: the confirmation now carries a
 * «Bestill ny time» control that clears the attempt and mints a fresh one, so a
 * parent booking a sibling does not have to wait an hour or find another tab.
 * The age still matters for the visitor who simply closes the screen and comes
 * back — they never press anything, and an hour-old confirmation is not what
 * they returned for.
 */
export const ATTEMPT_TTL_MS = 60 * 60 * 1000;

/**
 * The visit as it was SUBMITTED, frozen when the POST left.
 *
 * «Bekreft»'s child-name inputs stay editable while the request is in flight, so
 * anything the confirmation reads off the live machine can describe a booking
 * that was never made: correct «Jonas» to «Emma» during a slow create and
 * Jonas's appointment is in Medal while the screen — and the calendar file —
 * both say Emma.
 */
export interface SubmittedVisit {
  items: WizardItem[];
  startTs: number;
  partyMode: WizardState['partyMode'];
  /** One resolved stylist per line, in basket order. */
  resourceIds: Array<string | null>;
  /**
   * Their NAMES, resolved at submit time and stored beside the ids.
   *
   * Not derivable after a reload: the names come from the stylist catalogue,
   * which the shell fetches for the basket's service — and a restored
   * confirmation has no basket, so that fetch never runs and every id resolves
   * to null. The refreshed card would lose the stylist from every line the
   * original card named.
   */
  stylistNames: Array<string | null>;
}

export interface ConfirmedBooking {
  id: string;
  manageHref: string | null;
}

export interface BookingAttempt {
  nonce: string;
  /** Sent, with no answer yet seen. Replayed on the next load. */
  pending?: { submission: BookingSubmission; submitted: SubmittedVisit };
  /** Answered. Kept so a refresh cannot take the manage links with it. */
  confirmed?: { bookings: ConfirmedBooking[]; submitted: SubmittedVisit };
}

interface StoredAttempt extends BookingAttempt {
  /** When this record was last written, for `ATTEMPT_TTL_MS`. */
  at: number;
}

export interface AttemptStore {
  readonly ATTEMPT_STORAGE_KEY: string;
  readAttempt(): BookingAttempt;
  rememberPending(attempt: BookingAttempt, pending: NonNullable<BookingAttempt['pending']>): void;
  rememberConfirmed(
    attempt: BookingAttempt,
    confirmed: NonNullable<BookingAttempt['confirmed']>
  ): void;
  releasePending(attempt: BookingAttempt): void;
  clearAttempt(): void;
}

/** The attempt store under `<namespace>:booking:attempt`. */
export function createAttemptStore(namespace: string): AttemptStore {
  const STORAGE_KEY = attemptStorageKey(namespace);

  /**
   * Every path through this module falls back to «no stored attempt» rather than
   * throwing.
   *
   * There is no `sessionStorage` during the server render, Safari's private mode
   * has historically thrown on write, and a visitor may simply have storage
   * turned off. Losing the idempotency guarantee is bad; refusing to let somebody
   * book a haircut because their browser will not hold a string is worse.
   */
  function readStored(): StoredAttempt | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredAttempt;
      if (typeof parsed?.nonce !== 'string' || typeof parsed?.at !== 'number') return null;
      if (Date.now() - parsed.at > ATTEMPT_TTL_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function write(attempt: BookingAttempt): void {
    if (typeof window === 'undefined') return;
    try {
      const stored: StoredAttempt = { ...attempt, at: Date.now() };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // The attempt goes on without the guarantee. See the note above.
    }
  }

  /**
   * The attempt this tab is on — the one already stored, or a fresh one.
   *
   * Reading MINTS and stores when there is nothing to read, so the nonce exists
   * from the moment the wizard mounts rather than from the moment somebody
   * presses «Bekreft time». A nonce created at submit would be created again by
   * the reload it is supposed to survive.
   */
  function readAttempt(): BookingAttempt {
    const stored = readStored();
    if (stored !== null) {
      const { at: _at, ...attempt } = stored;
      return attempt;
    }
    const fresh: BookingAttempt = { nonce: crypto.randomUUID() };
    write(fresh);
    return fresh;
  }

  /** Record what was just sent, BEFORE it is sent. A body stored after the
   * response is a body that is not there when the response never comes. */
  function rememberPending(
    attempt: BookingAttempt,
    pending: NonNullable<BookingAttempt['pending']>
  ): void {
    write({ nonce: attempt.nonce, pending });
  }

  /**
   * Record the answer, and drop the pending submission with it.
   *
   * Order matters on the next load: a stored confirmation is shown, a stored
   * pending submission is replayed. Leaving both would replay a booking that has
   * already been confirmed — harmless, because the key makes it a replay, but a
   * needless round trip on every reload of the confirmation.
   */
  function rememberConfirmed(
    attempt: BookingAttempt,
    confirmed: NonNullable<BookingAttempt['confirmed']>
  ): void {
    write({ nonce: attempt.nonce, confirmed });
  }

  /**
   * Drop the pending submission, keep the nonce.
   *
   * For a submission refused because the parent's session ran out
   * (`accountRequired`). Its body is not replayed — the next login may be
   * somebody else, who is asked again — but an EARLIER try of it may have
   * booked with its answer lost, and the same parent's resend after the login
   * has to derive the same key to meet that booking instead of making another.
   */
  function releasePending(attempt: BookingAttempt): void {
    write({ nonce: attempt.nonce });
  }

  /**
   * Forget the attempt entirely.
   *
   * For the failures that are certainly NOT «we do not know»: a slot that was
   * taken, or a body the engine refused. Both mean no appointment was made and
   * the visitor is about to build a different one, so replaying this on the next
   * load would resend a submission that has already been answered — with a
   * «Bekreft time» nobody pressed.
   */
  function clearAttempt(): void {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do, and nothing worth failing a booking over.
    }
  }

  return {
    ATTEMPT_STORAGE_KEY: STORAGE_KEY,
    readAttempt,
    rememberPending,
    rememberConfirmed,
    releasePending,
    clearAttempt,
  };
}
