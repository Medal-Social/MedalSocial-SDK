/**
 * `<BookingWizard>` — the booking flow, from «who is it for?» to the
 * confirmation, drawn with the `@medalsocial/meda/booking` screens over
 * `useBooking()`.
 *
 * The hook owns the machine, the fetches and the stores; this file owns the
 * page: which step is on screen (ONE at a time — the details step's nonce and
 * the submit flag depend on it), focus and scroll on every move, the restore
 * gate's pre-hydration script and skeleton, the header, and what each screen
 * is handed (prices, the weekend note, ages, the possessive, the calendar
 * file) out of the site's config.
 */

import {
  BookingButton,
  BookingRecap,
  Confirmation,
  DetailsScreen,
  LiveStatus,
  ServiceScreen,
  StylistScreen,
  SummaryBar,
  TakenToast,
  TimeScreen,
  TimeScreenSkeleton,
  WhoScreen,
} from '@medalsocial/meda/booking';
import { ArrowLeft } from 'lucide-react';
import {
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fill, fillParts, labelText } from '../core/labels';
import { SELF_KEY, type WizardPerson, type WizardState, type WizardStep } from '../core/machine';
import type { BookingServiceDto } from '../core/types';
import { visitServicesOf } from '../core/visit';
import type { PortalActions } from './actions';
import type { BookingKit } from './kit';
import { LoginSheet } from './LoginSheet';
import type { BookingOverrides, ResolvedBooking } from './Provider';
import { useBookingKit } from './Provider';
import { screenLabels } from './screen-labels';
import {
  type BookingConfirmation,
  type BookingController,
  type BookingSeed,
  useBooking,
} from './useBooking';
import {
  addedChildEntries,
  confirmationProps,
  detailsLines,
  detailsScreenBase,
  familyEntries,
  GUEST_ADULT_SEAT,
  guestChoices,
  partyPeople,
  partySizeWord,
  recapProps,
  serviceFitsFor,
  serviceScreenBase,
  stylistFace,
  weekendNoteFor,
} from './wizard/adapters';
import { forMedaScreen, wizardErrorText } from './wizard-error';

export interface BookingWizardProps extends BookingOverrides {
  /** What the page prefetched (the `/next` loader's seed). */
  seed: BookingSeed;
  /** This request's phone and address, over `config.contact` (the loader's `contact`). */
  contact?: { phone?: string | null; address?: string | null };
  /** The parent the page found a portal session for; `null` for a guest. */
  guardian?: BookingGuardianProp;
  /**
   * The app's server actions for the login sheet (Decision 8). Without them —
   * or with `config.portal.enabled` off — no login is offered.
   */
  actions?: Pick<PortalActions, 'startLogin' | 'startVipps'>;
  /** How many days the window covers. Default `config.window.rangeDays`. */
  rangeDays?: number;
  /**
   * The site's origin (`https://…`), so the manage links inside the calendar
   * file are absolute. Absent, they stay root-relative.
   */
  siteUrl?: string;
  /** A monitoring tap: the step the visitor is on, and a submission's outcome. */
  onEvent?: (event: BookingWizardEvent) => void;
}

type BookingGuardianProp = Parameters<typeof useBooking>[0]['guardian'];

export type BookingWizardEvent =
  | { type: 'step'; step: WizardStep | 'confirmed' }
  | { type: 'submit_ok'; bookings: number }
  | { type: 'submit_error'; code: NonNullable<WizardState['error']> };

/** The bundler's build mode, which it inlines; absent outside a bundler. */
declare const process: { env: { NODE_ENV?: string } } | undefined;

/** The wizard's root, for the inline restore gate to find before hydration. */
const WIZARD_ROOT_ID = 'booking-wizard';

/** The time step's heading, which a lost slot sends the visitor back to. */
const TIME_HEADING_ID = 'booking-time-heading';

/** The heading each screen focuses when the visitor arrives on it. */
const STEP_HEADINGS: Record<WizardStep | 'confirmed', string> = {
  who: 'booking-who-heading',
  service: 'booking-service-heading',
  when: 'booking-stylist-heading',
  details: 'booking-details-heading',
  confirmed: 'booking-confirmed-heading',
};

const STEPS: readonly WizardStep[] = ['who', 'service', 'when', 'details'];

