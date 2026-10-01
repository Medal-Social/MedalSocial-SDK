/**
 * The words `<LoginSheet>` and `<LoginPageQuery>` draw or assemble
 * themselves, on top of the screens' own copy (`screens.ts`): the sentence the
 * login page shows for each outcome a Vipps return can report (`?vipps=`).
 */

import type { BookingLabel } from '../../core/labels';

export type LoginLabels = {
  /** `?vipps=needs_email_login`: the Vipps login matched more than one profile. */
  'loginPage.vipps.needsEmailLogin': BookingLabel;
  /** `?vipps=failed`: the Vipps login was cancelled or failed. */
  'loginPage.vipps.failed': BookingLabel;
};

export const LOGIN_LABELS_NB: LoginLabels = {
  'loginPage.vipps.needsEmailLogin':
    'Vi fant mer enn én profil på deg. Logg inn med e-post denne gangen, så kan du koble til Vipps etterpå.',
  'loginPage.vipps.failed': 'Innloggingen med Vipps ble avbrutt. Prøv igjen, eller bruk e-post.',
};

export const LOGIN_LABELS_EN: LoginLabels = {
  'loginPage.vipps.needsEmailLogin':
    'We found more than one profile for you. Log in with e-mail this time, and link Vipps afterwards.',
  'loginPage.vipps.failed': 'The Vipps login was cancelled. Try again, or use e-mail.',
};
