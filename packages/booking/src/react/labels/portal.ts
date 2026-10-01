/**
 * The words `<PortalDashboard>` draws or assembles itself, on top of the screens'
 * own copy (`screens.ts`): the page header, the four tab names, the family
 * sections' headings and the one generic sentence for a form the backend
 * refused without naming a field.
 */

export interface PortalLabels {
  /** The small line above the greeting. */
  'portal.eyebrow': string;
  /** `{name}`: the visitor's first name, or `portal.greetingFallback`. */
  'portal.greeting': string;
  'portal.greetingFallback': string;
  /** The header's button into the booking flow. */
  'portal.book': string;
  /** The tabs: the rail's label, and the bottom bar's shorter one. */
  'portal.tab.overview': string;
  'portal.tab.overviewShort': string;
  'portal.tab.family': string;
  'portal.tab.history': string;
  'portal.tab.profile': string;
  /** The family cards' heading, on the overview and on the family tab. */
  'portal.family.heading': string;
  /** The sentence under it on the family tab. */
  'portal.family.lead': string;
  /** A form the backend refused without saying which field. */
  'portal.invalidInput': string;
}

export const PORTAL_LABELS_NB: PortalLabels = {
  'portal.eyebrow': 'MIN SIDE',
  'portal.greeting': 'Hei {name}!',
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
};

export const PORTAL_LABELS_EN: PortalLabels = {
  'portal.eyebrow': 'MY PAGE',
  'portal.greeting': 'Hi {name}!',
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
};
