/**
 * The words `<BookingWizard>` draws itself — its header, the banner over the
 * steps, the login row, the fallbacks — and the sentences it assembles for the
 * screens (a child's «last visit» line, the «you have outgrown it» note, the
 * calendar file). Everything inside a screen is the screen's own copy
 * (`screens.ts`).
 */

import type { BookingLabel } from '../../core/labels';

export interface WizardLabels {
  /** «Bestill time» — the header's title. */
  'wizard.title': BookingLabel;
  /**
   * `{step}` of `{total}`, then the step's name: «Steg 1 av 4 · Hvem». The
   * built-in packs write it as an array, one text node per piece.
   */
  'wizard.progress': BookingLabel;
  /** The progress list's accessible name. */
  'wizard.progressLabel': BookingLabel;
  /** The back arrow's accessible name: «Tilbake til {label}». */
  'wizard.back': BookingLabel;
  'wizard.step.who': BookingLabel;
  'wizard.step.service': BookingLabel;
  'wizard.step.when': BookingLabel;
  'wizard.step.details': BookingLabel;
  /** Announced while a stored booking is read back after a reload. */
  'wizard.restoring': BookingLabel;
  /** The openings could not be read: lead, linked phone (`{phone}`), unlinked phone, end. */
  'wizard.slotsUnavailable.lead': BookingLabel;
  'wizard.slotsUnavailable.call': BookingLabel;
  'wizard.slotsUnavailable.callAria': BookingLabel;
  'wizard.slotsUnavailable.callPlain': BookingLabel;
  'wizard.slotsUnavailable.suffix': BookingLabel;
  'wizard.retry': BookingLabel;
  /** A restored stylist who cannot take this basket, replaced by «first available». */
  'wizard.stylistGone': BookingLabel;
  /**
   * The machine's `maxServices` refusal: `{count}` is the site's
   * `party.maxServicesPerPerson`. Keyed beside meda's `details.error.*` so the
   * map from code to sentence stays one family; it lives here until meda's
   * screens carry the code themselves, and then moves to `screens.ts`.
   */
  'details.error.maxServices': BookingLabel;
  /** After a login from the sheet: «Du er logget inn.» / «… som {name}.» */
  'wizard.signedIn': BookingLabel;
  'wizard.signedInAs': BookingLabel;
  /**
   * `config.account.required`: the details step for a parent not logged in —
   * «Nesten ferdig» and the line over the two login buttons.
   */
  'wizard.account.heading': BookingLabel;
  'wizard.account.intro': BookingLabel;
  /** Why «+ add child» could not save a logged-in parent's child. */
  'wizard.addChild.invalid': BookingLabel;
  'wizard.addChild.session': BookingLabel;
  'wizard.addChild.throttled': BookingLabel;
  'wizard.addChild.unreachable': BookingLabel;
  /** `{last}`, `{name}`, `{next}`: «Sist: Barnehageklipp. Theo har vokst fra den, så vi foreslår Gutteklipp.» */
  'wizard.suggestion.outgrown': BookingLabel;
  /** `{name}` when the child has none. */
  'wizard.suggestion.someone': BookingLabel;
  /**
   * The party size as the copy spells it, for `{sizeWord}` in the stylist
   * step's `stylist.party.parallel.*` / `stylist.party.parallelNote.*`: «to»
   * for two, «tre» for three, `.other` for more. `''` fills in the number.
   */
  'wizard.party.sizeWord.two': BookingLabel;
  'wizard.party.sizeWord.three': BookingLabel;
  'wizard.party.sizeWord.other': BookingLabel;
  /** An anonymous child's seat on the service step: «Barn {n}». */
  'wizard.party.child': BookingLabel;
  /** A named child's section heading: «{name} · {age}». */
  'wizard.party.named': BookingLabel;
  /** A saved child's line on step 1: «Sist: {service}, {date}». */
  'wizard.who.lastVisit': BookingLabel;
  /** `{service}` when the last visit's service has no name. */
  'wizard.who.lastVisitFallback': BookingLabel;
  /** The calendar entry's title: `{service}` (and `{name}`) at `{business}`. */
  'wizard.ics.title': BookingLabel;
  'wizard.ics.titleFor': BookingLabel;
  /** The entry's first line: `{price}` and where it is paid. */
  'wizard.ics.price': BookingLabel;
  /** The entry's manage line: `{url}`. */
  'wizard.ics.manage': BookingLabel;
  /** The calendar file's download name. */
  'wizard.ics.fileName': BookingLabel;
}

