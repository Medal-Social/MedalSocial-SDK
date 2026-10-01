/**
 * The words `<BookingWizard>` draws itself — its header, the banner over the
 * steps, the login row, the fallbacks — and the sentences it assembles for the
 * screens (a child's «last visit» line, the «you have outgrown it» note, the
 * calendar file). Everything inside a screen is the screen's own copy
 * (`screens.ts`).
 */

export interface WizardLabels {
  /** «Bestill time» — the header's title. */
  'wizard.title': string;
  /** `{step}` of `{total}`, then the step's name: «Steg 1 av 4 · Hvem». */
  'wizard.progress': string;
  /** The progress list's accessible name. */
  'wizard.progressLabel': string;
  /** The back arrow's accessible name: «Tilbake til {label}». */
  'wizard.back': string;
  'wizard.step.who': string;
  'wizard.step.service': string;
  'wizard.step.when': string;
  'wizard.step.details': string;
  /** Announced while a stored booking is read back after a reload. */
  'wizard.restoring': string;
  /** The openings could not be read: lead, linked phone (`{phone}`), unlinked phone, end. */
  'wizard.slotsUnavailable.lead': string;
  'wizard.slotsUnavailable.call': string;
  'wizard.slotsUnavailable.callAria': string;
  'wizard.slotsUnavailable.callPlain': string;
  'wizard.slotsUnavailable.suffix': string;
  'wizard.retry': string;
  /** A restored stylist who cannot take this basket, replaced by «first available». */
  'wizard.stylistGone': string;
  /** After a login from the sheet: «Du er logget inn.» / «… som {name}.» */
  'wizard.signedIn': string;
  'wizard.signedInAs': string;
  /** Why «+ add child» could not save a logged-in parent's child. */
  'wizard.addChild.invalid': string;
  'wizard.addChild.session': string;
  'wizard.addChild.throttled': string;
  'wizard.addChild.unreachable': string;
  /** `{last}`, `{name}`, `{next}`: «Sist: Barnehageklipp. Theo har vokst fra den, så vi foreslår Gutteklipp.» */
  'wizard.suggestion.outgrown': string;
  /** `{name}` when the child has none. */
  'wizard.suggestion.someone': string;
  /** An anonymous child's seat on the service step: «Barn {n}». */
  'wizard.party.child': string;
  /** A named child's section heading: «{name} · {age}». */
  'wizard.party.named': string;
  /** A saved child's line on step 1: «Sist: {service}, {date}». */
  'wizard.who.lastVisit': string;
  /** `{service}` when the last visit's service has no name. */
  'wizard.who.lastVisitFallback': string;
  /** The calendar entry's title: `{service}` (and `{name}`) at `{business}`. */
  'wizard.ics.title': string;
  'wizard.ics.titleFor': string;
  /** The entry's first line: `{price}` and where it is paid. */
  'wizard.ics.price': string;
  /** The entry's manage line: `{url}`. */
  'wizard.ics.manage': string;
  /** The calendar file's download name. */
  'wizard.ics.fileName': string;
}

export const WIZARD_LABELS_NB: WizardLabels = {
  'wizard.title': 'Bestill time',
  'wizard.progress': 'Steg {step} av {total} · {label}',
  'wizard.progressLabel': 'Fremdrift',
  'wizard.back': 'Tilbake til {label}',
  'wizard.step.who': 'Hvem',
  'wizard.step.service': 'Hva',
  'wizard.step.when': 'Når',
  'wizard.step.details': 'Bekreft',
  'wizard.restoring': 'Henter bestillingen din …',
  'wizard.slotsUnavailable.lead': 'Vi får ikke hentet ledige tider akkurat nå – ',
  'wizard.slotsUnavailable.call': 'ring oss på {phone}',
  'wizard.slotsUnavailable.callAria': 'Ring oss på {phone}',
  'wizard.slotsUnavailable.callPlain': 'ring oss',
  'wizard.slotsUnavailable.suffix': ', så finner vi en tid.',
  'wizard.retry': 'Prøv igjen',
  'wizard.stylistGone':
    'Den du valgte er ikke ledig for denne bestillingen. Vi viser første ledige.',
  'wizard.signedIn': 'Du er logget inn.',
  'wizard.signedInAs': 'Du er logget inn som {name}.',
  'wizard.addChild.invalid': 'Sjekk navn og fødselsår.',
  'wizard.addChild.session': 'Du er ikke lenger logget inn. Last siden på nytt og logg inn igjen.',
  'wizard.addChild.throttled': 'For mange forsøk. Vent litt før du prøver igjen.',
  'wizard.addChild.unreachable':
    'Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.',
  'wizard.suggestion.outgrown': 'Sist: {last}. {name} har vokst fra den, så vi foreslår {next}.',
  'wizard.suggestion.someone': 'Barnet',
  'wizard.party.child': 'Barn {n}',
  'wizard.party.named': '{name} · {age}',
  'wizard.who.lastVisit': 'Sist: {service}, {date}',
  'wizard.who.lastVisitFallback': 'besøk',
  'wizard.ics.title': '{service} hos {business}',
  'wizard.ics.titleFor': '{service} for {name} hos {business}',
  'wizard.ics.price': '{price} · betales på stedet',
  'wizard.ics.manage': 'Endre eller avbestill: {url}',
  'wizard.ics.fileName': 'time.ics',
};

export const WIZARD_LABELS_EN: WizardLabels = {
  'wizard.title': 'Book an appointment',
  'wizard.progress': 'Step {step} of {total} · {label}',
  'wizard.progressLabel': 'Progress',
  'wizard.back': 'Back to {label}',
  'wizard.step.who': 'Who',
  'wizard.step.service': 'What',
  'wizard.step.when': 'When',
  'wizard.step.details': 'Confirm',
  'wizard.restoring': 'Fetching your booking …',
  'wizard.slotsUnavailable.lead': 'We cannot read the free times right now – ',
  'wizard.slotsUnavailable.call': 'call us on {phone}',
  'wizard.slotsUnavailable.callAria': 'Call us on {phone}',
  'wizard.slotsUnavailable.callPlain': 'call us',
  'wizard.slotsUnavailable.suffix': ' and we will find a time.',
  'wizard.retry': 'Try again',
  'wizard.stylistGone':
    'The person you chose is not free for this booking. Showing the first available instead.',
  'wizard.signedIn': 'You are logged in.',
  'wizard.signedInAs': 'You are logged in as {name}.',
  'wizard.addChild.invalid': 'Check the name and the year of birth.',
  'wizard.addChild.session': 'You are no longer logged in. Reload the page and log in again.',
  'wizard.addChild.throttled': 'Too many attempts. Wait a moment before you try again.',
  'wizard.addChild.unreachable': 'We could not reach the booking system. Try again in a moment.',
  'wizard.suggestion.outgrown': 'Last time: {last}. {name} has outgrown it, so we suggest {next}.',
  'wizard.suggestion.someone': 'Your child',
  'wizard.party.child': 'Child {n}',
  'wizard.party.named': '{name} · {age}',
  'wizard.who.lastVisit': 'Last: {service}, {date}',
  'wizard.who.lastVisitFallback': 'visit',
  'wizard.ics.title': '{service} at {business}',
  'wizard.ics.titleFor': '{service} for {name} at {business}',
  'wizard.ics.price': '{price} · paid on the day',
  'wizard.ics.manage': 'Change or cancel: {url}',
  'wizard.ics.fileName': 'appointment.ics',
};
