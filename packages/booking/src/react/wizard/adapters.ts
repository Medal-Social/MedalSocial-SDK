/**
 * What the wizard hands each meda screen, worked out of the site's kit.
 *
 * The screens are presentational: the domain rules they leave to their caller
 * — prices, the weekend note, ages and «last visit» lines, the category
 * filing, the possessive, the phone rules, the calendar file — are answered
 * here, once, so `<BookingWizard>` and anything else that draws a screen
 * (a test, a custom shell over `useBooking()`) answer them the same way.
 */

import type {
  ConfirmationProps,
  DetailsLine,
  ServicePartyPerson,
  WeekendNote,
  WhoGuestChoice,
  WhoPersonEntry,
} from '@medalsocial/meda/booking';
import type { AgeRange } from '../../core/age';
import { normaliseCategory } from '../../core/categories';
import { fill, labelText } from '../../core/labels';
import { SELF_KEY, type WizardItem, type WizardPerson, type WizardState } from '../../core/machine';
import type { BookingFamilyMember, BookingServiceDto } from '../../core/types';
import type { BookingKit } from '../kit';
import type { BookingLabels } from '../labels';
import type { BookingConfirmation, BookingSuggestion } from '../useBooking';
import { confirmationLines, personForChild } from '../useBooking';

/** Step 1's guest chips: one to `maxPeople` children, then one grown-up. */
export function guestChoices(kit: BookingKit): WhoGuestChoice[] {
  const { wizard } = kit;
  return [
    ...Array.from({ length: wizard.maxPeople }, (_, index) => ({
      key: `children-${index + 1}`,
      people: Array.from({ length: index + 1 }, (_, seat) => wizard.guestChild(seat + 1)),
    })),
    { key: 'adult', people: [{ key: 'adult', adult: true }] },
  ];
}

/** «7 år», or `''` when the year is unknown — the age on the business day `dayKey`. */
export function ageLine(
  kit: BookingKit,
  birthYear: number | undefined,
  birthMonth: number | undefined,
  dayKey: string
): string {
  if (birthYear === undefined) return '';
  const range = kit.age.ageOnDay(birthYear, birthMonth, dayKey);
  return range === null ? '' : kit.format.ageLabel(range);
}

/** «7 år · Sist: Gutteklipp, tor. 12. aug.», or the age alone for a first visit. */
export function childLine(kit: BookingKit, child: BookingFamilyMember, dayKey: string): string {
  const { labels } = kit;
  const parts = [ageLine(kit, child.birthYear, child.birthMonth, dayKey) || null];
  if (child.lastVisit) {
    parts.push(
      fill(labels['wizard.who.lastVisit'], {
        service: child.lastVisit.serviceName ?? labelText(labels['wizard.who.lastVisitFallback']),
        date: kit.clock.date(child.lastVisit.startTs),
      })
    );
  }
  return parts.filter((part) => part !== null).join(' · ');
}

/** A logged-in parent's children as step 1's cards. */
export function familyEntries(
  kit: BookingKit,
  family: readonly BookingFamilyMember[],
  dayKey: string
): WhoPersonEntry[] {
  return family.map((child, index) => ({
    person: personForChild(child, index),
    line: childLine(kit, child, dayKey),
  }));
}

/** The children a guest named in the sheet, as ticked cards under the chips. */
export function addedChildEntries(
  kit: BookingKit,
  people: readonly WizardPerson[],
  dayKey: string
): WhoPersonEntry[] {
  return people
    .filter((person) => person.key.startsWith('new:'))
    .map((person) => ({
      person,
      line: ageLine(kit, person.birthYear, person.birthMonth, dayKey),
    }));
}

/**
 * What step 2 calls each person: the child's name and age on the day, «Barn
 * 2» for a guest's second child, «Meg selv» / «Voksen» for a grown-up.
 */
export function partyPeople(
  kit: BookingKit,
  people: readonly WizardPerson[],
  ageOf: (person: WizardPerson) => AgeRange | null,
  suggestionFor: (person: WizardPerson) => BookingSuggestion | null
): ServicePartyPerson[] {
  const { labels } = kit;
  return people.map((person, index) => {
    if (person.adult) {
      return {
        key: person.key,
        label: labelText(person.key === SELF_KEY ? labels['people.self'] : labels['people.adult']),
        adult: true,
      };
    }
    if (person.name === undefined) {
      return {
        key: person.key,
        label: fill(labels['wizard.party.child'], { n: index + 1 }),
        adult: false,
      };
    }
    const range = ageOf(person);
    return {
      key: person.key,
      label:
        range === null
          ? person.name
          : fill(labels['wizard.party.named'], {
              name: person.name,
              age: kit.format.ageLabel(range),
            }),
      name: person.name,
      adult: false,
      suggestion: suggestionFor(person),
    };
  });
}

