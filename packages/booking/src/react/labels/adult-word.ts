import { isBookingLabel } from '../../core/labels';

/**
 * A site that chose its own `people.adult` keeps it for several grown-ups too:
 * the built-in «Person {n}» would replace the site's word. Without its own
 * `wizard.party.adult` among `layers`, the numbered key is dropped from
 * `merged` (in place), and every such seat reads `people.adult` as before.
 * A site opts in to numbering by setting `wizard.party.adult` itself.
 */
export function keepSiteAdultWord(
  merged: Record<string, unknown>,
  layers: ReadonlyArray<Readonly<Record<string, unknown>> | null | undefined>
): void {
  const sets = (key: string) => layers.some((layer) => isBookingLabel(layer?.[key]));
  if (sets('people.adult') && !sets('wizard.party.adult')) delete merged['wizard.party.adult'];
}
