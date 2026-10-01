/**
 * The wizard's steps under the props the moved step suites were written
 * against — the source app's `<WhoStep>`, `<ServiceStep>`, `<StylistStep>`,
 * `<TimeStep>`, `<DetailsStep>`, `<SummaryBar>` and `<Confirmation>` — so their
 * render calls stay as they were.
 *
 * Each one renders the meda screen with its props worked out EXACTLY the way
 * `<BookingWizard>` works them out (`src/react/BookingWizard.tsx`): through the
 * adapters in `src/react/wizard/adapters.ts` and a kit built from the parity
 * config and the test label pack. That is the point: the domain rules the
 * screens leave to their caller — prices, the weekend note, ages, the category
 * filing, the possessive, the phone rules, the summary line, the calendar file
 * — are answered by the package here, and the source's assertions check them.
 *
 * The source's `phone` / `address` props were the site's contact; they map
 * onto `config.contact` (one config per pair, as in `legacy-wizard.tsx`).
 */

import {
  Confirmation as ConfirmationScreen,
  DetailsScreen,
  ServiceScreen,
  StylistScreen,
  SummaryBar as SummaryBarScreen,
  TakenToast as TakenToastScreen,
  TimeScreen,
  TimeScreenSkeleton,
  WhoScreen,
} from '@medalsocial/meda/booking';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { AgeRange } from '../../src/core/age';
import type { BookingConfig } from '../../src/core/config';
import { stylistDisplayName } from '../../src/core/display-name';
import { fill, labelText } from '../../src/core/labels';
import {
  initialState,
  SELF_KEY,
  type WizardItem,
  type WizardPerson,
  type WizardService,
  type WizardState,
} from '../../src/core/machine';
import type { PartySlot } from '../../src/core/party-slots';
import type {
  BookingDayDto,
  BookingFamilyMember,
  BookingResourceDto,
  BookingServiceDto,
  BookingSlotDto,
  BookingSubmission,
} from '../../src/core/types';
import { type BookingKit, createBookingKit } from '../../src/react/kit';
import { type BookingLabels, mergeLabels } from '../../src/react/labels';
import { screenLabels } from '../../src/react/screen-labels';
import { personForChild } from '../../src/react/useBooking';
import {
  childLine as adapterChildLine,
  addedChildEntries,
  confirmationProps,
  detailsLines,
  detailsScreenBase,
  familyEntries,
  guestChoices,
  serviceFitsFor,
  serviceScreenBase,
  weekendNoteFor,
} from '../../src/react/wizard/adapters';
import { TEST_LABELS } from './labels';
import { parityConfigWith } from './legacy-wizard';

/**
 * The label pack the wizard would render with under this config — the same
 * layers, in the same order, as `BookingProvider`'s merge: the config's own,
 * the app's, and the recorded consent sentence on top. Cached per config so
 * the kit (which caches on both identities) is one per contact.
 */
const LABELS = new WeakMap<object, Readonly<BookingLabels>>();

function labelsFor(config: Readonly<BookingConfig>): Readonly<BookingLabels> {
  let labels = LABELS.get(config);
  if (labels === undefined) {
    labels = mergeLabels(
      config.locale,
      config.labels,
      TEST_LABELS,
      config.consent.marketing ? { 'details.marketing.text': config.consent.marketing.text } : null
    );
    LABELS.set(config, labels);
  }
  return labels;
}

/** The kit the wizard would build for a site with this contact. */
export function legacyKit(phone: string | null = null, address: string | null = null): BookingKit {
  const config = parityConfigWith(phone, address);
  return createBookingKit(config, labelsFor(config));
}

/** The source tests' `BASE_URL`: the site's origin, which the calendar file's links resolve against. */
export const BASE_URL = 'https://test.example.com';

export type { WizardItem, WizardService, WizardState };
export { initialState, personForChild, SELF_KEY };

/** The source machine's `reduce`, as the package's wizard for the parity config. */
export function reduce(...args: Parameters<BookingKit['wizard']['reduce']>): WizardState {
  return legacyKit().wizard.reduce(...args);
}

// ---------------------------------------------------------------- step 1

/** «7 år · Sist: …» — `childLine` from the adapters, on the parity kit. */
export function childLine(child: BookingFamilyMember, dayKey: string): string {
  return adapterChildLine(legacyKit(), child, dayKey);
}

/** The sentence the family cards say at the limit (`who.family.limit`). */
export const LIMIT_SENTENCE = fill(legacyKit().labels['who.family.limit'], {
  max: legacyKit().wizard.maxPeople,
});

