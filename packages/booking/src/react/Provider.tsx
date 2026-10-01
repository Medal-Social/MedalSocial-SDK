/**
 * `<BookingProvider>` — one config, one label pack and one set of overrides
 * for every booking piece under it (the wizard, a sticky bar, a hero chip, the
 * manage page), so they agree about the business without each being told.
 *
 * Every component also takes the same four props itself; a prop wins over the
 * provider, and a component outside any provider needs at least `config`.
 */

import type {
  AccountCardSlot,
  AddChildSheetSlot,
  BookingCardProps,
  BookingSkeletonSlot,
  ChildCardProps,
  ChildCardsSlot,
  ConfirmationSlot,
  DataControlsSlot,
  DayChipProps,
  DetailsScreenSlot,
  FamilyChipProps,
  FamilyEditorSlot,
  FamilyMemberCardProps,
  LoginPanelSlot,
  LoginSheetSlot,
  LogoutButtonSlot,
  ManageScreenSlot,
  OtpSlotsSlot,
  PartyLineProps,
  PersonCardProps,
  PortalShellSlot,
  PortalUnreachableSlot,
  ProfileFormSlot,
  RebookCardProps,
  RebookCardsSlot,
  ServiceCardProps,
  ServiceScreenSlot,
  SlotClassNames,
  StylistCardProps,
  StylistScreenSlot,
  SummaryBarSlot,
  TimeChipProps,
  TimeScreenSlot,
  UpcomingBookingsSlot,
  VippsButtonSlot,
  VippsLinkRowSlot,
  VisitHistorySlot,
  VisitRowProps,
  WhoScreenSlot,
} from '@medalsocial/meda/booking';
import { type ComponentType, createContext, type ReactNode, useContext, useMemo } from 'react';
import type { BookingConfig } from '../core/config';
import { type BookingKit, createBookingKit } from './kit';
import type { BookingLabels, BookingLabelsInput } from './labels';

/** Per-screen slot classes (see each meda screen's `…Slot` type for the slots). */
export interface BookingClassNames {
  wizard?: SlotClassNames<'root' | 'header' | 'back' | 'progress' | 'alert'>;
  who?: SlotClassNames<WhoScreenSlot>;
  addChild?: SlotClassNames<AddChildSheetSlot>;
  service?: SlotClassNames<ServiceScreenSlot>;
  stylist?: SlotClassNames<StylistScreenSlot>;
  time?: SlotClassNames<TimeScreenSlot>;
  details?: SlotClassNames<DetailsScreenSlot>;
  summary?: SlotClassNames<SummaryBarSlot>;
  confirmation?: SlotClassNames<ConfirmationSlot>;
  skeleton?: SlotClassNames<BookingSkeletonSlot>;
  manage?: SlotClassNames<ManageScreenSlot>;
  loginSheet?: SlotClassNames<LoginSheetSlot>;
  loginPanel?: SlotClassNames<LoginPanelSlot>;
  otp?: SlotClassNames<OtpSlotsSlot>;
  vipps?: SlotClassNames<VippsButtonSlot>;
  portalShell?: SlotClassNames<PortalShellSlot>;
  portalUnreachable?: SlotClassNames<PortalUnreachableSlot>;
  upcoming?: SlotClassNames<UpcomingBookingsSlot>;
  history?: SlotClassNames<VisitHistorySlot>;
  rebook?: SlotClassNames<RebookCardsSlot>;
  childCards?: SlotClassNames<ChildCardsSlot>;
  accountCard?: SlotClassNames<AccountCardSlot>;
  familyEditor?: SlotClassNames<FamilyEditorSlot>;
  profileForm?: SlotClassNames<ProfileFormSlot>;
  dataControls?: SlotClassNames<DataControlsSlot>;
  logout?: SlotClassNames<LogoutButtonSlot>;
  vippsLink?: SlotClassNames<VippsLinkRowSlot>;
}

/** Card-level renderers, by name; each one is handed to the screen that draws it. */
export interface BookingComponents {
  PersonCard?: ComponentType<PersonCardProps>;
  ServiceCard?: ComponentType<ServiceCardProps>;
  StylistCard?: ComponentType<StylistCardProps>;
  DayChip?: ComponentType<DayChipProps>;
  TimeChip?: ComponentType<TimeChipProps>;
  FamilyChip?: ComponentType<FamilyChipProps>;
  PartyLine?: ComponentType<PartyLineProps>;
  BookingCard?: ComponentType<BookingCardProps>;
  VisitRow?: ComponentType<VisitRowProps>;
  RebookCard?: ComponentType<RebookCardProps>;
  ChildCard?: ComponentType<ChildCardProps>;
  FamilyMemberCard?: ComponentType<FamilyMemberCardProps>;
}

