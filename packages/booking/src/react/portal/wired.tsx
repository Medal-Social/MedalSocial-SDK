/**
 * The portal's meda screens, each wired to the app's server actions with the
 * behaviour the screens leave to their caller: reading an action's answer
 * (plain or next-safe-action's envelope), sending a dead session to the
 * login, leaving with one document load, the age cookie, «book again» links
 * and the Vipps flash. Imported only by the client dashboard.
 */

import {
  ChildCards,
  type ChildCardsVariant,
  type ChildSummary,
  DataControls,
  FamilyEditor,
  LogoutButton,
  type PersonSaveResult,
  type PersonTarget,
  type PortalActionFailure,
  type PortalFamilyMemberDto,
  type PortalPersonNouns,
  type PortalProfileDto,
  ProfileForm,
  RebookCards,
  type RebookSuggestion,
  type VippsLinkFlash,
  VippsLinkRow,
} from '@medalsocial/meda/booking';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  type ActionAnswer,
  type PersonActionResult,
  type PortalActions,
  readAction,
} from '../actions';
import type { ResolvedBooking } from '../Provider';
import { agePromptCookie } from './age-prompt';
import { bookAgainHref } from './book-again';
import { leavePortal } from './leave';
import { vippsFlashPath } from './vipps-flash';

interface Wired {
  booking: ResolvedBooking;
}

type Ok<T> = Extract<T, { ok: true }>;

/** An action's answer as a meda callback's: `ok(value)`, or the failure. */
function settleAction<T extends object, R>(
  answer: ActionAnswer<T> | undefined,
  booking: ResolvedBooking,
  unreachable: string,
  ok: (value: Ok<T>) => R
): R | PortalActionFailure {
  const read = readAction(answer, {
    unreachable,
    invalidInput: booking.kit.labels['portal.invalidInput'],
  });
  if (read.ok) return ok(read.value as Ok<T>);
  return read.failure.kind === 'session'
    ? { ok: false, kind: 'session' }
    : { ok: false, kind: 'error', message: read.failure.message };
}

/** A dead session: back to the login, as a router navigation (the source's `router.push`). */
function useToLogin(booking: ResolvedBooking): () => void {
  const router = useRouter();
  return () => router.push(booking.kit.config.paths.portalLogin);
}

/** Whether next-safe-action pinned the rejection on `phone` — the one field a visitor can get wrong. */
function rejectedPhone(answer: unknown): boolean {
  const errors = (answer as { validationErrors?: unknown }).validationErrors;
  return typeof errors === 'object' && errors !== null && 'phone' in errors;
}

export function PortalProfileForm({
  booking,
  profile,
  actions,
}: Wired & {
  profile: PortalProfileDto;
  actions: Pick<PortalActions, 'updateProfile' | 'setMarketingConsent'>;
}) {
  const { labels } = booking.kit;
  const unreachable = labels['profileForm.unreachable'];
  return (
    <ProfileForm
      labels={labels}
      profile={profile}
      classNames={booking.classNames.profileForm}
      onSessionExpired={useToLogin(booking)}
      onSave={async ({ firstName, lastName, phone }) => {
        const answer = await actions.updateProfile({
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
          phone,
        });
        const result = settleAction(answer, booking, unreachable, (value) => value);
        return result.ok || result.kind === 'session' || !rejectedPhone(answer)
          ? result
          : { ...result, field: 'phone' as const };
      }}
      onConsentChange={async (granted) => {
        const result = settleAction(
          await actions.setMarketingConsent({ granted }),
          booking,
          unreachable,
          (value) => value
        );
        // Whatever else went wrong, the box says «could not reach» (as the source did).
        return result.ok || result.kind === 'session' ? result : { ok: false, kind: 'error' };
      }}
    />
  );
}

/** Which child, in the action's wire shape. */
function wireTarget(target: PersonTarget) {
  return {
    person_id: target.personId,
    ...(target.index === undefined ? {} : { index: target.index }),
  };
}

export function PortalFamilyEditor({
  booking,
  family,
  nouns,
  personDetails,
  stylists,
  dismissed,
  cookieName,
  currentYear,
  now,
  actions,
}: Wired & {
  family: PortalFamilyMemberDto[];
  nouns?: PortalPersonNouns;
  personDetails: boolean;
  stylists: ReadonlyArray<{ id: string; name: string }>;
  /** The person ids the age card has already been answered for (the cookie). Absent: no card. */
  dismissed?: readonly string[];
  cookieName: string;
  currentYear?: number;
  now?: number;
  actions: Pick<PortalActions, 'savePerson' | 'removePerson'>;
}) {
  const { kit } = booking;
  const settled = (answer: ActionAnswer<PersonActionResult>): PersonSaveResult =>
    settleAction(answer, booking, kit.labels['familyEditor.unreachable'], (value) => ({
      ok: true,
      family: value.profile.family,
      personId: value.personId,
      fallback: value.fallback,
    }));
  return (
    <FamilyEditor
      labels={kit.labels}
      format={kit.format}
      family={family}
      nouns={nouns}
      personDetails={personDetails}
      stylists={stylists}
      currentYear={currentYear}
      now={now}
      agePrompt={dismissed && { dismissed }}
      classNames={booking.classNames.familyEditor}
      components={booking.components}
      onSessionExpired={useToLogin(booking)}
      onAgeAnswered={(ids) => {
        // biome-ignore lint/suspicious/noDocumentCookie: a one-line, script-readable preference cookie; see `age-prompt.ts`.
        document.cookie = agePromptCookie(cookieName, kit.config.paths.portal ?? '/', ids);
      }}
      onSavePerson={async ({ create, target, person }) =>
        settled(
          await actions.savePerson({
            create,
            ...wireTarget(target),
            person: {
              name: person.name,
              birth_year: person.birthYear,
              ...(person.birthMonth === undefined ? {} : { birth_month: person.birthMonth }),
              ...(person.notes === undefined ? {} : { notes: person.notes }),
              ...(person.preferredResourceId === undefined
                ? {}
                : { preferred_resource_id: person.preferredResourceId }),
            },
          })
        )
      }
      onRemovePerson={async (target) => settled(await actions.removePerson(wireTarget(target)))}
    />
  );
}

