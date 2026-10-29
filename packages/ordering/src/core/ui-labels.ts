/**
 * Every word the ordering components show a guest, in Norwegian and English.
 * Plain words for someone ordering food, not for staff. `{name}` marks a
 * value filled in at render time. Arabic and any other language fall back to
 * English here; a site passes its own words through `labels`, merged over the
 * pack key by key. Allergen and dietary names are in `./labels`, in nb, en and ar.
 *
 * In `/core`, not `/react`, so a server component can read and merge the
 * words (for its own markup, or to pass `labels` down) without importing a
 * `'use client'` module. No React here.
 */
import { labelLocale } from './labels';

export interface OrderingLabels {
  /** The closed notice. */
  closed: string;
  /** `{time}` today, e.g. «Åpner kl. 11:00». */
  opensToday: string;
  opensTomorrow: string;
  /** `{day}`: a weekday name from `weekdays`. */
  opensOn: string;
  /** `{date}`: a day and month, for an opening a week or more away. */
  opensOnDate: string;
  /** Sunday first, as `Date#getDay()` counts. */
  weekdays: readonly [string, string, string, string, string, string, string];
  /** The menu list. */
  categories: string;
  menuEmpty: string;
  allergens: string;
  dietary: string;
  soldOut: string;
  /** The dish sheet. */
  close: string;
  itemSoldOut: string;
  chooseExactly: string;
  chooseUpTo: string;
  chooseBetween: string;
  optional: string;
  none: string;
  mustChoose: string;
  mustChooseAtLeast: string;
  notPossible: string;
  quantity: string;
  fewer: string;
  more: string;
  note: string;
  noteHint: string;
  /** `{price}`: the unit price with the choices, times the quantity. */
  add: string;
  /** The same, when the sheet edits a line already in the cart. */
  update: string;
  /** The cart bar and the cart. `{n}`: how many dishes. */
  cartCountOne: string;
  cartCountMany: string;
  /** `{price}`: the cart total. */
  viewCart: string;
  yourOrder: string;
  total: string;
  /** `{name}`: the dish. */
  removeLine: string;
  cartEmpty: string;
  droppedTitle: string;
  /** `{name}`: the dish, or `someDish` when the menu no longer has it. */
  droppedUnavailable: string;
  droppedSoldOut: string;
  droppedOptions: string;
  someDish: string;
  /** Checkout: how the guest gets the food. */
  channelLegend: string;
  channelTakeaway: string;
  channelDineIn: string;
  channelDelivery: string;
  /** `{table}`: the table's label. */
  atTable: string;
  timingLegend: string;
  asap: string;
  scheduled: string;
  slotDay: string;
  slotTime: string;
  today: string;
  tomorrow: string;
  slotsLoading: string;
  noSlots: string;
  chooseSlot: string;
  detailsLegend: string;
  name: string;
  phone: string;
  email: string;
  emailHint: string;
  nameError: string;
  phoneError: string;
  emailError: string;
  preferencesLegend: string;
  allergyNote: string;
  allergyWarning: string;
  allergyNoteError: string;
  cutlery: string;
  paymentLegend: string;
  payVipps: string;
  payAtCounter: string;
  /** `{price}`: the cart total. */
  placeOrder: string;
  payWithVipps: string;
  placing: string;
  /** The message for each error code an order can come back with. */
  errorClosed: string;
  errorCutoff: string;
  errorChannel: string;
  errorPreorder: string;
  errorTable: string;
  errorSoldOut: string;
  errorUnavailable: string;
  errorOptions: string;
  errorCart: string;
  errorPaymentMethod: string;
  errorVipps: string;
  errorCustomer: string;
  errorRateLimited: string;
  errorInProgress: string;
  errorConflict: string;
  errorNotEnabled: string;
  errorNotFound: string;
  errorGeneric: string;
  /** The order's status. `{number}`: the order number. */
  orderNumber: string;
  orderSteps: string;
  /** `{time}`: when it should be ready, the restaurant's clock. */
  readyAt: string;
  awaitingPayment: string;
  declinedSoldOut: string;
  declinedTooBusy: string;
  declinedClosingSoon: string;
  declinedOther: string;
  declinedTimeout: string;
  notCharged: string;
  refunded: string;
  statusUnavailable: string;
}