export const WIZARD_LABELS_NB: WizardLabels = {
  'wizard.title': 'Bestill time',
  'wizard.progress': ['Steg ', '{step}', ' av ', '{total}', ' · ', '{label}'],
  'wizard.progressLabel': 'Fremdrift',
  'wizard.back': 'Tilbake til {label}',
  'wizard.step.who': 'Hvem',
  'wizard.step.service': 'Hva',
  'wizard.step.when': 'Når',
  'wizard.step.details': 'Bekreft',
  'wizard.restoring': 'Henter bestillingen din …',
  'wizard.slotsUnavailable.lead': 'Vi får ikke hentet ledige tider akkurat nå – ',
  'wizard.slotsUnavailable.call': ['ring oss på ', '{phone}'],
  'wizard.slotsUnavailable.callAria': 'Ring oss på {phone}',
  'wizard.slotsUnavailable.callPlain': 'ring oss',
  'wizard.slotsUnavailable.suffix': ', så finner vi en tid.',
  'wizard.retry': 'Prøv igjen',
  'wizard.stylistGone':
    'Den du valgte er ikke ledig for denne bestillingen. Vi viser første ledige.',
  'details.error.maxServices': 'Du kan velge opptil {count} tjenester per person.',
  'wizard.signedIn': 'Du er logget inn.',
  'wizard.signedInAs': 'Du er logget inn som {name}.',
  'wizard.account.heading': 'Nesten ferdig',
  'wizard.account.intro':
    'Logg inn for å bekrefte — vi lager kontoen hvis du er ny. Timen holdes for deg mens du logger inn.',
  'wizard.addChild.invalid': 'Sjekk navn og fødselsår.',
  'wizard.addChild.session': 'Du er ikke lenger logget inn. Last siden på nytt og logg inn igjen.',
  'wizard.addChild.throttled': 'For mange forsøk. Vent litt før du prøver igjen.',
  'wizard.addChild.unreachable':
    'Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.',
  'wizard.suggestion.outgrown': 'Sist: {last}. {name} har vokst fra den, så vi foreslår {next}.',
  'wizard.suggestion.someone': 'Barnet',
  'wizard.party.sizeWord.two': 'to',
  'wizard.party.sizeWord.three': 'tre',
  'wizard.party.sizeWord.other': 'flere',
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
  'wizard.progress': ['Step ', '{step}', ' of ', '{total}', ' · ', '{label}'],
  'wizard.progressLabel': 'Progress',
  'wizard.back': 'Back to {label}',
  'wizard.step.who': 'Who',
  'wizard.step.service': 'What',
  'wizard.step.when': 'When',
  'wizard.step.details': 'Confirm',
  'wizard.restoring': 'Fetching your booking …',
  'wizard.slotsUnavailable.lead': 'We cannot read the free times right now – ',
  'wizard.slotsUnavailable.call': ['call us on ', '{phone}'],
  'wizard.slotsUnavailable.callAria': 'Call us on {phone}',
  'wizard.slotsUnavailable.callPlain': 'call us',
  'wizard.slotsUnavailable.suffix': ' and we will find a time.',
  'wizard.retry': 'Try again',
  'wizard.stylistGone':
    'The person you chose is not free for this booking. Showing the first available instead.',
  'details.error.maxServices': 'You can choose up to {count} services per person.',
  'wizard.signedIn': 'You are logged in.',
  'wizard.signedInAs': 'You are logged in as {name}.',
  'wizard.account.heading': 'Almost done',
  'wizard.account.intro':
    'Sign in to confirm — we create your account if you are new. Your time is held while you sign in.',
  'wizard.addChild.invalid': 'Check the name and the year of birth.',
  'wizard.addChild.session': 'You are no longer logged in. Reload the page and log in again.',
  'wizard.addChild.throttled': 'Too many attempts. Wait a moment before you try again.',
  'wizard.addChild.unreachable': 'We could not reach the booking system. Try again in a moment.',
  'wizard.suggestion.outgrown': 'Last time: {last}. {name} has outgrown it, so we suggest {next}.',
  'wizard.suggestion.someone': 'Your child',
  'wizard.party.sizeWord.two': 'two',
  'wizard.party.sizeWord.three': 'three',
  'wizard.party.sizeWord.other': 'several',
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