/** Smooth, or instant for a visitor who asked for reduced motion. */
function scrollToTop(target: HTMLElement | null): void {
  if (!target || typeof target.scrollIntoView !== 'function') return;
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/**
 * The wizard, behind its own Suspense boundary: `useSearchParams` throws to
 * the nearest one during a static prerender, and without ours that is the
 * root layout's — the whole page would ship empty until hydration.
 */
export function BookingWizard(props: BookingWizardProps) {
  return (
    <Suspense fallback={null}>
      <BookingWizardShell {...props} />
    </Suspense>
  );
}

function BookingWizardShell(props: BookingWizardProps) {
  const resolved = useBookingKit(props, props.contact);
  const loginOffered = props.actions !== undefined && resolved.kit.config.portal.enabled;
  const booking = useBooking({ ...props, loginOffered });
  const { kit } = booking;
  const { labels } = kit;

  // `account.required` with no way to log in: every «Bekreft» would be refused.
  const unreachableLogin = kit.config.account.required && !loginOffered;
  useEffect(() => {
    if (
      unreachableLogin &&
      typeof process !== 'undefined' &&
      process.env.NODE_ENV !== 'production'
    ) {
      console.warn('[booking] account.required without login actions: nobody can log in to book.');
    }
  }, [unreachableLogin]);
  const { state, restore, confirmed, onEvent } = { ...booking, onEvent: props.onEvent };

  /**
   * On every change of screen: the wizard's top into view and focus on the
   * new step's heading. Never on the first screen, and never for what the
   * restore gate reveals — that is the page arriving, not the visitor moving.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const screenKey: WizardStep | 'confirmed' = confirmed !== null ? 'confirmed' : state.step;
  const shownScreen = useRef<WizardStep | 'confirmed' | null>(null);
  const takenSlotTs = booking.slots.takenSlotTs;
  const timeStepReady = booking.slots.ready;
  const focusTimeWhenReady = useRef(false);
  useEffect(() => {
    if (restore.restoring) return;
    const previous = shownScreen.current;
    shownScreen.current = screenKey;
    if (previous === screenKey) return;
    onEvent?.({ type: 'step', step: screenKey });
    if (previous === null) return;
    // A lost slot sends the visitor back for the ALTERNATIVES, on the time half.
    const toTimes = screenKey === 'when' && takenSlotTs !== null;
    const headingId = toTimes ? TIME_HEADING_ID : STEP_HEADINGS[screenKey];
    const heading = document.getElementById(headingId);
    scrollToTop(toTimes ? heading : rootRef.current);
    heading?.focus({ preventScroll: true });
    // The heading focused now may be the skeleton's; focus follows the real one.
    focusTimeWhenReady.current = toTimes && !timeStepReady;
  }, [screenKey, restore.restoring, takenSlotTs, timeStepReady, onEvent]);

  /** After a login from the sheet the row that opened it is gone: focus the step's heading. */
  const focusAfterSignIn = useRef(false);
  const signedIn = booking.login.signedIn;
  useEffect(() => {
    if (signedIn === null || !focusAfterSignIn.current) return;
    focusAfterSignIn.current = false;
    document.getElementById(STEP_HEADINGS[state.step])?.focus({ preventScroll: true });
  }, [signedIn, state.step]);
  /**
   * A 401 put the gate back over the form: focus its heading (the details
   * step's id), where the notice beside it says why. Once per loss, and only
   * once the gate is actually on screen — a replay answers behind the skeleton.
   */
  const sessionLost = booking.login.sessionLost;
  const sessionLossFocused = useRef(false);
  useEffect(() => {
    if (!sessionLost) {
      sessionLossFocused.current = false;
      return;
    }
    if (sessionLossFocused.current || restore.restoring || state.step !== 'details') return;
    sessionLossFocused.current = true;
    const heading = document.getElementById(STEP_HEADINGS.details);
    scrollToTop(rootRef.current);
    heading?.focus({ preventScroll: true });
  }, [sessionLost, restore.restoring, state.step]);
  useEffect(() => {
    if (!timeStepReady || !focusTimeWhenReady.current) return;
    focusTimeWhenReady.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      document.getElementById(TIME_HEADING_ID)?.focus({ preventScroll: true });
    }
  }, [timeStepReady]);

  // The monitoring tap for a submission's outcome.
  const lastError = useRef(state.error);
  useEffect(() => {
    if (state.error !== null && state.error !== lastError.current) {
      onEvent?.({ type: 'submit_error', code: state.error });
    }
    lastError.current = state.error;
  }, [state.error, onEvent]);
  const confirmedCount = confirmed?.bookings.length ?? 0;
  useEffect(() => {
    if (confirmedCount > 0) onEvent?.({ type: 'submit_ok', bookings: confirmedCount });
  }, [confirmedCount, onEvent]);

  // React owns the root from here on: drop the pre-hydration mark the inline
  // script may have set, and say so, so the script's fallback timer stands down.
  useLayoutEffect(() => {
    if (!restore.hydrated) return;
    rootRef.current?.removeAttribute('data-restoring');
    rootRef.current?.setAttribute('data-hydrated', '');
  }, [restore.hydrated]);

  // Steps animate in only once the visitor has moved between them.
  const [arrivalStep, setArrivalStep] = useState<WizardStep | null>(
    restore.restoring ? null : state.step
  );
  if (!restore.restoring && arrivalStep === null) setArrivalStep(state.step);
  const [stepsMovedOnce, setStepsMovedOnce] = useState(false);
  const movedNow = arrivalStep !== null && !restore.restoring && state.step !== arrivalStep;
  if (movedNow && !stepsMovedOnce) setStepsMovedOnce(true);
  const stepsMoved = stepsMovedOnce || movedNow;

  const restoreSkeleton = <RestoreSkeleton text={labelText(labels['wizard.restoring'])} />;
  /**
   * The root both screens share: the scroll target, and the element the
   * inline restore gate marks. The script and the hidden skeleton exist only
   * in the server's HTML and the hydration pass that adopts it.
   */
  const shell = (content: ReactNode) => (
    <div
      id={WIZARD_ROOT_ID}
      ref={rootRef}
      className={resolved.classNames.wizard?.root ?? 'group scroll-mt-28'}
      suppressHydrationWarning
    >
      {!restore.hydrated && (
        <>
          <script
            // A fixed script built from constants, run before hydration.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: the restore gate must run before React does.
            dangerouslySetInnerHTML={{
              __html: kit.restoreGate.restoreGateScript(
                WIZARD_ROOT_ID,
                restore.linked,
                restore.resuming
              ),
            }}
          />
          <div className="hidden group-data-[restoring]:block">{restoreSkeleton}</div>
        </>
      )}
      {restore.restoring && restore.hydrated ? (
        restoreSkeleton
      ) : (
        <div className="group-data-[restoring]:hidden">{content}</div>
      )}
    </div>
  );

  if (confirmed !== null) {
    return shell(
      <ConfirmationStep booking={booking} resolved={resolved} siteUrl={props.siteUrl} />
    );
  }

  const onSignedIn = (who: Parameters<BookingController['login']['signIn']>[0]) => {
    focusAfterSignIn.current = true;
    booking.login.signIn(who);
  };
  // The multi-select service step carries its own total bar and refusal notice.
  const multiSelect = state.step === 'service' && kit.config.party.maxServicesPerPerson > 1;
  /**
   * `account.required`: every booking is a logged-in parent's. The login is
   * not offered along the way — it IS «Bekreft», for a parent not logged in.
   */
  const accountRequired = kit.config.account.required && loginOffered;
  const gated = accountRequired && state.step === 'details' && !booking.login.loggedIn;
  const loginRow =
    loginOffered && !accountRequired ? (
      <LoginRow
        booking={booking}
        actions={props.actions as NonNullable<BookingWizardProps['actions']>}
        overrides={props}
        onSignedIn={onSignedIn}
      />
    ) : null;

  return shell(
    <div className="space-y-8">
      <WizardHeader
        kit={kit}
        state={state}
        submitting={booking.submitting}
        onGo={(step) => booking.dispatch({ type: 'goToStep', step })}
      />

      {/* The machine's error, on the steps that have nowhere else to put it. */}
      {state.error !== null &&
        state.step !== 'details' &&
        state.step !== 'when' &&
        !multiSelect && (
          <p
            role="alert"
            className={
              resolved.classNames.wizard?.alert ??
              'rounded-lg border border-destructive/40 bg-destructive/10 px-5 py-3 text-sm'
            }
          >
            {wizardErrorText(labels, state.error, kit.config.party.maxServicesPerPerson)}
          </p>
        )}

      {/* What is being booked, first: above the login offer and the form. */}
      {state.step === 'details' && !gated && kit.config.screens.recap && (
        <RecapStep booking={booking} resolved={resolved} />
      )}

      {state.step === 'details' && loginRow}

      {/* The gate takes a Vipps confirm code itself, in place of the form. */}
      {loginOffered && booking.login.vippsConfirm !== null && signedIn === null && !gated && (
        <LoginSheet
          {...overridesOf(props)}
          actions={props.actions as NonNullable<BookingWizardProps['actions']>}
          presentation="sheet"
          trigger={false}
          vippsConfirm={booking.login.vippsConfirm}
          resumePath={booking.login.resumePath}
          onSignedIn={onSignedIn}
        />
      )}

      {/* One box per step, keyed by it, so a step arriving is a mount. */}
      <div
        key={state.step}
        data-booking-step={state.step}
        data-animate={stepsMoved ? '' : undefined}
        className="space-y-8"
      >
        {state.step === 'who' && (
          <WhoStep booking={booking} resolved={resolved} loginRow={loginRow} />
        )}
        {state.step === 'service' && (
          <ServiceStep booking={booking} resolved={resolved} multiSelect={multiSelect} />
        )}
        {state.step === 'when' && <WhenStep booking={booking} resolved={resolved} />}
        {state.step === 'details' &&
          (gated ? (
            <AccountGate
              booking={booking}
              resolved={resolved}
              actions={props.actions as NonNullable<BookingWizardProps['actions']>}
              overrides={props}
              onSignedIn={onSignedIn}
            />
          ) : (
            <DetailsStep booking={booking} resolved={resolved} />
          ))}
      </div>

      {!multiSelect && (
        <SummaryBar
          {...(kit.config.screens.summaryDetail
            ? booking.derived.summaryParts
            : { line: booking.derived.summary })}
          canAdvance={booking.derived.canAdvance}
          step={state.step}
          onNext={booking.next}
          hideNextWhenDisabled={kit.config.screens.hideDisabledNext}
          labels={screenLabels(labels)}
          classNames={resolved.classNames.summary}
        />
      )}
    </div>
  );
}

