import {
  AccountCard,
  bookingButtonClass,
  PortalUnreachable,
  UpcomingBookings,
  type VippsLinkFlash,
  VisitHistory,
} from '@medalsocial/meda/booking';
import { type ReactNode, useState } from 'react';
import { fillParts } from '../../core/labels';
import type { PortalBookingDto, PortalProfileDto } from '../../core/portal/dto';
import { rebookSuggestions } from '../../core/portal/dto';
import type { PortalActions } from '../actions';
import { type BookingOverrides, useBookingKit } from '../Provider';
import { agePromptCookieName } from './age-prompt';
import { createChildSummaries } from './child-summary';
import { SessionTouch } from './SessionTouch';
import { PortalSections, type PortalTabIcons } from './sections';
import type { PortalTab } from './tabs';
import {
  PortalChildCards,
  PortalDataControls,
  PortalFamilyEditor,
  PortalLogoutButton,
  PortalProfileForm,
  PortalRebookCards,
  PortalVippsLinkRow,
} from './wired';

/** Where the visitor goes after logging out / deleting themselves. */
interface Exits {
  /** Default `/`. */
  logoutHref?: string;
  /** Default `paths.portalLogin`. */
  deletedHref?: string;
}

export interface PortalDashboardProps extends BookingOverrides, Exits {
  profile: PortalProfileDto;
  bookings: { upcoming: PortalBookingDto[]; past: PortalBookingDto[] };
  /** The «usual stylist» choices, display names, in the order to offer them. */
  stylists?: ReadonlyArray<{ id: string; name: string }>;
  /** The business's number for «call us», or `null`. */
  phone: string | null;
  /** The app's `'use server'` wrappers (Decision 8). */
  actions: PortalActions;
  /** The section to open on (`parsePortalTab` on the query). A Vipps flash opens Profile. */
  tab?: PortalTab;
  /** The person ids the age prompt was already answered for (`parseAgePromptDismissed`). */
  agePromptDismissed?: readonly string[];
  /** The age prompt's cookie. Default `<portal.cookieName>_age_ok`, path `paths.portal`. */
  agePromptCookie?: string;
  /** How a «link Vipps» attempt that just returned ended (`vippsLinkFlash`), or `null`. */
  vippsFlash?: VippsLinkFlash | null;
  /** Shows the «Vipps linked» toast (e.g. sonner's `toast.success`); without it the row says so inline. */
  onToast?: (message: string) => void;
  /** Where «book» goes. Default `handoffUrl ?? paths.booking`; the ids ride along only to `paths.booking`. */
  bookingHref?: string;
  /** The render's clock (ages, «next appointment»). Default `Date.now()` at mount; pass the server's. */
  now?: number;
  /** Replaces the default header (eyebrow, greeting, «book» button). */
  header?: ReactNode;
  /** The query parameter the open section rides in (default `fane`) and each section's value. */
  tabParam?: string;
  tabSlugs?: Readonly<Record<PortalTab, string>>;
  icons?: PortalTabIcons;
}

/** A section heading as the dashboard draws it. */
function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-sans text-xl font-bold md:text-2xl">
      {children}
    </h2>
  );
}

/**
 * The customer portal: a rail on a desktop, a tab bar on a phone, and four
 * sections — overview (next appointments, the family, «book again»), family
 * (cards and the editor), history and profile (details, Vipps, data). Every
 * section is mounted all the time, so a half-edited form survives a tab tap.
 *
 * The server page reads the profile, the bookings, the stylists, the phone,
 * the age cookie and the Vipps flash, and hands them in; this renders and
 * wires each form to its action. It renders no page wrapper.
 */
