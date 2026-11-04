/**
 * The words `<PortalDashboard>` draws or assembles itself, on top of the screens'
 * own copy (`screens.ts`): the page header, the four tab names, the family
 * sections' headings and the one generic sentence for a form the backend
 * refused without naming a field.
 */

import type { BookingLabel } from '../../core/labels';

export interface PortalLabels {
  /** The small line above the greeting. */
  'portal.eyebrow': BookingLabel;
  /** `{name}`: the visitor's first name, or `portal.greetingFallback`. Built in as an array, the name its own text node. */
  'portal.greeting': BookingLabel;
  'portal.greetingFallback': BookingLabel;
  /** The header's button into the booking flow. */
  'portal.book': BookingLabel;
  /** The tabs: the rail's label, and the bottom bar's shorter one. */
  'portal.tab.overview': BookingLabel;
  'portal.tab.overviewShort': BookingLabel;
  'portal.tab.family': BookingLabel;
  'portal.tab.history': BookingLabel;
  'portal.tab.profile': BookingLabel;
  /** The family cards' heading, on the overview and on the family tab. */
  'portal.family.heading': BookingLabel;
  /** The sentence under it on the family tab. */
  'portal.family.lead': BookingLabel;
  /** A form the backend refused without saying which field. */
  'portal.invalidInput': BookingLabel;
  /**
   * «Change e-mail» on the profile (`<PortalEmailChange>`, opt-in with
   * `emailChange` on the dashboard). `{email}` is the address on file or the
   * new one, `{to}` the new address as Medal masked it, `{seconds}` the wait
   * before another code can be sent.
   */
  'emailChange.heading': BookingLabel;
  'emailChange.button': BookingLabel;
  /** The button's accessible name (its text is a bare verb). */
  'emailChange.buttonLabel': BookingLabel;
  /** Replaces `profileForm.emailHelp` while the row is offered. */
  'emailChange.profileHelp': BookingLabel;
  'emailChange.title': BookingLabel;
  'emailChange.lead': BookingLabel;
  'emailChange.newEmail': BookingLabel;
  'emailChange.send': BookingLabel;
  'emailChange.codeTitle': BookingLabel;
  'emailChange.sentTo': BookingLabel;
  /** When Medal's answer carried no masked address. */
  'emailChange.sentToUnknown': BookingLabel;
  'emailChange.codeHelp': BookingLabel;
  /** Always on the code step: start answers «sent» even when no mail could go out. */
  'emailChange.noCode': BookingLabel;
  'emailChange.confirm': BookingLabel;
  'emailChange.resend': BookingLabel;
  'emailChange.resendIn': BookingLabel;
  'emailChange.resent': BookingLabel;
  'emailChange.otherAddress': BookingLabel;
  'emailChange.doneTitle': BookingLabel;
  'emailChange.done': BookingLabel;
  /** Said when the customer had Vipps linked: the change unlinked it. */
  'emailChange.vippsRelink': BookingLabel;
  'emailChange.vippsRelinkButton': BookingLabel;
  /** The change went through but the new session could not be kept. */
  'emailChange.signedOut': BookingLabel;
  /** The verify got no answer and the session is gone: the change probably went through. */
  'emailChange.unconfirmedTitle': BookingLabel;
  'emailChange.unconfirmed': BookingLabel;
  'emailChange.login': BookingLabel;
  'emailChange.finish': BookingLabel;
  'emailChange.close': BookingLabel;
  'emailChange.invalidEmail': BookingLabel;
  'emailChange.invalidCode': BookingLabel;
  'emailChange.refused.unchanged': BookingLabel;
  'emailChange.refused.email_taken': BookingLabel;
  'emailChange.refused.too_many_codes': BookingLabel;
  'emailChange.refused.code_invalid': BookingLabel;
  'emailChange.throttled': BookingLabel;
  'emailChange.unavailable': BookingLabel;
  'emailChange.unreachable': BookingLabel;
}

