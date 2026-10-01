/**
 * A stylist's name as a parent should read it.
 *
 * Medal's resource names are the salon's admin labels — «siv», «Bjarne
 * (Salong Demo)» — and every screen that names a stylist (step 2, the summary
 * bar, the confirmation, the manage page) goes through this rather than
 * printing them raw. Idempotent, so a name already cleaned upstream, or
 * restored from a stored confirmation, can pass through again safely.
 */

/** Every trailing «(…)» group — the admin's notes, «(Salong Demo) (vikar)» — so
 * cleaning an already-cleaned name changes nothing. */
const TRAILING_SUFFIX = /(?:\s*\([^()]*\))+\s*$/u;

export function stylistDisplayName(name: string): string {
  const trimmed = name.trim();
  // A name that is nothing BUT a suffix keeps it: a blank card is worse than
  // an odd one, and the salon can see and fix the odd one.
  const stripped = trimmed.replace(TRAILING_SUFFIX, '').trim() || trimmed;
  if (stripped === '') return '';
  return `${stripped.charAt(0).toLocaleUpperCase('nb-NO')}${stripped.slice(1)}`;
}

/**
 * Up to two initials, from the first LETTER of the first two words that have
 * one — so «Bjarne (Salong Demo)» is «B», never «B(», and «Åse Ødegård» is «ÅØ».
 */
export function initialsOf(name: string): string {
  return stylistDisplayName(name)
    .split(/\s+/u)
    .map((word) => word.match(/\p{L}/u)?.[0])
    .filter((letter): letter is string => letter !== undefined)
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('nb-NO');
}
