/**
 * The portal's server actions, as the components take them (Decision 8).
 *
 * A library cannot ship a `'use server'` module reliably, so the app owns
 * one three-line wrapper per action and passes the wrappers in as props. The
 * shapes below are what the components call them with and what they read
 * back. An action may answer with the plain result, or with
 * next-safe-action's `{ data, serverError, validationErrors }` envelope
 * around it; `readAction` turns either into the one shape a form acts on.
 */

import type { VippsLinkStartResult, VippsStartAction } from '@medalsocial/meda/booking';
import type { PortalProfileDto } from '../core/portal/dto';

/** The session is gone (or never was): the visitor goes back to the login. */
export type SessionFailure = { ok: false; reason: 'session' };

/** The backend refused the input, with a sentence to show. */
export type InvalidFailure = { ok: false; reason: 'invalid'; message: string };

/** next-safe-action's envelope. */
export interface SafeActionEnvelope<T> {
  data?: T;
  serverError?: string;
  validationErrors?: unknown;
}

/** What an action may answer with: its result, or the envelope around it. */
export type ActionAnswer<T> = T | SafeActionEnvelope<T>;

export type ProfileActionResult =
  | { ok: true; profile: PortalProfileDto }
  | SessionFailure
  | InvalidFailure;

export type PersonActionResult =
  | { ok: true; profile: PortalProfileDto; personId: string | null; fallback: boolean }
  | SessionFailure
  | InvalidFailure;

/** A person as an action writes it (the wire's snake_case, as the source's schema). */
export interface PersonActionInput {
  name: string;
  birth_year: number;
  birth_month?: number | null;
  notes?: string | null;
  preferred_resource_id?: string | null;
}

/** Which person: the id, or the family index where there is none. */
export interface PersonActionTarget {
  person_id?: string | null;
  index?: number;
}

export interface PortalActions {
  /** Ask for a login code. Answers «sent» whether or not the address is known. */
  startLogin(input: { email: string }): Promise<ActionAnswer<{ status: 'sent' }>>;
  /** Start a Vipps login: a form action that redirects to Vipps, or answers why not. */
  startVipps?: VippsStartAction;
  /** Start linking Vipps to the logged-in profile. */
  startVippsLink?: () => Promise<VippsLinkStartResult>;
  updateProfile(input: {
    first_name?: string;
    last_name?: string;
    phone?: string | null;
  }): Promise<ActionAnswer<ProfileActionResult>>;
  setMarketingConsent(input: {
    granted: boolean;
  }): Promise<ActionAnswer<{ ok: true; marketingConsent: boolean } | SessionFailure>>;
  savePerson(
    input: PersonActionTarget & { person: PersonActionInput; create: boolean }
  ): Promise<ActionAnswer<PersonActionResult>>;
  removePerson(input: PersonActionTarget): Promise<ActionAnswer<PersonActionResult>>;
  logout(): Promise<ActionAnswer<{ ok: true }>>;
  exportData(): Promise<
    ActionAnswer<{ ok: true; filename: string; json: string } | SessionFailure>
  >;
  /** `confirm` is the typed confirmation word; the backend re-checks it. */
  deleteMe(input: { confirm: string }): Promise<ActionAnswer<{ ok: true } | SessionFailure>>;
}

/** Why an action did not come back `ok`: a dead session, or the sentence to show. */
export type ActionFailure = { kind: 'session' } | { kind: 'error'; message: string };

/** The first message zod attached, wherever next-safe-action nested it. */
function firstValidationMessage(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  const own = record._errors;
  if (Array.isArray(own) && typeof own[0] === 'string') return own[0];
  for (const [key, value] of Object.entries(record)) {
    if (key === '_errors') continue;
    const nested = firstValidationMessage(value);
    if (nested) return nested;
  }
  return null;
}

function isEnvelope<T>(answer: ActionAnswer<T> | undefined): answer is SafeActionEnvelope<T> {
  return (
    typeof answer === 'object' &&
    answer !== null &&
    !('ok' in answer) &&
    ('data' in answer || 'serverError' in answer || 'validationErrors' in answer)
  );
}

/**
 * An action's answer, read: `{ ok: true, value }`, or the failure a form acts
 * on. The action's own `message` wins over zod's, which wins over
 * `invalidInput`; anything unreadable (a thrown call, a server error, an
 * answer with nothing in it) is `unreachable`.
 */
export function readAction<T extends object>(
  answer: ActionAnswer<T> | undefined,
  words: { unreachable: string; invalidInput: string }
): { ok: true; value: T } | { ok: false; failure: ActionFailure } {
  const envelope = isEnvelope(answer) ? answer : undefined;
  const data = envelope ? envelope.data : (answer as T | undefined);
  if (data && typeof data === 'object') {
    const result = data as { ok?: unknown; reason?: unknown; message?: unknown };
    if (result.ok !== false) return { ok: true, value: data };
    if (result.reason === 'session') return { ok: false, failure: { kind: 'session' } };
    if (typeof result.message === 'string') {
      return { ok: false, failure: { kind: 'error', message: result.message } };
    }
  }
  if (envelope?.validationErrors) {
    const message = firstValidationMessage(envelope.validationErrors) ?? words.invalidInput;
    return { ok: false, failure: { kind: 'error', message } };
  }
  return { ok: false, failure: { kind: 'error', message: words.unreachable } };
}