/** The overrides a nested booking component inherits from the wizard's props. */
function overridesOf(props: BookingOverrides): BookingOverrides {
  return {
    config: props.config,
    labels: props.labels,
    classNames: props.classNames,
    components: props.components,
  };
}

interface StepProps {
  booking: BookingController;
  resolved: ResolvedBooking;
}

function WhoStep({ booking, resolved, loginRow }: StepProps & { loginRow: ReactNode }) {
  const { kit, state, people } = booking;
  const guests = useMemo(() => guestChoices(kit), [kit]);
  return (
    <WhoScreen
      labels={screenLabels(kit.labels)}
      format={kit.format}
      people={state.people}
      family={people.family === null ? null : familyEntries(kit, people.family, people.ageDayKey)}
      guestChoices={guests}
      addedChildren={addedChildEntries(kit, state.people, people.ageDayKey)}
      maxPeople={kit.wizard.maxPeople}
      selfKey={SELF_KEY}
      isGuestSeat={kit.wizard.isGuestSeat}
      onChoose={people.choosePeople}
      onAddChild={people.addChild}
      guestParty={
        kit.config.screens.guestParty
          ? { child: kit.wizard.guestChild, adult: GUEST_ADULT_SEAT }
          : undefined
      }
      loginRow={loginRow}
      currentYear={Number(kit.clock.dayKey(booking.slots.fromTs).slice(0, 4))}
      classNames={resolved.classNames.who}
      components={
        resolved.components.PersonCard ? { PersonCard: resolved.components.PersonCard } : undefined
      }
    />
  );
}

