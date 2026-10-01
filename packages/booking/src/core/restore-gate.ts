import { ATTEMPT_TTL_MS, attemptStorageKey } from './attempt-store';
import { DRAFT_MAX_AGE_MS, draftStorageKey } from './draft-store';

/**
 * Whether this tab's storage holds something the booking wizard's mount effect
 * will restore — a confirmation, a submission still owed an answer, or (behind
 * `?resume=1`) a Vipps draft — read WITHOUT consuming or minting anything.
 *
 * It mirrors the mount effect's own order and rules (the attempt TTL, the
 * draft's 30-minute window and its future-stamp refusal, a link — «Bestill
 * igjen» or any deep-link parameter, which is what `prefilled` means —
 * outranking a stored confirmation) so the gate is up exactly when the
 * screen is about to change.
 *
 * SELF-CONTAINED ON PURPOSE: its source is inlined as a script by
 * `restoreGateScript`, so it may reference nothing but its arguments and
 * browser globals. Only the storage reads are guarded; anything else that
 * throws (a stray module reference) surfaces in the tests instead of
 * silently reading as «nothing to restore».
 */
export function restorePendingInStorage(
  attemptKey: string,
  attemptTtlMs: number,
  draftKey: string,
  draftMaxAgeMs: number,
  prefilled: boolean,
  resuming: boolean
): boolean {
  const read = (key: string): Record<string, unknown> | null => {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(key) || 'null');
      return value !== null && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  };
  const now = Date.now();
  const attempt = read(attemptKey);
  const live =
    attempt !== null &&
    typeof attempt.nonce === 'string' &&
    typeof attempt.at === 'number' &&
    now - attempt.at <= attemptTtlMs;
  if (live && attempt.pending !== undefined) return true;
  // A link outranks a stored confirmation — the mount effect forgets it and
  // carries on — so only an unlinked visit is about to show one.
  if (live && attempt.confirmed !== undefined && !prefilled) return true;
  if (!resuming) return false;
  const draft = read(draftKey);
  if (draft === null || typeof draft.savedAt !== 'number') return false;
  const age = now - draft.savedAt;
  return age >= 0 && age <= draftMaxAgeMs && Array.isArray(draft.items) && draft.items.length > 0;
}

/**
 * The same check, as the script the SERVER's HTML carries.
 *
 * The server cannot see this tab's storage, so it always renders step 1 — and
 * hydration must match it. This runs while the HTML is parsed, before first
 * paint, and marks the wizard root `data-restoring` when there is something to
 * restore; CSS then hides step 1 behind the skeleton until React takes over.
 * If React never takes over, a timer lifts the mark after
 * `RESTORE_FALLBACK_MS`. The expression evaluates to the check's answer, which is what lets a test
 * tell «nothing to restore» from «the script broke».
 */
/** How long the pre-hydration gate may hide step 1 before it gives up. */
export const RESTORE_FALLBACK_MS = 10_000;

function restoreGateScript(
  namespace: string,
  rootId: string,
  prefilled: boolean,
  resuming: boolean
): string {
  const args = [
    attemptStorageKey(namespace),
    ATTEMPT_TTL_MS,
    draftStorageKey(namespace),
    DRAFT_MAX_AGE_MS,
    prefilled,
    resuming,
  ].map((value) => JSON.stringify(value));
  const id = JSON.stringify(rootId);
  // The fallback: if React has not taken the root over (`data-hydrated`)
  // within RESTORE_FALLBACK_MS — a script error, a stalled bundle — step 1 is
  // shown again rather than a skeleton for ever.
  return `(function(){var on=(${restorePendingInStorage.toString()})(${args.join(',')});if(on){var r=document.getElementById(${id});if(r){r.setAttribute('data-restoring','');setTimeout(function(){var n=document.getElementById(${id});if(n&&!n.hasAttribute('data-hydrated'))n.removeAttribute('data-restoring')},${RESTORE_FALLBACK_MS})}}return on})()`;
}

export interface RestoreGate {
  restorePendingInStorage: typeof restorePendingInStorage;
  restoreGateScript(rootId: string, prefilled: boolean, resuming: boolean): string;
}

/** The gate for the stores under `namespace` (see `createStores`). */
export function createRestoreGate(namespace: string): RestoreGate {
  return {
    restorePendingInStorage,
    restoreGateScript: (rootId, prefilled, resuming) =>
      restoreGateScript(namespace, rootId, prefilled, resuming),
  };
}
