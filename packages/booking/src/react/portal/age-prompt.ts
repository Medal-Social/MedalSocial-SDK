import type { BookingConfig } from '../../core/config';

/**
 * «Confirm the age» — the cookie that remembers which children the visitor
 * has already answered for on this device: a plain, script-readable list of
 * the backend's opaque person ids (no name, no year), scoped to the portal.
 * A cookie rather than `localStorage` because the server page reads it, so
 * the card is in the first paint or not at all.
 *
 * Free of `'use client'`: the editor writes it in the browser, the page parses
 * it on the server.
 */

/** A family is at most ten; room for a few removed children as well. */
export const AGE_PROMPT_MAX_IDS = 20;

/** The shape the person actions accept for an id. */
const PERSON_ID = /^[\w-]{1,64}$/;

/** A year: long enough to outlive a season, short enough to lapse. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** The cookie's default name: `<portal cookie>_age_ok`. */
export function agePromptCookieName(config: Pick<BookingConfig, 'portal'>): string {
  return `${config.portal.cookieName}_age_ok`;
}

/** The ids in the cookie's value; anything that is not an id is dropped. */
export function parseAgePromptDismissed(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .filter((id) => PERSON_ID.test(id))
    .slice(0, AGE_PROMPT_MAX_IDS);
}

/** A `document.cookie` assignment remembering `ids` — the newest kept past the cap. */
export function agePromptCookie(name: string, path: string, ids: readonly string[]): string {
  const unique = [...new Set(ids.filter((id) => PERSON_ID.test(id)))].slice(-AGE_PROMPT_MAX_IDS);
  return `${name}=${unique.join(',')}; Path=${path}; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
}