function ServiceStep({ booking, resolved, multiSelect }: StepProps & { multiSelect: boolean }) {
  const { kit, state, people, catalogue } = booking;
  const ageOf = (person: WizardPerson) => people.personAge(person, people.ageDayKey);
  const single = state.people.length === 1 ? state.people[0] : null;
  // «Samme som sist» stays a one-tap shortcut while the person's visit is
  // nothing, or just that service (a returning child is seated with it already
  // ticked). Once they have ticked something else, a one-tap pick would REPLACE
  // their visit — and, alone, jump to the time step — so the suggestion joins
  // the visit instead, and never unticks a service already in it.
  const pickFor = (index: number, service: BookingServiceDto, oneTap: () => void) => {
    const visit = state.choices[index] ? [state.choices[index], ...state.extras[index]] : [];
    if (!multiSelect || visit.length === 0 || (visit.length === 1 && visit[0].id === service.id)) {
      oneTap();
    } else if (!visit.some((ticked) => ticked.id === service.id)) {
      booking.toggleServiceFor(index, service);
    }
  };
  return (
    <ServiceScreen
      labels={screenLabels(kit.labels)}
      format={kit.format}
      services={catalogue.services}
      {...serviceScreenBase(kit)}
      serviceFits={serviceFitsFor(kit, state.people.map(ageOf), state.people)}
      initialCategory={catalogue.deepLinkCategory}
      onPick={(service) => pickFor(0, service, () => booking.pickService(service))}
      suggestion={single ? people.suggestionFor(single) : null}
      chosenId={state.choices[0]?.id ?? null}
      childName={single ? (single.name ?? null) : null}
      party={
        state.people.length > 1
          ? {
              people: partyPeople(kit, state.people, ageOf, people.suggestionFor),
              choices: state.choices,
              onPickFor: (index, service) =>
                pickFor(index, service, () => booking.pickServiceFor(index, service)),
              onRemove: (index) =>
                booking.dispatch({
                  type: 'choosePeople',
                  people: state.people.filter((_, position) => position !== index),
                }),
            }
          : undefined
      }
      selection={
        multiSelect
          ? {
              // Index = seated person; meda reads a missing list (nobody seated) as empty.
              lists: state.choices.map((first, index) =>
                first ? [first, ...state.extras[index]] : []
              ),
              onToggle: booking.toggleServiceFor,
              onContinue: booking.continueFromService,
              total:
                state.items.length === 0
                  ? null
                  : {
                      minutes: kit.wizard.visitMinutes(state.items, state.partyMode),
                      priceOre: booking.derived.total,
                    },
              canContinue: booking.derived.canAdvance,
              notice:
                state.error === null
                  ? null
                  : labelText(
                      wizardErrorText(
                        kit.labels,
                        state.error,
                        kit.config.party.maxServicesPerPerson
                      )
                    ),
              labels: kit.labels,
            }
          : undefined
      }
      classNames={resolved.classNames.service}
      components={
        resolved.components.ServiceCard
          ? { ServiceCard: resolved.components.ServiceCard }
          : undefined
      }
    />
  );
}

