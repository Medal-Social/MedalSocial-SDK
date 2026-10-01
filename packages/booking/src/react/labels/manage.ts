/**
 * The words `<ManageBooking>` draws or assembles itself, on top of the screens'
 * own copy (`screens.ts`): the calendar entry it builds for «add to calendar».
 * Everything else on the page is `ManageScreen`'s (`manage.*`, `time.*`).
 */

import type { BookingLabel } from '../../core/labels';

export interface ManageLabels {
  /** The calendar entry's title: `{service}` (and `{name}`) at `{business}`. */
  'manage.ics.title': BookingLabel;
  'manage.ics.titleFor': BookingLabel;
  /** The entry's first line: `{price}` and where it is paid. */
  'manage.ics.price': BookingLabel;
  /** The entry's manage line: `{url}`, this page's own link. */
  'manage.ics.manage': BookingLabel;
  /** The calendar file's download name. */
  'manage.ics.fileName': BookingLabel;
}

export const MANAGE_LABELS_NB: ManageLabels = {
  'manage.ics.title': '{service} hos {business}',
  'manage.ics.titleFor': '{service} for {name} hos {business}',
  'manage.ics.price': '{price} · betales på stedet',
  'manage.ics.manage': 'Endre eller avbestill: {url}',
  'manage.ics.fileName': 'time.ics',
};

export const MANAGE_LABELS_EN: ManageLabels = {
  'manage.ics.title': '{service} at {business}',
  'manage.ics.titleFor': '{service} for {name} at {business}',
  'manage.ics.price': '{price} · paid on the day',
  'manage.ics.manage': 'Change or cancel: {url}',
  'manage.ics.fileName': 'appointment.ics',
};