/** The service step's site-wide answers: groups, filing, the kids' menu, the possessive. */
export function serviceScreenBase(kit: BookingKit) {
  return {
    categories: [...kit.categories],
    // Unknown Medal categories join the configured catch-all, never fall off the page.
    categoryOf: (service: BookingServiceDto) => normaliseCategory(kit.config, service.category),
    childCategory: kit.childCategory ?? undefined,
    possessive: kit.possessive,
    phone: kit.config.contact.phone,
  };
}

/** Whether a service suits the person at `index`, by their age on the day. */
export function serviceFitsFor(kit: BookingKit, ages: ReadonlyArray<AgeRange | null>) {
  return (service: BookingServiceDto, index: number) =>
    kit.age.fitsAge(service, ages[index] ?? null);
}

/**
 * The weekend note for one person or the whole family: the rate when every
 * line pays the same one (`null` when they differ), and the basket's total
 * priced on the day asked about. `null` when nothing in the basket pays.
 */
export function weekendNoteFor(
  kit: BookingKit,
  items: readonly WizardItem[],
  dayTs: number
): WeekendNote | null {
  if (items.length === 0) return null;
  const rates = [...new Set(items.map((item) => item.service.weekendSurchargePct))];
  if (rates.every((rate) => rate <= 0)) return null;
  return {
    pct: rates.length === 1 ? rates[0] : null,
    priceOre: kit.wizard.totalPriceOre([...items], dayTs),
  };
}

/** One line per basket item: the start the machine seated it at, and its resolved stylist. */
export function detailsLines(kit: BookingKit, state: WizardState): DetailsLine[] {
  const starts = kit.wizard.itemStartTimes(state.items, state.startTs ?? 0, state.partyMode);
  const resourceIds = kit.wizard.itemResourceIds(state);
  return state.items.map((_, index) => ({
    startTs: starts[index],
    resourceId: resourceIds[index],
  }));
}

/** The details step's site-wide answers: the phone rules, the terms link, the marketing box. */
export function detailsScreenBase(kit: BookingKit) {
  const { phone, config } = kit;
  return {
    phoneLooksValid: phone.looksValid,
    normalisePhone: phone.nationalDigits,
    phone: config.contact.phone,
    // A link with no words is a link nobody can name: drawn only with its text.
    termsHref: labelText(kit.labels['details.terms.link']) ? config.consent.termsUrl : null,
    marketingConsent: config.consent.marketing !== null,
  };
}

/**
 * The confirmation card's data and its calendar file.
 *
 * One price per line from the same function the total is the sum of, so the
 * card adds up on a Saturday too. ONE calendar entry per line, keyed to that
 * line's own booking id (the UID is the booking id, unchanged), titled with
 * whose appointment it is and carrying that line's own manage link —
 * absolute when the site's origin is known.
 */
export function confirmationProps(
  kit: BookingKit,
  confirmation: BookingConfirmation,
  siteUrl?: string
): Pick<
  ConfirmationProps,
  'lines' | 'startTs' | 'totalOre' | 'address' | 'calendarHref' | 'calendarFileName' | 'portalHref'
> {
  const { labels, wizard, config, format } = kit;
  const { submitted } = confirmation;
  const items = submitted.items;
  const starts = wizard.itemStartTimes(items, submitted.startTs, submitted.partyMode);
  const lines = confirmationLines(confirmation).map((line, index) => ({
    ...line,
    startTs: starts[index],
    priceOre: wizard.itemPriceOre(line.item.service, submitted.startTs),
  }));
  const absolute = (href: string) => (siteUrl ? new URL(href, siteUrl).toString() : href);
  const calendarHref = kit.ics.icsDataUrl(
    kit.ics.buildIcs(
      lines.map((line) => {
        const { service, bookedForName } = line.item;
        const description = [
          fill(labels['wizard.ics.price'], { price: format.price(line.priceOre) }),
        ];
        if (line.manageHref !== null) {
          description.push(fill(labels['wizard.ics.manage'], { url: absolute(line.manageHref) }));
        }
        return {
          uid: line.bookingId,
          startTs: line.startTs,
          endTs: line.startTs + service.durationMinutes * 60_000,
          summary: fill(labels[bookedForName ? 'wizard.ics.titleFor' : 'wizard.ics.title'], {
            service: service.name,
            name: bookedForName ?? '',
            business: config.contact.name,
          }),
          description: description.join('\n'),
          ...(config.contact.address ? { location: config.contact.address } : {}),
        };
      })
    )
  );
  return {
    lines,
    startTs: submitted.startTs,
    totalOre: wizard.totalPriceOre(items, submitted.startTs),
    address: config.contact.address,
    calendarHref,
    calendarFileName: labelText(labels['wizard.ics.fileName']),
    portalHref: config.paths.portal,
  };
}

/**
 * The party size as the copy spells it (`wizard.party.sizeWord.*`), for
 * `{sizeWord}` in the stylist step's party labels; `undefined` (meda fills in
 * the number) where the pack leaves it blank.
 */
export function partySizeWord(labels: Readonly<BookingLabels>, size: number): string | undefined {
  const suffix = size === 2 ? 'two' : size === 3 ? 'three' : 'other';
  return labelText(labels[`wizard.party.sizeWord.${suffix}`]) || undefined;
}