function WhenStep({ booking, resolved }: StepProps) {
  const { kit, state, catalogue, slots, schedule } = booking;
  const { labels, format, wizard, config } = kit;
  const party = booking.derived.party;
  const items = state.items;
  const phone = config.contact.phone;
  return (
    <>
      <StylistScreen
        labels={screenLabels(labels)}
        format={format}
        // Not deduplicated: a named stylist has to cover every service of every
        // line — a person's extras included, as their visit is one stylist's.
        serviceIds={items.flatMap((item) => visitServicesOf(item).map((service) => service.id))}
        resources={catalogue.resources}
        loading={!catalogue.resourcesKnown}
        nextAvailableLoading={slots.nextAvailableLoading}
        selectedResourceId={state.resourceId}
        nextAvailableTs={slots.nextAvailableTs}
        pendingName={catalogue.chosenStylistName}
        notice={catalogue.stylistNotice}
        onPick={booking.pickResource}
        firstAvailableFaces={config.screens.firstAvailableFaces}
        edgeFade={config.screens.stylistEdgeFade}
        party={
          party
            ? {
                mode: state.partyMode,
                size: items.length,
                sizeWord: partySizeWord(labels, items.length),
                minutes: {
                  sequential: wizard.visitMinutes(items, 'sequential'),
                  parallel: wizard.visitMinutes(items, 'parallel'),
                },
                onMode: (mode) => booking.dispatch({ type: 'setPartyMode', mode }),
              }
            : undefined
        }
        classNames={resolved.classNames.stylist}
        components={
          resolved.components.StylistCard
            ? { StylistCard: resolved.components.StylistCard }
            : undefined
        }
      />

      {slots.ready ? (
        <TimeScreen
          labels={screenLabels(labels)}
          format={format}
          dayparts={kit.dayparts}
          monthView
          slots={slots.single}
          days={slots.days}
          openDays={schedule.openDays}
          stylistName={catalogue.chosenStylistName}
          takenSlotTs={slots.takenSlotTs}
          phone={phone}
          weekendNote={(dayTs) => weekendNoteFor(kit, party ? items : items.slice(0, 1), dayTs)}
          onPick={booking.pickSlot}
          soonest={
            config.screens.soonest
              ? {
                  resolveStylist: (resourceId) => stylistFace(catalogue.resources, resourceId),
                }
              : undefined
          }
          dayFullness={config.screens.dayFullness}
          party={
            party
              ? {
                  items,
                  mode: state.partyMode,
                  slots: slots.party,
                  chipEndTs: (slot) => wizard.visitEndTs(items, slot.startTs, 'sequential'),
                  // Only a back-to-back family is offered the simultaneous rescue.
                  alternativeFor:
                    state.partyMode === 'sequential'
                      ? (dayTs) =>
                          kit.partySlots.partyAlternative({
                            sequential: slots.party,
                            parallel: slots.alternatives,
                            dayTs,
                          })
                      : undefined,
                  resolveStylistName: catalogue.resolveStylistName,
                  onPick: booking.pickPartySlot,
                }
              : undefined
          }
          classNames={resolved.classNames.time}
          components={timeComponents(resolved)}
        />
      ) : slots.failed ? (
        <SlotsUnavailable kit={kit} onRetry={booking.refresh} />
      ) : (
        // The step's own shape, so nothing below it moves when it fills in.
        <TimeScreenSkeleton
          labels={screenLabels(labels)}
          days={slots.days.length}
          monthView
          surchargeRow={items.some((item) =>
            visitServicesOf(item).some((service) => service.weekendSurchargePct > 0)
          )}
        />
      )}

      {/* Once, outside the skeleton-or-step switch, so a re-read cannot remount it. */}
      <TakenToast labels={screenLabels(labels)} takenSlotTs={slots.takenSlotTs} />
    </>
  );
}