interface WhoStepProps {
  people: WizardPerson[];
  family: BookingFamilyMember[] | null;
  dayKey: string;
  onChoose: (people: WizardPerson[], advance: boolean) => void;
  onAddChild: (child: {
    name: string;
    birthYear: number;
    birthMonth?: number;
    notes?: string;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  loginRow?: ReactNode;
}

export function WhoStep({ people, family, dayKey, onChoose, onAddChild, loginRow }: WhoStepProps) {
  const kit = legacyKit();
  return (
    <WhoScreen
      labels={screenLabels(kit.labels)}
      format={kit.format}
      people={people}
      family={family === null ? null : familyEntries(kit, family, dayKey)}
      guestChoices={guestChoices(kit)}
      addedChildren={addedChildEntries(kit, people, dayKey)}
      maxPeople={kit.wizard.maxPeople}
      selfKey={SELF_KEY}
      isGuestSeat={kit.wizard.isGuestSeat}
      onChoose={onChoose}
      onAddChild={onAddChild}
      loginRow={loginRow}
      currentYear={Number(dayKey.slice(0, 4))}
    />
  );
}

// ---------------------------------------------------------------- step 2

/** «Passer vanligvis ikke for Theos alder» — the divider meda draws, in the kit's possessive. */
export function ageDividerLabel(name: string | null | undefined): string {
  const kit = legacyKit();
  return name
    ? fill(kit.labels['service.ageDivider.named'], { nameGenitive: kit.possessive(name), name })
    : labelText(kit.labels['service.ageDivider.unnamed']);
}

interface ServiceSuggestion {
  service: BookingServiceDto;
  note?: string;
}

interface PartyPerson {
  key: string;
  label: string;
  adult: boolean;
  suggestion?: ServiceSuggestion | null;
  age?: AgeRange | null;
  name?: string;
}

interface ServiceStepProps {
  services: BookingServiceDto[];
  phone?: string | null;
  initialCategory?: string | null;
  onPick: (service: BookingServiceDto) => void;
  party?: {
    people: ReadonlyArray<PartyPerson>;
    choices: ReadonlyArray<{ id: string } | null>;
    onPickFor: (index: number, service: BookingServiceDto) => void;
    onRemove?: (index: number) => void;
  };
  suggestion?: ServiceSuggestion | null;
  chosenId?: string | null;
  age?: AgeRange | null;
  childName?: string | null;
}

export function ServiceStep({
  services,
  phone = null,
  initialCategory = null,
  onPick,
  party,
  suggestion = null,
  chosenId = null,
  age = null,
  childName = null,
}: ServiceStepProps) {
  const kit = legacyKit(phone);
  const family = party !== undefined && party.people.length > 1 ? party : undefined;
  // The ages the wizard reads off each seated person, in seat order.
  const ages = family ? family.people.map((person) => person.age ?? null) : [age];
  return (
    <ServiceScreen
      labels={screenLabels(kit.labels)}
      format={kit.format}
      services={services}
      {...serviceScreenBase(kit)}
      serviceFits={serviceFitsFor(kit, ages)}
      initialCategory={initialCategory}
      onPick={onPick}
      suggestion={family ? null : suggestion}
      chosenId={family ? null : chosenId}
      childName={family ? null : childName}
      party={
        family
          ? {
              people: family.people.map(({ age: _age, ...person }) => person),
              choices: family.choices,
              onPickFor: family.onPickFor,
              onRemove: family.onRemove,
            }
          : undefined
      }
    />
  );
}

// ---------------------------------------------------------------- step 3

interface StylistStepProps {
  serviceIds: string[];
  resources: BookingResourceDto[];
  selectedResourceId?: string | null;
  nextAvailableTs?: Record<string, number | null>;
  nextAvailableLoading?: boolean;
  loading?: boolean;
  skeletonCount?: number;
  pendingName?: string | null;
  notice?: string | null;
  onPick: (resourceId: string | null) => void;
  party?: {
    mode: WizardState['partyMode'];
    size: number;
    minutes: { sequential: number; parallel: number };
    onMode: (mode: WizardState['partyMode']) => void;
  };
}

export function StylistStep(props: StylistStepProps) {
  const kit = legacyKit();
  return <StylistScreen labels={screenLabels(kit.labels)} format={kit.format} {...props} />;
}

interface TimeStepProps {
  slots: BookingSlotDto[];
  days?: number[];
  openDays?: BookingDayDto[] | null;
  stylistName?: string | null;
  takenSlotTs?: number | null;
  phone?: string | null;
  /** What is being booked, for the weekend surcharge (a party of one). */
  service?: WizardService | null;
  currentSlotTs?: number | null;
  monthView?: boolean;
  onPick: (slot: BookingSlotDto) => void;
  party?: {
    items: WizardItem[];
    mode: WizardState['partyMode'];
    slots: PartySlot[];
    alternatives?: PartySlot[];
    resolveStylistName: (resourceId: string) => string | null;
    onPick: (slot: PartySlot) => void;
  };
}

export function TimeStep({
  slots,
  days,
  openDays = null,
  stylistName = null,
  takenSlotTs = null,
  phone = null,
  service = null,
  currentSlotTs = null,
  monthView = false,
  onPick,
  party,
}: TimeStepProps) {
  const kit = legacyKit(phone);
  const { wizard } = kit;
  // The basket the weekend note prices: the family's, or the one service.
  const items: WizardItem[] = party ? party.items : service ? [{ service }] : [];
  return (
    <TimeScreen
      labels={screenLabels(kit.labels)}
      format={kit.format}
      dayparts={kit.dayparts}
      monthView={monthView}
      slots={slots}
      days={days}
      openDays={openDays}
      stylistName={stylistName}
      takenSlotTs={takenSlotTs}
      currentSlotTs={currentSlotTs}
      phone={kit.config.contact.phone}
      weekendNote={(dayTs) => weekendNoteFor(kit, items, dayTs)}
      onPick={onPick}
      party={
        party
          ? {
              items: party.items,
              mode: party.mode,
              slots: party.slots,
              chipEndTs: (slot) => wizard.visitEndTs(party.items, slot.startTs, 'sequential'),
              alternativeFor: (dayTs) =>
                party.mode === 'sequential'
                  ? kit.partySlots.partyAlternative({
                      sequential: party.slots,
                      parallel: party.alternatives ?? [],
                      dayTs,
                    })
                  : null,
              resolveStylistName: party.resolveStylistName,
              onPick: party.onPick,
            }
          : undefined
      }
    />
  );
}

export function TimeStepSkeleton({
  days = 7,
  monthView = false,
  surchargeRow = false,
}: {
  days?: number;
  monthView?: boolean;
  surchargeRow?: boolean;
}) {
  const kit = legacyKit();
  return (
    <TimeScreenSkeleton
      labels={screenLabels(kit.labels)}
      days={days}
      monthView={monthView}
      surchargeRow={surchargeRow}
    />
  );
}

export function TakenToast({ takenSlotTs }: { takenSlotTs: number | null }) {
  return <TakenToastScreen labels={screenLabels(legacyKit().labels)} takenSlotTs={takenSlotTs} />;
}

// ---------------------------------------------------------------- step 4

interface DetailsStepProps {
  state: WizardState;
  onChange: Parameters<typeof DetailsScreen>[0]['onChange'];
  onSubmit: (submission: BookingSubmission) => void;
  submitting?: boolean;
  phone?: string | null;
  family?: BookingFamilyMember[];
  guardianPhone?: string | null;
}

export function DetailsStep({
  state,
  onChange,
  onSubmit,
  submitting = false,
  phone = null,
  family,
  guardianPhone = null,
}: DetailsStepProps) {
  const kit = legacyKit(phone);
  return (
    <DetailsScreen
      state={state}
      onChange={onChange}
      onSubmit={onSubmit}
      lines={detailsLines(kit, state)}
      totalOre={kit.wizard.totalPriceOre(state.items, state.startTs)}
      {...detailsScreenBase(kit)}
      submitting={submitting}
      family={family}
      guardianPhone={guardianPhone}
      format={kit.format}
      labels={screenLabels(kit.labels)}
    />
  );
}

// ---------------------------------------------------------------- the bar

interface SummaryBarProps {
  state: WizardState;
  resolveStylistName: (resourceId: string) => string | null;
  onNext: () => void;
}

export function SummaryBar({ state, resolveStylistName, onNext }: SummaryBarProps) {
  const kit = legacyKit();
  // The wizard's resolver hands the bar display names (`useBooking`'s `resolveStylistName`).
  const resolve = (resourceId: string) => {
    const name = resolveStylistName(resourceId);
    return name ? stylistDisplayName(name) || null : null;
  };
  return (
    <SummaryBarScreen
      line={kit.wizard.summaryLine(state, resolve)}
      canAdvance={kit.wizard.canAdvance(state)}
      step={state.step}
      onNext={onNext}
      labels={screenLabels(kit.labels)}
    />
  );
}

// ---------------------------------------------------------------- confirmed

export interface ConfirmationLine {
  item: WizardItem;
  bookingId: string;
  stylistName: string | null;
  manageHref: string | null;
}

interface ConfirmationProps {
  lines: ConfirmationLine[];
  startTs: number;
  partyMode?: WizardState['partyMode'];
  address?: string | null;
  onStartOver?: () => void;
}

export function Confirmation({
  lines,
  startTs,
  partyMode = 'sequential',
  address = null,
  onStartOver,
}: ConfirmationProps) {
  const kit = legacyKit(null, address);
  // Read once, as the wizard reads it, so «i dag» cannot become «i morgen» halfway down.
  const [now] = useState(() => Date.now());
  const confirmation = {
    bookings: lines.map((line) => ({ id: line.bookingId, manageHref: line.manageHref })),
    submitted: {
      items: lines.map((line) => line.item),
      startTs,
      partyMode,
      resourceIds: lines.map(() => null),
      stylistNames: lines.map((line) => line.stylistName),
    },
  };
  return (
    <ConfirmationScreen
      {...confirmationProps(kit, confirmation, BASE_URL)}
      onStartOver={onStartOver}
      now={now}
      format={kit.format}
      labels={screenLabels(kit.labels)}
    />
  );
}