const NB: OrderingLabels = {
  closed: 'Restauranten tar ikke imot bestillinger nå.',
  opensToday: 'Åpner kl. {time}',
  opensTomorrow: 'Åpner i morgen kl. {time}',
  opensOn: 'Åpner {day} kl. {time}',
  opensOnDate: 'Åpner {date} kl. {time}',
  weekdays: ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'],
  categories: 'Kategorier',
  menuEmpty: 'Det er ingenting på menyen akkurat nå.',
  allergens: 'Allergener',
  dietary: 'Om retten',
  soldOut: 'Utsolgt',
  close: 'Lukk',
  itemSoldOut: 'Denne retten er utsolgt.',
  chooseExactly: 'Velg {n}',
  chooseUpTo: 'Velg opptil {n}',
  chooseBetween: 'Velg {min} til {max}',
  optional: 'Valgfritt',
  none: 'Ingen',
  mustChoose: 'Du må velge {n}.',
  mustChooseAtLeast: 'Du må velge minst {n}.',
  notPossible: 'Ett av valgene her er ikke mulig lenger.',
  quantity: 'Antall',
  fewer: 'Én færre',
  more: 'Én til',
  note: 'Beskjed til kjøkkenet',
  noteHint: 'Valgfritt, opptil {n} tegn.',
  add: 'Legg til · {price}',
  update: 'Oppdater · {price}',
  cartCountOne: '1 rett',
  cartCountMany: '{n} retter',
  viewCart: 'Se bestillingen · {price}',
  yourOrder: 'Din bestilling',
  total: 'Totalt',
  removeLine: 'Fjern {name}',
  cartEmpty: 'Bestillingen er tom.',
  droppedTitle: 'Noe er tatt ut av bestillingen',
  droppedUnavailable: '{name} finnes ikke på menyen lenger.',
  droppedSoldOut: '{name} er utsolgt.',
  droppedOptions: 'Valgene for {name} er endret. Legg den til på nytt.',
  someDish: 'En rett',
  channelLegend: 'Hvordan vil du ha maten?',
  channelTakeaway: 'Hent selv',
  channelDineIn: 'Spis her',
  channelDelivery: 'Levering',
  atTable: 'Bord {table}',
  timingLegend: 'Når?',
  asap: 'Så snart som mulig',
  scheduled: 'Velg tidspunkt',
  slotDay: 'Dag',
  slotTime: 'Tidspunkt',
  today: 'I dag',
  tomorrow: 'I morgen',
  slotsLoading: 'Henter ledige tider …',
  noSlots: 'Ingen ledige tider denne dagen.',
  chooseSlot: 'Velg et tidspunkt.',
  detailsLegend: 'Dine opplysninger',
  name: 'Navn',
  phone: 'Mobilnummer',
  email: 'E-post (valgfritt)',
  emailHint: 'Vi sender kvitteringen hit.',
  nameError: 'Skriv navnet ditt.',
  phoneError: 'Skriv et gyldig mobilnummer.',
  emailError: 'Skriv en gyldig e-postadresse, eller la feltet stå tomt.',
  preferencesLegend: 'Allergier og bestikk',
  allergyNote: 'Allergier (valgfritt)',
  allergyWarning: 'Kontakt restauranten ved alvorlig allergi.',
  allergyNoteError: 'Allerginotatet kan være opptil {n} tegn.',
  cutlery: 'Jeg vil ha bestikk',
  paymentLegend: 'Betaling',
  payVipps: 'Vipps',
  payAtCounter: 'Betal i disken',
  placeOrder: 'Bestill · {price}',
  payWithVipps: 'Betal med Vipps · {price}',
  placing: 'Sender bestillingen …',
  errorClosed: 'Restauranten tar ikke imot bestillinger nå.',
  errorCutoff: 'Det er for sent å bestille til dette tidspunktet.',
  errorChannel: 'Restauranten tilbyr ikke dette nå. Velg en annen måte å få maten på.',
  errorPreorder: 'Restauranten tar ikke imot forhåndsbestillinger. Velg «Så snart som mulig».',
  errorTable: 'Vi fant ikke bordet. Skann QR-koden på bordet på nytt.',
  errorSoldOut: 'Noe i bestillingen er utsolgt. Se over bestillingen og prøv igjen.',
  errorUnavailable:
    'Noe i bestillingen finnes ikke på menyen lenger. Se over bestillingen og prøv igjen.',
  errorOptions: 'Valgene for en av rettene gjelder ikke lenger. Se over bestillingen.',
  errorCart: 'Bestillingen kan ikke sendes slik den er. Se over antall og beskjeder.',
  errorPaymentMethod: 'Denne betalingsmåten tas ikke imot her. Velg en annen.',
  errorVipps: 'Vipps er ikke tilgjengelig akkurat nå. Velg en annen betalingsmåte.',
  errorCustomer: 'Sjekk opplysningene dine.',
  errorRateLimited: 'Mange bestillinger på kort tid. Vent et minutt og prøv igjen.',
  errorInProgress: 'Bestillingen sendes fortsatt. Vent litt og prøv igjen.',
  errorConflict: 'Bestillingen ble endret mens den ble sendt. Prøv igjen.',
  errorNotEnabled: 'Nettbestilling er ikke tilgjengelig her.',
  errorNotFound: 'Vi fant ikke bestillingen.',
  errorGeneric: 'Noe gikk galt. Prøv igjen om litt.',
  orderNumber: 'Bestilling {number}',
  orderSteps: 'Status for bestillingen',
  readyAt: 'Klar ca. kl. {time}',
  awaitingPayment: 'Venter på betalingen i Vipps.',
  declinedSoldOut: 'Restauranten hadde ikke alt du bestilte.',
  declinedTooBusy: 'Restauranten har for mye å gjøre akkurat nå.',
  declinedClosingSoon: 'Restauranten stenger snart.',
  declinedOther: 'Restauranten kunne ikke ta imot bestillingen.',
  declinedTimeout: 'Restauranten svarte ikke i tide.',
  notCharged: 'Du er ikke trukket for bestillingen.',
  refunded: 'Pengene er betalt tilbake.',
  statusUnavailable: 'Vi får ikke hentet status akkurat nå. Vi prøver igjen.',
};