/**
 * The details step's recap (`config.screens.recap`): the day, hours, who and
 * total of the booking the form below submits, «edit» back to the time step,
 * and a swap to another stylist free at that minute.
 */
function RecapStep({ booking, resolved }: StepProps) {
  const { kit, state, catalogue, slots } = booking;
  const recap = useMemo(
    () => recapProps(kit, state, catalogue.resources, slots.single),
    [kit, state, catalogue.resources, slots.single]
  );
  return (
    <BookingRecap
      lines={recap.lines}
      totalOre={booking.derived.total}
      format={kit.format}
      labels={screenLabels(kit.labels)}
      onEdit={() => booking.dispatch({ type: 'goToStep', step: 'when' })}
      alternatives={recap.alternatives}
      // Alternatives exist only for a timed visit, so there is always a start to keep.
      onSwap={(resourceId) => booking.pickSlot({ startTs: state.startTs as number, resourceId })}
      classNames={resolved.classNames.recap}
    />
  );
}

function timeComponents({ components }: ResolvedBooking) {
  if (!components.DayChip && !components.TimeChip) return undefined;
  return { DayChip: components.DayChip, TimeChip: components.TimeChip };
}

function DetailsStep({ booking, resolved }: StepProps) {
  const { kit, state } = booking;
  const guardian = booking.login.guardian;
  const lines = useMemo(() => detailsLines(kit, state), [kit, state]);
  return (
    <DetailsScreen
      state={forMedaScreen(state)}
      onChange={booking.dispatch}
      onSubmit={booking.submit}
      lines={lines}
      totalOre={booking.derived.total}
      {...detailsScreenBase(kit)}
      submitting={booking.submitting}
      submissionNonce={booking.submissionNonce}
      family={guardian?.family}
      guardianPhone={guardian?.phone ?? null}
      // The address they logged in with: the booking is theirs, by that address.
      emailReadOnly={kit.config.account.required && guardian !== null}
      format={kit.format}
      labels={screenLabels(kit.labels)}
      classNames={resolved.classNames.details}
      components={
        resolved.components.FamilyChip ? { FamilyChip: resolved.components.FamilyChip } : undefined
      }
    />
  );
}