export function PortalDashboard(props: PortalDashboardProps) {
  const booking = useBookingKit(props);
  const { kit } = booking;
  const { labels, config } = kit;
  const { profile, bookings, actions, phone, stylists = [] } = props;
  const [now] = useState(() => props.now ?? Date.now());
  const bookingHref = props.bookingHref ?? config.handoffUrl ?? config.paths.booking;
  const kids = createChildSummaries(kit.clock)(
    profile.family,
    bookings.past,
    now,
    bookings.upcoming
  );
  const stylistNames = Object.fromEntries(stylists.map((stylist) => [stylist.id, stylist.name]));
  const vippsFlash = props.vippsFlash ?? null;
  const familyHeading = labels['portal.family.heading'];

  return (
    <>
      <SessionTouch config={config} />
      <PortalSections
        booking={booking}
        // A link attempt that just returned opens on Profile, where its message is.
        initialTab={vippsFlash !== null ? 'profile' : props.tab}
        tabParam={props.tabParam}
        tabSlugs={props.tabSlugs}
        icons={props.icons}
        header={
          props.header ?? (
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-bold tracking-widest text-muted-foreground">
                  {labels['portal.eyebrow']}
                </p>
                <h1 className="font-sans text-3xl font-bold md:text-5xl">
                  {fillParts(labels['portal.greeting'], {
                    name: profile.firstName ?? labels['portal.greetingFallback'],
                  })}
                </h1>
              </div>
              <a href={bookingHref} className={bookingButtonClass({ size: 'lg' })}>
                {labels['portal.book']}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-4"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
            </header>
          )
        }
        account={
          <AccountCard profile={profile} compact classNames={booking.classNames.accountCard} />
        }
        logout={
          <PortalLogoutButton
            booking={booking}
            actions={actions}
            logoutHref={props.logoutHref ?? '/'}
          />
        }
        overview={
          <>
            <UpcomingBookings
              bookings={bookings.upcoming}
              phone={phone}
              bookingHref={bookingHref}
              now={now}
              labels={labels}
              format={kit.format}
              classNames={booking.classNames.upcoming}
              components={booking.components}
            />
            {/* Always drawn — with a sentence when there is nobody yet — so the
                overview keeps its shape for a new visitor. */}
            <section aria-labelledby="portal-children-summary" className="space-y-4">
              <Heading id="portal-children-summary">{familyHeading}</Heading>
              <PortalChildCards
                booking={booking}
                kids={kids}
                variant="compact"
                bookingHref={bookingHref}
              />
            </section>
            <PortalRebookCards
              booking={booking}
              suggestions={rebookSuggestions(bookings.past)}
              bookingHref={bookingHref}
            />
          </>
        }
        family={
          <>
            <section aria-labelledby="portal-children-heading" className="space-y-4">
              <Heading id="portal-children-heading">{familyHeading}</Heading>
              <p className="text-muted-foreground">{labels['portal.family.lead']}</p>
              {/* No empty sentence: the editor right below says so, and is where one is added. */}
              <PortalChildCards
                booking={booking}
                kids={kids}
                bookingHref={bookingHref}
                empty={null}
                stylistNames={stylistNames}
              />
            </section>
            <PortalFamilyEditor
              booking={booking}
              family={profile.family}
              nouns={profile.labels}
              personDetails={profile.personDetails}
              stylists={stylists}
              dismissed={props.agePromptDismissed ?? []}
              cookieName={props.agePromptCookie ?? agePromptCookieName(config)}
              now={now}
              actions={actions}
            />
          </>
        }
        history={
          <VisitHistory
            past={bookings.past}
            labels={labels}
            format={kit.format}
            classNames={booking.classNames.history}
            components={booking.components}
          />
        }
        profile={
          <>
            <AccountCard profile={profile} classNames={booking.classNames.accountCard} />
            <PortalProfileForm booking={booking} profile={profile} actions={actions} />
            {/* Only where the backend says whether Vipps is linked, and the app can start a link. */}
            {profile.vippsLinked !== undefined && actions.startVippsLink && (
              <PortalVippsLinkRow
                booking={booking}
                linked={profile.vippsLinked}
                flash={vippsFlash}
                startVippsLink={actions.startVippsLink}
                onToast={props.onToast}
              />
            )}
            <PortalDataControls
              booking={booking}
              actions={actions}
              deletedHref={props.deletedHref ?? config.paths.portalLogin}
            />
          </>
        }
      />
    </>
  );
}

export interface PortalDashboardUnreachableProps
  extends BookingOverrides,
    Pick<Exits, 'logoutHref'> {
  phone: string | null;
  actions: Pick<PortalActions, 'logout'>;
}

/**
 * What the portal shows when the backend did not answer: «try again» (this
 * page) and the phone — and a logout, because this is the one screen a
 * visitor could otherwise be held on.
 */
export function PortalDashboardUnreachable(props: PortalDashboardUnreachableProps) {
  const booking = useBookingKit(props);
  const { kit } = booking;
  return (
    <PortalUnreachable
      labels={kit.labels}
      format={kit.format}
      phone={props.phone}
      retryHref={kit.config.paths.portal ?? '/'}
      classNames={booking.classNames.portalUnreachable}
      logout={
        <PortalLogoutButton
          booking={booking}
          actions={props.actions}
          logoutHref={props.logoutHref ?? '/'}
        />
      }
    />
  );
}