/** The four props every booking component and the provider take. */
export interface BookingOverrides {
  /** The site's resolved config (`resolveBookingConfig` from `/core`, run on the server). */
  config?: Readonly<BookingConfig>;
  /**
   * Words over `config.labels`. The pack itself is resolved on the server —
   * `mergeLabels(locale, siteWords)` from `@medalsocial/booking/react/shared`
   * — so the built-in packs never ship in the browser bundle.
   */
  labels?: BookingLabelsInput;
  classNames?: BookingClassNames;
  components?: BookingComponents;
}

interface BookingContextValue {
  config: Readonly<BookingConfig> | undefined;
  labels: BookingLabelsInput | undefined;
  classNames: BookingClassNames;
  components: BookingComponents;
}

const BookingContext = createContext<BookingContextValue | null>(null);

export interface BookingProviderProps extends BookingOverrides {
  children?: ReactNode;
}

export function BookingProvider({
  config,
  labels,
  classNames,
  components,
  children,
}: BookingProviderProps) {
  const parent = useContext(BookingContext);
  const value = useMemo<BookingContextValue>(
    () => ({
      config: config ?? parent?.config,
      labels:
        parent?.labels && labels ? { ...parent.labels, ...labels } : (labels ?? parent?.labels),
      classNames: { ...parent?.classNames, ...classNames },
      components: { ...parent?.components, ...components },
    }),
    [config, labels, classNames, components, parent]
  );
  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

/** What a component renders with: the kit, and the overrides that apply to it. */
export interface ResolvedBooking {
  kit: BookingKit;
  classNames: BookingClassNames;
  components: BookingComponents;
}

/**
 * The kit for a component's own props over the nearest provider. Memoised on
 * the inputs, so a re-render with the same props reuses the same clock,
 * machine and label pack.
 */
export function useBookingKit(props: BookingOverrides): ResolvedBooking {
  const context = useContext(BookingContext);
  const config = props.config ?? context?.config;
  if (config === undefined) {
    throw new Error(
      'A booking component needs a `config`: pass it, or render it inside <BookingProvider config={…}>.'
    );
  }
  const contextLabels = context?.labels;
  const labels = useMemo(
    () => mergedLabels(config, contextLabels, props.labels),
    [config, contextLabels, props.labels]
  );
  const kit = useMemo(() => createBookingKit(config, labels), [config, labels]);
  const contextClassNames = context?.classNames;
  const contextComponents = context?.components;
  const classNames = useMemo(
    () => mergeClassNames(contextClassNames, props.classNames),
    [contextClassNames, props.classNames]
  );
  const components = useMemo(
    () => ({ ...contextComponents, ...props.components }),
    [contextComponents, props.components]
  );
  return { kit, classNames, components };
}

/** Stands in for «no labels» as a cache key. */
const NO_LABELS: BookingLabelsInput = {};
const MERGED = new WeakMap<
  object,
  WeakMap<BookingLabelsInput, WeakMap<BookingLabelsInput, Readonly<BookingLabels>>>
>();

/**
 * The pack a component renders with, cached on its three inputs, so every
 * component that shares a config and the same label objects shares one pack
 * — and so one kit (`createBookingKit` caches on the pack's identity).
 */
function mergedLabels(
  config: Readonly<BookingConfig>,
  outer: BookingLabelsInput | undefined,
  inner: BookingLabelsInput | undefined
): Readonly<BookingLabels> {
  let byOuter = MERGED.get(config);
  if (!byOuter) {
    byOuter = new WeakMap();
    MERGED.set(config, byOuter);
  }
  let byInner = byOuter.get(outer ?? NO_LABELS);
  if (!byInner) {
    byInner = new WeakMap();
    byOuter.set(outer ?? NO_LABELS, byInner);
  }
  const known = byInner.get(inner ?? NO_LABELS);
  if (known) return known;
  const merged = {
    ...config.labels,
    ...outer,
    ...inner,
    // The consent sentence is the one recorded with its version, so the box shows it.
    ...(config.consent.marketing
      ? { 'details.marketing.text': config.consent.marketing.text }
      : {}),
  } as BookingLabels;
  if (merged['who.heading'] === undefined) {
    console.warn(
      '[@medalsocial/booking] No label pack: pass `labels: mergeLabels(locale, …)` from ' +
        "'@medalsocial/booking/react/shared' into the config or the provider."
    );
  }
  byInner.set(inner ?? NO_LABELS, merged);
  return merged;
}

/** Screen by screen: a component's own slot classes over the provider's. */
function mergeClassNames(
  outer: BookingClassNames | undefined,
  inner: BookingClassNames | undefined
): BookingClassNames {
  if (!outer) return inner ?? {};
  if (!inner) return outer;
  const merged: Record<string, Record<string, string> | undefined> = { ...outer };
  for (const [screen, slots] of Object.entries(inner)) {
    merged[screen] = { ...(outer as Record<string, Record<string, string>>)[screen], ...slots };
  }
  return merged as BookingClassNames;
}