/**
 * «Bekreft» under `account.required` for a parent not logged in: «Nesten
 * ferdig», a line, and the login — Vipps, or e-mail — in place of the form.
 * The heading carries the details step's id, so the focus a step change moves
 * lands here, and the form's heading takes it over once the parent is in.
 */
function AccountGate({
  booking,
  resolved,
  actions,
  overrides,
  onSignedIn,
}: StepProps & {
  actions: NonNullable<BookingWizardProps['actions']>;
  overrides: BookingOverrides;
  onSignedIn: (guardian: Parameters<BookingController['login']['signIn']>[0]) => void;
}) {
  const { labels } = booking.kit;
  const { classNames } = resolved;
  // The details screen's own root and heading slots, after the same defaults.
  const slot = (base: string, extra: string | undefined) => [base, extra].filter(Boolean).join(' ');
  return (
    <section
      aria-labelledby={STEP_HEADINGS.details}
      className={slot('space-y-6', classNames.details?.root)}
    >
      <h2
        id={STEP_HEADINGS.details}
        tabIndex={-1}
        className={slot(
          'font-sans text-2xl font-bold outline-none md:text-3xl',
          classNames.details?.heading
        )}
      >
        {labelText(labels['wizard.account.heading'])}
      </h2>
      <LiveStatus
        text={booking.login.sessionLost ? labelText(labels['wizard.account.sessionLost']) : null}
        className="text-sm font-medium empty:hidden"
      />
      <p className="text-muted-foreground">{labelText(labels['wizard.account.intro'])}</p>
      {/* What the login is for: the hour held, in the summary bar's own words and slot. */}
      <p
        className={slot(
          'rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium',
          classNames.summary?.line
        )}
      >
        {booking.derived.summary}
      </p>
      <LoginSheet
        {...overridesOf(overrides)}
        actions={actions}
        presentation="gate"
        resumePath={booking.login.resumePath}
        vippsConfirm={booking.login.vippsConfirm}
        onSignedIn={onSignedIn}
      />
    </section>
  );
}

function ConfirmationStep({ booking, resolved, siteUrl }: StepProps & { siteUrl?: string }) {
  const { kit } = booking;
  // Read once, so «today» cannot become «tomorrow» halfway down the card.
  const [now] = useState(() => Date.now());
  const confirmation = booking.confirmed as BookingConfirmation;
  return (
    <Confirmation
      {...confirmationProps(kit, confirmation, siteUrl)}
      onStartOver={booking.startOver}
      now={now}
      format={kit.format}
      labels={screenLabels(kit.labels)}
      classNames={resolved.classNames.confirmation}
      components={
        resolved.components.PartyLine ? { PartyLine: resolved.components.PartyLine } : undefined
      }
    />
  );
}

/**
 * «Have an account? Log in» — or, once the parent is known, nothing at all
 * for one who arrived logged in, and one line saying so for one who logged in
 * from the sheet.
 */
function LoginRow({
  booking,
  actions,
  overrides,
  onSignedIn,
}: {
  booking: BookingController;
  actions: NonNullable<BookingWizardProps['actions']>;
  overrides: BookingOverrides;
  onSignedIn: (guardian: Parameters<BookingController['login']['signIn']>[0]) => void;
}) {
  const { arrivedAs, signedIn, resumePath } = booking.login;
  const { labels } = booking.kit;
  if (signedIn === null && arrivedAs !== null) return null;
  const who = signedIn === null ? null : (signedIn.guardian ?? arrivedAs);
  const name =
    who === null
      ? null
      : [who.firstName, who.lastName].filter(Boolean).join(' ').trim() || who.email;
  const confirmation =
    signedIn === null
      ? null
      : name === null
        ? labelText(labels['wizard.signedIn'])
        : fill(labels['wizard.signedInAs'], { name });
  return (
    <div>
      {signedIn === null && (
        <LoginSheet
          {...overridesOf(overrides)}
          actions={actions}
          presentation="sheet"
          resumePath={resumePath}
          onSignedIn={onSignedIn}
        />
      )}
      <LiveStatus text={confirmation} className="text-sm text-muted-foreground empty:hidden" />
    </div>
  );
}

