import type { BookingLabels as MedaBookingLabels } from '@medalsocial/meda/booking';
import type { BookingLabels } from './labels';

/**
 * A pack as meda's screens type their `labels` prop: the same object. meda
 * 3.4 takes a string or an array for every key; this only narrows the type
 * for a meda whose types still read `string`.
 */
/**
 * Required, opt-in keys included: the package's own packs define every key
 * meda has (`ScreenLabels` is `-?`), so a screen that needs an opt-in key —
 * the recap, «free soon», the guest party — always has it.
 */
export function screenLabels(labels: Readonly<BookingLabels>): Required<MedaBookingLabels> {
  return labels as unknown as Required<MedaBookingLabels>;
}
