import type { BookingLabels as MedaBookingLabels } from '@medalsocial/meda/booking';
import type { BookingLabels } from './labels';

/**
 * A pack as meda's screens type their `labels` prop: the same object. meda
 * 3.4 takes a string or an array for every key; this only narrows the type
 * for a meda whose types still read `string`.
 */
export function screenLabels(labels: Readonly<BookingLabels>): MedaBookingLabels {
  return labels as unknown as MedaBookingLabels;
}
