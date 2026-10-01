/**
 * `@medalsocial/booking/react/wizard` — what a booking page renders, and
 * nothing it does not: `<BookingWizard>`, the headless `useBooking()` it is
 * built on, `<BookingProvider>` and the `<LoginSheet>` the wizard offers.
 *
 * Import a booking page from here, not from `@medalsocial/booking/react`. A
 * bundler treats a `'use client'` entry as one unit, so the `/react` barrel
 * brings the manage page and the whole portal along; this entry stops at the
 * wizard. `/react` still exports everything, for pages where size does not
 * matter.
 *
 * Same stylesheets and label rules as `/react`: resolve the pack on the server
 * with `mergeLabels` from `@medalsocial/booking/react/shared` and pass it in.
 */

export type {
  ActionAnswer,
  ActionFailure,
  InvalidFailure,
  PersonActionInput,
  PersonActionResult,
  PersonActionTarget,
  PortalActions,
  ProfileActionResult,
  SafeActionEnvelope,
  SessionFailure,
} from '../actions';
export * from '../BookingWizard';
export type { BookingKit } from '../kit';
export * from '../LoginSheet';
export type {
  BookingLabels,
  BookingLabelsInput,
  LoginLabels,
  ScreenLabels,
  WizardLabels,
} from '../labels';
export * from '../Provider';
export * from '../useBooking';