export const PORTAL_LABELS_NB: PortalLabels = {
  'portal.eyebrow': 'MIN SIDE',
  'portal.greeting': ['Hei ', '{name}', '!'],
  'portal.greetingFallback': 'der',
  'portal.book': 'Bestill ny time',
  'portal.tab.overview': 'Oversikt',
  'portal.tab.overviewShort': 'Hjem',
  'portal.tab.family': 'Familien',
  'portal.tab.history': 'Historikk',
  'portal.tab.profile': 'Profil',
  'portal.family.heading': 'Familien',
  'portal.family.lead':
    'Vi husker hva som passer for hver enkelt, så du slipper å forklare på nytt hver gang.',
  'portal.invalidInput': 'Noe i skjemaet stemmer ikke. Se over feltene og prøv igjen.',
  'emailChange.heading': 'E-post',
  'emailChange.button': 'Endre',
  'emailChange.buttonLabel': 'Endre e-postadresse',
  'emailChange.profileHelp': 'Vil du bytte e-postadresse, gjør du det under «E-post».',
  'emailChange.title': 'Endre e-post',
  'emailChange.lead':
    'Vi sender en kode til den nye adressen. Ingenting endres før du har skrevet inn koden.',
  'emailChange.newEmail': 'Ny e-postadresse',
  'emailChange.send': 'Send kode',
  'emailChange.codeTitle': 'Skriv inn koden',
  'emailChange.sentTo': 'Vi har sendt en kode til {to}.',
  'emailChange.sentToUnknown': 'Vi har sendt en kode til den nye adressen.',
  'emailChange.codeHelp': 'Koden gjelder i 10 minutter. Finner du den ikke, se i søppelposten.',
  'emailChange.noCode':
    'Fikk du ingen kode? Sjekk adressen, prøv igjen om litt, eller ring salongen.',
  'emailChange.confirm': 'Bekreft',
  'emailChange.resend': 'Send ny kode',
  'emailChange.resendIn': 'Send ny kode om {seconds} s',
  'emailChange.resent': 'Vi har sendt en ny kode.',
  'emailChange.otherAddress': 'Bruk en annen adresse',
  'emailChange.doneTitle': 'E-posten er endret',
  'emailChange.done': 'E-posten er endret. Bekreftelser og påminnelser går nå til {email}.',
  'emailChange.vippsRelink':
    'Vipps-innloggingen ble koblet fra da du byttet adresse. Koble til Vipps på nytt for å logge inn med ett trykk.',
  'emailChange.vippsRelinkButton': 'Koble til Vipps på nytt',
  'emailChange.signedOut': 'Logg inn igjen med den nye adressen.',
  'emailChange.unconfirmedTitle': 'Logg inn på nytt',
  'emailChange.unconfirmed':
    'Vi fikk ikke svar på bekreftelsen, men du er logget ut – det betyr som regel at e-posten ble endret. Logg inn med {email}. Kommer det ingen kode dit, prøv den gamle adressen.',
  'emailChange.login': 'Logg inn',
  'emailChange.finish': 'Ferdig',
  'emailChange.close': 'Lukk',
  'emailChange.invalidEmail': 'Skriv inn en gyldig e-postadresse.',
  'emailChange.invalidCode': 'Koden er seks siffer.',
  'emailChange.refused.unchanged': 'Det er den adressen vi har fra før. Skriv inn en annen.',
  'emailChange.refused.email_taken':
    'Denne e-posten er allerede i bruk hos salongen. Ring oss om den er din.',
  'emailChange.refused.too_many_codes':
    'Du har bedt om mange koder på kort tid. Vent ti minutter og prøv igjen.',
  'emailChange.refused.code_invalid':
    'Koden stemmer ikke, eller den har gått ut. Sjekk koden, eller be om en ny.',
  'emailChange.throttled': 'Vent litt, og prøv igjen.',
  'emailChange.unavailable':
    'Du kan ikke bytte e-post her akkurat nå. Ring oss, så hjelper vi deg.',
  'emailChange.unreachable': 'Vi får ikke kontakt akkurat nå. Prøv igjen om litt.',
};

export const PORTAL_LABELS_EN: PortalLabels = {
  'portal.eyebrow': 'MY PAGE',
  'portal.greeting': ['Hi ', '{name}', '!'],
  'portal.greetingFallback': 'there',
  'portal.book': 'Book an appointment',
  'portal.tab.overview': 'Overview',
  'portal.tab.overviewShort': 'Home',
  'portal.tab.family': 'Family',
  'portal.tab.history': 'History',
  'portal.tab.profile': 'Profile',
  'portal.family.heading': 'Family',
  'portal.family.lead':
    'We remember what works for each of you, so you do not have to explain it every time.',
  'portal.invalidInput': 'Something in the form is not right. Check the fields and try again.',
  'emailChange.heading': 'E-mail',
  'emailChange.button': 'Change',
  'emailChange.buttonLabel': 'Change e-mail address',
  'emailChange.profileHelp': 'To use another e-mail address, change it under "E-mail".',
  'emailChange.title': 'Change e-mail',
  'emailChange.lead':
    'We will send a code to the new address. Nothing changes until you have entered it.',
  'emailChange.newEmail': 'New e-mail address',
  'emailChange.send': 'Send code',
  'emailChange.codeTitle': 'Enter the code',
  'emailChange.sentTo': 'We have sent a code to {to}.',
  'emailChange.sentToUnknown': 'We have sent a code to the new address.',
  'emailChange.codeHelp':
    'The code is valid for 10 minutes. Cannot find it? Check your spam folder.',
  'emailChange.noCode':
    'No code? Check the address, try again in a little while, or call the salon.',
  'emailChange.confirm': 'Confirm',
  'emailChange.resend': 'Send a new code',
  'emailChange.resendIn': 'Send a new code in {seconds} s',
  'emailChange.resent': 'We have sent a new code.',
  'emailChange.otherAddress': 'Use another address',
  'emailChange.doneTitle': 'Your e-mail is changed',
  'emailChange.done': 'Your e-mail is changed. Confirmations and reminders now go to {email}.',
  'emailChange.vippsRelink':
    'Changing your address disconnected your Vipps login. Reconnect Vipps to log in with a single tap.',
  'emailChange.vippsRelinkButton': 'Reconnect Vipps',
  'emailChange.signedOut': 'Please log in again with your new address.',
  'emailChange.unconfirmedTitle': 'Log in again',
  'emailChange.unconfirmed':
    'We did not get an answer to the confirmation, but you have been logged out, which usually means the e-mail was changed. Log in with {email}. If no code arrives there, try your old address.',
  'emailChange.login': 'Log in',
  'emailChange.finish': 'Done',
  'emailChange.close': 'Close',
  'emailChange.invalidEmail': 'Enter a valid e-mail address.',
  'emailChange.invalidCode': 'The code is six digits.',
  'emailChange.refused.unchanged': 'That is the address we already have. Enter another one.',
  'emailChange.refused.email_taken':
    'This e-mail is already in use at the salon. Call us if it is yours.',
  'emailChange.refused.too_many_codes':
    'You have asked for many codes in a short time. Wait ten minutes and try again.',
  'emailChange.refused.code_invalid':
    'The code is wrong or has expired. Check it, or ask for a new one.',
  'emailChange.throttled': 'Please wait a moment and try again.',
  'emailChange.unavailable':
    'You cannot change your e-mail here right now. Call us and we will help.',
  'emailChange.unreachable': 'We cannot reach the server right now. Please try again shortly.',
};