/** The neutral shell the restore gate shows, the header's and a step's shape. */
function RestoreSkeleton({ text }: { text: string }) {
  return (
    <div data-testid="restore-skeleton">
      {/* Outside the busy subtree: assistive tech may hold back what is inside it. */}
      <LiveStatus text={text} />
      <div aria-busy="true" className="space-y-8">
        <div aria-hidden="true" className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
            <span className="flex flex-col gap-1.5">
              <span className="h-4 w-24 animate-pulse rounded bg-muted" />
              <span className="h-3 w-36 animate-pulse rounded bg-muted" />
            </span>
          </div>
          <span className="block h-1.5 w-full animate-pulse rounded-full bg-muted" />
        </div>
        <div aria-hidden="true" className="space-y-6">
          <span className="block h-8 w-56 animate-pulse rounded bg-muted md:h-9" />
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: four identical placeholders.
              <span key={index} className="block h-24 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Where the visitor is, the way back, and how much is left: a back arrow, the
 * title and «step N of 4», and one segment per step that IS the button to it —
 * tappable only where the machine's `canGoToStep` says so, and frozen while a
 * submission is in flight.
 */
function WizardHeader({
  kit,
  state,
  submitting,
  onGo,
}: {
  kit: BookingKit;
  state: WizardState;
  submitting: boolean;
  onGo: (step: WizardStep) => void;
}) {
  const { labels, wizard } = kit;
  const stepLabel = (step: WizardStep) => labelText(labels[`wizard.step.${step}`]);
  const index = STEPS.indexOf(state.step);
  const previous = index > 0 ? STEPS[index - 1] : null;
  const canGoBack = previous !== null && !submitting && wizard.canGoToStep(state, previous);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {canGoBack ? (
          <button
            type="button"
            aria-label={fill(labels['wizard.back'], { label: stepLabel(previous) })}
            onClick={() => onGo(previous)}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </button>
        ) : (
          // Held rather than dropped, so the title does not shuffle sideways.
          <span aria-hidden="true" className="size-9 shrink-0" />
        )}
        <p className="min-w-0">
          <span className="block font-sans text-sm font-bold">{labels['wizard.title']}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {fillParts(labels['wizard.progress'], {
              step: index + 1,
              total: STEPS.length,
              label: stepLabel(state.step),
            })}
          </span>
        </p>
      </div>

      <ol
        aria-label={labelText(labels['wizard.progressLabel'])}
        className="flex items-center gap-1.5"
      >
        {STEPS.map((step, position) => {
          const isCurrent = step === state.step;
          const reachable = !submitting && !isCurrent && wizard.canGoToStep(state, step);
          return (
            <li key={step} className="flex-1">
              <button
                type="button"
                disabled={!reachable}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onGo(step)}
                className={`block h-1.5 w-full rounded-full transition-colors ${
                  position <= index ? 'bg-primary' : 'bg-border'
                } ${reachable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span className="sr-only">{stepLabel(step)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The openings could not be read — this site's failure, not a full day —
 * with the telephone as the rescue and a retry as the cheaper first try.
 */
function SlotsUnavailable({ kit, onRetry }: { kit: BookingKit; onRetry: () => void }) {
  const { labels, config, format } = kit;
  const phone = config.contact.phone;
  return (
    <div className="space-y-3">
      <p role="alert" className="rounded-lg border border-border bg-card px-5 py-4 text-sm">
        {labels['wizard.slotsUnavailable.lead']}
        {phone ? (
          <a
            href={format.telHref(phone)}
            aria-label={fill(labels['wizard.slotsUnavailable.callAria'], { phone })}
            className="font-semibold text-primary underline underline-offset-4"
          >
            {fillParts(labels['wizard.slotsUnavailable.call'], { phone })}
          </a>
        ) : (
          labels['wizard.slotsUnavailable.callPlain']
        )}
        {labels['wizard.slotsUnavailable.suffix']}
      </p>
      <BookingButtonOutline onClick={onRetry}>{labels['wizard.retry']}</BookingButtonOutline>
    </div>
  );
}

function BookingButtonOutline({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <BookingButton variant="outline" onClick={onClick}>
      {children}
    </BookingButton>
  );
}