const EN: OrderingLabels = {
  closed: 'The restaurant is not taking orders right now.',
  opensToday: 'Opens at {time}',
  opensTomorrow: 'Opens tomorrow at {time}',
  opensOn: 'Opens {day} at {time}',
  opensOnDate: 'Opens {date} at {time}',
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  categories: 'Categories',
  menuEmpty: 'There is nothing on the menu right now.',
  allergens: 'Allergens',
  dietary: 'About this dish',
  soldOut: 'Sold out',
  close: 'Close',
  itemSoldOut: 'This dish is sold out.',
  chooseExactly: 'Choose {n}',
  chooseUpTo: 'Choose up to {n}',
  chooseBetween: 'Choose {min} to {max}',
  optional: 'Optional',
  none: 'None',
  mustChoose: 'Please choose {n}.',
  mustChooseAtLeast: 'Please choose at least {n}.',
  notPossible: 'One of these choices is no longer possible.',
  quantity: 'Quantity',
  fewer: 'One fewer',
  more: 'One more',
  note: 'Note for the kitchen',
  noteHint: 'Optional, up to {n} characters.',
  add: 'Add · {price}',
  update: 'Update · {price}',
  cartCountOne: '1 dish',
  cartCountMany: '{n} dishes',
  viewCart: 'View order · {price}',
  yourOrder: 'Your order',
  total: 'Total',
  removeLine: 'Remove {name}',
  cartEmpty: 'Your order is empty.',
  droppedTitle: 'Something was taken out of your order',
  droppedUnavailable: '{name} is no longer on the menu.',
  droppedSoldOut: '{name} is sold out.',
  droppedOptions: 'The choices for {name} have changed. Please add it again.',
  someDish: 'A dish',
  channelLegend: 'How would you like your food?',
  channelTakeaway: 'Pick up',
  channelDineIn: 'Eat here',
  channelDelivery: 'Delivery',
  atTable: 'Table {table}',
  timingLegend: 'When?',
  asap: 'As soon as possible',
  scheduled: 'Choose a time',
  slotDay: 'Day',
  slotTime: 'Time',
  today: 'Today',
  tomorrow: 'Tomorrow',
  slotsLoading: 'Finding free times …',
  noSlots: 'No free times on this day.',
  chooseSlot: 'Please choose a time.',
  detailsLegend: 'Your details',
  name: 'Name',
  phone: 'Mobile number',
  email: 'Email (optional)',
  emailHint: 'We send the receipt here.',
  nameError: 'Please enter your name.',
  phoneError: 'Please enter a valid mobile number.',
  emailError: 'Please enter a valid email address, or leave it empty.',
  preferencesLegend: 'Allergies and cutlery',
  allergyNote: 'Allergies (optional)',
  allergyWarning: 'Please contact the restaurant about a serious allergy.',
  allergyNoteError: 'The allergy note can be up to {n} characters.',
  cutlery: 'I would like cutlery',
  paymentLegend: 'Payment',
  payVipps: 'Vipps',
  payAtCounter: 'Pay at the counter',
  placeOrder: 'Order · {price}',
  payWithVipps: 'Pay with Vipps · {price}',
  placing: 'Sending your order …',
  errorClosed: 'The restaurant is not taking orders right now.',
  errorCutoff: 'It is too late to order for this time.',
  errorChannel:
    'The restaurant does not offer this right now. Please choose another way to get your food.',
  errorPreorder: 'The restaurant does not take orders ahead. Please choose «As soon as possible».',
  errorTable: 'We could not find your table. Please scan the QR code on the table again.',
  errorSoldOut: 'Something in your order is sold out. Please check your order and try again.',
  errorUnavailable:
    'Something in your order is no longer on the menu. Please check your order and try again.',
  errorOptions: 'The choices for one of the dishes no longer apply. Please check your order.',
  errorCart: 'Your order cannot be sent as it is. Please check the quantities and notes.',
  errorPaymentMethod: 'This way of paying is not taken here. Please choose another.',
  errorVipps: 'Vipps is not available right now. Please choose another way to pay.',
  errorCustomer: 'Please check your details.',
  errorRateLimited: 'Many orders in a short time. Please wait a minute and try again.',
  errorInProgress: 'Your order is still being sent. Please wait a moment and try again.',
  errorConflict: 'Your order changed while it was being sent. Please try again.',
  errorNotEnabled: 'Online ordering is not available here.',
  errorNotFound: 'We could not find this order.',
  errorGeneric: 'Something went wrong. Please try again in a moment.',
  orderNumber: 'Order {number}',
  orderSteps: 'Order status',
  readyAt: 'Ready at about {time}',
  awaitingPayment: 'Waiting for your payment in Vipps.',
  declinedSoldOut: 'The restaurant did not have everything you ordered.',
  declinedTooBusy: 'The restaurant is too busy right now.',
  declinedClosingSoon: 'The restaurant is closing soon.',
  declinedOther: 'The restaurant could not take your order.',
  declinedTimeout: 'The restaurant did not answer in time.',
  notCharged: 'You have not been charged for this order.',
  refunded: 'Your money has been paid back.',
  statusUnavailable: 'We cannot get the status right now. We will try again.',
};

export const ORDERING_LABELS: Readonly<Record<'nb' | 'en', OrderingLabels>> = { nb: NB, en: EN };

/**
 * The pack for a BCP 47 locale (Norwegian for nb/no/nn, else English), with a
 * site's words over it. A key the site leaves `undefined` keeps the pack's word.
 */
export function mergeLabels(locale: string, labels?: Partial<OrderingLabels>): OrderingLabels {
  const pack = ORDERING_LABELS[labelLocale(locale) === 'nb' ? 'nb' : 'en'];
  const merged: Record<string, unknown> = { ...pack };
  // The pack's own keys only, so a stray key (`__proto__` included) changes nothing.
  for (const key of Object.keys(pack) as (keyof OrderingLabels)[]) {
    const value = labels?.[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as OrderingLabels;
}

/** `{key}` → the value; an unknown placeholder stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}
