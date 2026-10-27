import { isBookingLabel } from '../../core/labels';

/** The built-in packs' numbered word (nb and en alike), which no site chose. */
export const BUILT_IN_ADULT_NUMBERED = 'Person {n}';

/**
 * A site that chose its own `people.adult` keeps it for several grown-ups too:
 * the built-in «Person {n}» would replace the site's word. `layers` are in
 * merge order (later wins). The built-in numbered key is dropped from `merged`
 * (in place) when the last layer that sets `people.adult` comes after the last
 * one that sets `wizard.party.adult` — so a whole built-in pack under a
 * component's own word does not count as opting in — and every such seat reads
 * `people.adult` as before. A site opts in to numbering by setting
 * `wizard.party.adult` itself, in the same layer as its word or a later one;
 * a numbered word of its own (not the built-in one) is always kept, wherever
 * it came from.
 */
export function keepSiteAdultWord(
  merged: Record<string, unknown>,
  layers: ReadonlyArray<Readonly<Record<string, unknown>> | null | undefined>
): void {
  if (merged['wizard.party.adult'] !== BUILT_IN_ADULT_NUMBERED) return;
  const last = (key: string) => layers.findLastIndex((layer) => isBookingLabel(layer?.[key]));
  if (last('people.adult') > last('wizard.party.adult')) delete merged['wizard.party.adult'];
}
