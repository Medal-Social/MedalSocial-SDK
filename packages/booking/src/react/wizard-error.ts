import { DETAILS_ERROR_LABEL_KEYS } from '@medalsocial/meda/booking';
import { type BookingLabel, fill } from '../core/labels';
import type { WizardState } from '../core/machine';
import type { BookingLabels } from './labels';

/**
 * The sentence for the machine's error code. meda's map covers every code its
 * screens know; `maxServices` is newer than meda's copy of the union, so the
 * shell explains it itself — with the site's own per-person ceiling in it.
 */
export function wizardErrorText(
  labels: Readonly<BookingLabels>,
  error: NonNullable<WizardState['error']>,
  maxServicesPerPerson: number
): BookingLabel {
  if (error === 'maxServices') {
    return fill(labels['details.error.maxServices'], { count: maxServicesPerPerson });
  }
  return labels[DETAILS_ERROR_LABEL_KEYS[error]];
}

/**
 * The state as meda's screens know it. Their error union predates
 * `maxServices` — a step-2 refusal the shell explains itself — so it is
 * withheld from a screen that has no sentence for it, rather than handed over
 * as a key it would look up and not find.
 */
export function forMedaScreen(state: WizardState): MedaScreenState {
  // The same object whenever there is nothing to withhold, so a screen that
  // memoises on its `state` prop re-renders exactly as often as before.
  return state.error === 'maxServices' ? { ...state, error: null } : (state as MedaScreenState);
}

type MedaScreenState = Omit<WizardState, 'error'> & {
  error: Exclude<WizardState['error'], 'maxServices'>;
};