export function PortalDataControls({
  booking,
  actions,
  deletedHref,
}: Wired & {
  actions: Pick<PortalActions, 'exportData' | 'deleteMe'>;
  /** Where a deleted visitor lands (one document load, replacing this entry). */
  deletedHref: string;
}) {
  const unreachable = booking.kit.labels['dataControls.unreachable'];
  return (
    <DataControls
      labels={booking.kit.labels}
      classNames={booking.classNames.dataControls}
      onSessionExpired={useToLogin(booking)}
      onExport={async () =>
        settleAction(await actions.exportData(), booking, unreachable, (v) => v)
      }
      onDelete={async (confirm) =>
        settleAction(await actions.deleteMe({ confirm }), booking, unreachable, (value) => {
          leavePortal(deletedHref, { replace: true });
          return value;
        })
      }
    />
  );
}

export function PortalLogoutButton({
  booking,
  actions,
  logoutHref,
}: Wired & {
  actions: Pick<PortalActions, 'logout'>;
  /** Where a logged-out visitor lands (one document load). */
  logoutHref: string;
}) {
  const { labels } = booking.kit;
  return (
    <LogoutButton
      labels={labels}
      classNames={booking.classNames.logout}
      onLogout={async () => {
        // Only an `ok` leaves: navigating away on a failure would SAY logged
        // out while the session may still be live.
        if (!readAction(await actions.logout(), { unreachable: '', invalidInput: '' }).ok) {
          return { ok: false, message: labels['logout.unreachable'] };
        }
        leavePortal(logoutHref);
        return { ok: true };
      }}
    />
  );
}

export function PortalVippsLinkRow({
  booking,
  linked,
  flash,
  startVippsLink,
  onToast,
}: Wired & {
  linked: boolean;
  flash: VippsLinkFlash | null;
  startVippsLink: NonNullable<PortalActions['startVippsLink']>;
  /** Shows the «linked» toast; without it the row says so inline. */
  onToast?: (message: string) => void;
}) {
  const { kit } = booking;
  return (
    <VippsLinkRow
      labels={kit.labels}
      linked={linked}
      flash={flash}
      announceSuccess={!onToast}
      classNames={booking.classNames.vippsLink}
      onStart={startVippsLink}
      onSessionExpired={useToLogin(booking)}
      onFlash={(spent) => {
        if (spent === 'linked') onToast?.(kit.labels['vippsLink.success']);
        // Spend the flash. Best effort: it lapses on its own regardless.
        void fetch(vippsFlashPath(kit.config), { method: 'DELETE', keepalive: true }).catch(
          () => undefined
        );
      }}
    />
  );
}

export function PortalChildCards({
  booking,
  kids,
  bookingHref,
  variant,
  empty,
  stylistNames,
}: Wired & {
  kids: ChildSummary[];
  bookingHref?: string;
  variant?: ChildCardsVariant;
  empty?: ReactNode;
  stylistNames?: Readonly<Record<string, string>>;
}) {
  const { kit } = booking;
  return (
    <ChildCards
      kids={kids}
      variant={variant}
      empty={empty}
      stylistNames={stylistNames}
      labels={kit.labels}
      format={kit.format}
      classNames={booking.classNames.childCards}
      components={booking.components}
      // The last visit, with the child's usual stylist where they have one.
      hrefFor={(child) =>
        bookAgainHref(kit.config, bookingHref ?? kit.config.paths.booking, {
          serviceId: child.serviceId,
          resourceId: child.preferredResourceId ?? child.resourceId,
        })
      }
      // The name goes through the tab's session store, never the URL.
      onBook={(child) => kit.rebook.stashRebookWho(child.name)}
    />
  );
}

export function PortalRebookCards({
  booking,
  suggestions,
  bookingHref,
}: Wired & { suggestions: RebookSuggestion[]; bookingHref?: string }) {
  const { kit } = booking;
  return (
    <RebookCards
      suggestions={suggestions}
      labels={kit.labels}
      classNames={booking.classNames.rebook}
      components={booking.components}
      hrefFor={(suggestion) =>
        bookAgainHref(kit.config, bookingHref ?? kit.config.paths.booking, suggestion)
      }
      // Every tap REPLACES the stash — `null` clears it.
      onRebook={(suggestion) => kit.rebook.stashRebookWho(suggestion.bookedForName)}
    />
  );
}
