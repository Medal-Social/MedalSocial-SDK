import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The page's wiring, which `min-side/(dashboard)/page.tsx` did on the server
 * and the package's dashboard now does: the sections in the page's order, the
 * header, where «book» goes, the tab a Vipps return opens on, the age cookie
 * and the two exits.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../../src/react/portal/leave', () => ({ leavePortal: vi.fn() }));

import type { BookingConfig } from '../../../src/core/config';
import { type BookingLabel, labelText } from '../../../src/core/labels';
import type {
  PortalBookingDto,
  PortalFamilyMemberDto,
  PortalProfileDto,
} from '../../../src/core/portal/dto';
import { createRebookStore } from '../../../src/core/rebook-store';
import type { PortalActions } from '../../../src/react/actions';
import { BOOKING_LABELS } from '../../../src/react/labels';
import {
  agePromptCookie,
  bookAgainHref,
  PortalDashboard,
  type PortalDashboardProps,
  PortalDashboardUnreachable,
  parseAgePromptDismissed,
  parsePortalTab,
  vippsLinkFlash,
} from '../../../src/react/PortalDashboard';
import { leavePortal } from '../../../src/react/portal/leave';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';
import { textNodesOf } from '../../support/text-nodes';

const NOW = Date.parse('2026-10-05T15:00:00+02:00');

const JONAS: PortalFamilyMemberDto = {
  personId: 'p-jonas',
  name: 'Jonas',
  birthYear: 2018,
  birthMonth: null,
  notes: null,
  preferredResourceId: null,
};

const PROFILE: PortalProfileDto = {
  contactId: 'ct-1',
  email: 'kari@example.test',
  firstName: 'Kari',
  lastName: 'Nordmann',
  phone: '40000000',
  family: [JONAS],
  personDetails: true,
  marketingConsent: false,
  vippsLinked: false,
};

function booking(overrides: Partial<PortalBookingDto> = {}): PortalBookingDto {
  return {
    bookingId: 'bk-1',
    status: 'completed',
    startTs: Date.parse('2026-08-12T10:00:00+02:00'),
    endTs: Date.parse('2026-08-12T10:30:00+02:00'),
    serviceId: 'svc-1',
    serviceName: 'Barneklipp',
    resourceId: 'res-bjarne',
    resourceName: 'Bjarne',
    bookedForName: 'Jonas',
    bookedForPersonId: 'p-jonas',
    bookedForBirthYear: null,
    bookedForBirthMonth: null,
    amountOre: 49_000,
    notes: null,
    managePath: null,
    ...overrides,
  };
}

function actions(): PortalActions {
  return {
    startLogin: vi.fn(),
    startVippsLink: vi.fn(async () => null),
    updateProfile: vi.fn(),
    setMarketingConsent: vi.fn(),
    savePerson: vi.fn(),
    removePerson: vi.fn(),
    logout: vi.fn(async () => ({ ok: true as const })),
    exportData: vi.fn(),
    deleteMe: vi.fn(async () => ({ data: { ok: true as const } })),
  };
}

function dashboard(
  props: Partial<PortalDashboardProps> = {},
  config: BookingConfig = PARITY_CONFIG
) {
  const wired = props.actions ?? actions();
  render(
    <PortalDashboard
      config={config}
      labels={TEST_LABELS}
      profile={PROFILE}
      bookings={{ upcoming: [], past: [booking()] }}
      stylists={[{ id: 'res-bjarne', name: 'Bjarne' }]}
      phone="22 33 44 55"
      now={NOW}
      {...props}
      actions={wired}
    />
  );
  return wired;
}

/** The shell's section of that name (a section may hold a region named the same). */
function section(name: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
  if (node === null) throw new Error(`no section ${name}`);
  return node;
}

function open(tab: string) {
  fireEvent.click(screen.getAllByRole('button', { name: tab })[0]);
}

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/min-side');
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PortalDashboard', () => {
  it('greets the visitor and books from the header', () => {
    dashboard();

    const greeting = screen.getByRole('heading', { level: 1, name: 'Hei Kari!' });
    // One text node per literal run and per hole, as a JSX sentence renders.
    expect(textNodesOf(greeting)).toEqual(['Hei ', 'Kari', '!']);
  });

  it('greets in one text node when the site writes the greeting as a string', () => {
    dashboard({ labels: { ...TEST_LABELS, 'portal.greeting': 'Hei {name}!' } });
    const greeting = screen.getByRole('heading', { level: 1, name: 'Hei Kari!' });
    expect(textNodesOf(greeting)).toEqual(['Hei Kari!']);
    expect(screen.getByText('MIN SIDE')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bestill ny time' })).toHaveAttribute(
      'href',
      '/bestill'
    );
  });

  it('greets a visitor with no first name generically', () => {
    dashboard({ profile: { ...PROFILE, firstName: null } });

    expect(screen.getByRole('heading', { level: 1, name: 'Hei der!' })).toBeInTheDocument();
  });

  it('reads its clock at mount when the page passes none', () => {
    dashboard({ now: undefined, profile: { ...PROFILE, family: [{ ...JONAS, birthYear: 9999 }] } });

    // A birth year after today has no age: the card says the lowest one.
    expect(within(section('Oversikt')).getByText(/^0 år/)).toBeInTheDocument();
  });

  it('takes a header of its own', () => {
    dashboard({ header: <h1>Velkommen</h1> });

    expect(screen.getByRole('heading', { level: 1, name: 'Velkommen' })).toBeInTheDocument();
    expect(screen.queryByText('MIN SIDE')).not.toBeInTheDocument();
  });

  it('draws the overview in the page’s order: upcoming, the children, book again', () => {
    dashboard();

    const overview = section('Oversikt');
    const headings = within(overview)
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Kommende timer', 'Mine barn', 'Bestill igjen']);
    // The child's card books the last visit, with the stylist they had.
    expect(within(overview).getByRole('link', { name: /Bestill for Jonas/ })).toHaveAttribute(
      'href',
      '/bestill?service=svc-1&stylist=res-bjarne'
    );
  });

  it('stashes the child’s name on «book», never in the URL', () => {
    dashboard();

    fireEvent.click(within(section('Oversikt')).getByRole('link', { name: /Bestill for Jonas/ }));

    expect(createRebookStore(PARITY_CONFIG.storageNamespace).takeRebookWho()).toBe('Jonas');
  });

  it('draws the family tab: the cards with the usual stylist, then the editor', () => {
    dashboard({
      profile: { ...PROFILE, family: [{ ...JONAS, preferredResourceId: 'res-bjarne' }] },
    });
    open('Mine barn');

    const family = section('Mine barn');
    expect(
      within(family).getByText(
        'Vi husker hva som fungerer for hvert barn, så du slipper å forklare på nytt hver gang.'
      )
    ).toBeInTheDocument();
    // The card names the usual stylist (and the editor offers them).
    expect(
      within(family)
        .getAllByText('Bjarne')
        .map((node) => node.tagName)
    ).toEqual(['DD', 'OPTION']);
    expect(within(family).getByRole('form', { name: 'Jonas' })).toBeInTheDocument();
    expect(within(family).getByRole('heading', { name: 'Familie' })).toBeInTheDocument();
  });

  it('writes the age prompt’s answer into the default cookie, scoped to the portal', () => {
    window.history.replaceState(null, '', '/min-side?fane=barn');
    dashboard({ tab: 'family' });

    fireEvent.click(screen.getByRole('button', { name: 'Ikke nå' }));

    expect(document.cookie).toContain('demo_portal_age_ok=p-jonas');
    // biome-ignore lint/suspicious/noDocumentCookie: the test resets what the component wrote.
    document.cookie = 'demo_portal_age_ok=; Path=/min-side; Max-Age=0';
  });

  it('does not ask again for a child already answered for', () => {
    dashboard({ tab: 'family', agePromptDismissed: ['p-jonas'] });

    expect(screen.queryByRole('region', { name: /Bekreft alderen/ })).not.toBeInTheDocument();
  });

  it('opens on the tab the page read, and writes its own parameter and values', () => {
    dashboard({
      tab: 'history',
      tabParam: 'tab',
      tabSlugs: { overview: 'home', family: 'kids', history: 'visits', profile: 'me' },
    });

    expect(section('Historikk')).not.toHaveAttribute('hidden');
    open('Profil');
    expect(window.location.search).toBe('?tab=me');
  });

  it('draws the tab icons it is given', () => {
    const Icon = ({ className }: { className?: string }) => (
      <svg data-testid="icon" className={className} />
    );
    dashboard({ icons: { overview: { icon: Icon, shortIcon: Icon }, profile: { icon: Icon } } });

    expect(screen.getAllByTestId('icon')).toHaveLength(4);
  });

  it('hands every «book» to the booking partner, without the ids, when booking is handed off', () => {
    dashboard({}, { ...PARITY_CONFIG, handoffUrl: 'https://booking.example.test/demo' });

    expect(screen.getByRole('link', { name: 'Bestill ny time' })).toHaveAttribute(
      'href',
      'https://booking.example.test/demo'
    );
    expect(screen.getByRole('link', { name: /Bestill for Jonas/ })).toHaveAttribute(
      'href',
      'https://booking.example.test/demo'
    );
  });

  it('takes a booking href of its own', () => {
    dashboard({ bookingHref: '/bestill/barn' });

    expect(screen.getByRole('link', { name: 'Bestill ny time' })).toHaveAttribute(
      'href',
      '/bestill/barn'
    );
  });

  describe('profile', () => {
    it('opens on Profile for a Vipps return, toasts «linked» and spends the flash', async () => {
      const onToast = vi.fn();
      dashboard({ vippsFlash: 'linked', onToast });

      expect(section('Profil')).not.toHaveAttribute('hidden');
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Vipps er koblet til'));
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/portal/vipps/flash',
        expect.objectContaining({ method: 'DELETE', keepalive: true })
      );
    });

    it('says «linked» inline without a toast, and survives a flash that cannot be spent', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      dashboard({ vippsFlash: 'linked' });

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(within(section('Profil')).getByText('Vipps er koblet til')).toBeInTheDocument();
    });

    it('draws no Vipps row where the backend says nothing, or the app cannot start a link', () => {
      const { startVippsLink: _dropped, ...rest } = actions();
      dashboard({ actions: rest as PortalActions });
      open('Profil');
      expect(screen.queryByRole('button', { name: 'Koble til Vipps' })).not.toBeInTheDocument();
    });

    it('draws no Vipps row against a backend that does not say', () => {
      dashboard({ profile: { ...PROFILE, vippsLinked: undefined } });
      open('Profil');
      expect(screen.queryByRole('region', { name: 'Vipps' })).not.toBeInTheDocument();
    });

    it('sends a deleted visitor to the login by default, replacing the page', async () => {
      const wired = dashboard();
      open('Profil');

      fireEvent.click(screen.getByRole('button', { name: 'Slett meg' }));
      fireEvent.change(screen.getByLabelText(/Skriv SLETT/), { target: { value: 'SLETT' } });
      fireEvent.click(screen.getByRole('button', { name: 'Slett meg for alltid' }));

      await waitFor(() => expect(wired.deleteMe).toHaveBeenCalledWith({ confirm: 'SLETT' }));
      await waitFor(() =>
        expect(leavePortal).toHaveBeenCalledWith('/min-side/logg-inn', { replace: true })
      );
    });

    it('leaves for the front page on logout by default, or where it is told', async () => {
      dashboard({ logoutHref: '/hjem' });

      fireEvent.click(screen.getAllByRole('button', { name: 'Logg ut' })[0]);

      await waitFor(() => expect(leavePortal).toHaveBeenCalledWith('/hjem'));
    });
  });
});

describe('PortalDashboardUnreachable', () => {
  it('offers «try again» on the portal, the phone and a logout that works', async () => {
    const logout = vi.fn(async () => ({ ok: true as const }));
    render(
      <PortalDashboardUnreachable
        config={PARITY_CONFIG}
        labels={TEST_LABELS}
        phone="22 33 44 55"
        actions={{ logout }}
      />
    );

    expect(screen.getByRole('link', { name: 'Prøv igjen' })).toHaveAttribute('href', '/min-side');
    expect(screen.getByRole('link', { name: 'Ring oss på 22 33 44 55' })).toHaveAttribute(
      'href',
      'tel:22334455'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Logg ut' }));
    await waitFor(() => expect(leavePortal).toHaveBeenCalledWith('/'));
  });

  it('retries on the site root for a config without a portal path', () => {
    render(
      <PortalDashboardUnreachable
        config={{ ...PARITY_CONFIG, paths: { ...PARITY_CONFIG.paths, portal: null } }}
        labels={TEST_LABELS}
        phone={null}
        actions={{ logout: vi.fn() }}
        logoutHref="/hjem"
      />
    );

    expect(screen.getByRole('link', { name: 'Prøv igjen' })).toHaveAttribute('href', '/');
  });
});

describe('the server page’s helpers', () => {
  it('reads the tab off the query: exact values only, anything else is the overview', () => {
    expect(parsePortalTab('barn')).toBe('family');
    expect(parsePortalTab('profil')).toBe('profile');
    expect(parsePortalTab('Barn')).toBe('overview');
    expect(parsePortalTab(['barn'])).toBe('overview');
    expect(parsePortalTab(undefined)).toBe('overview');
    expect(
      parsePortalTab('me', { overview: 'home', family: 'kids', history: 'visits', profile: 'me' })
    ).toBe('profile');
  });

  it('reads the age cookie: ids only, at most twenty', () => {
    expect(parseAgePromptDismissed(undefined)).toEqual([]);
    expect(parseAgePromptDismissed('')).toEqual([]);
    expect(parseAgePromptDismissed('p-1,<script>,p_2')).toEqual(['p-1', 'p_2']);
    const many = Array.from({ length: 25 }, (_, index) => `p-${index}`);
    expect(parseAgePromptDismissed(many.join(','))).toHaveLength(20);
  });

  it('writes the age cookie: deduplicated, the newest kept past the cap', () => {
    const many = Array.from({ length: 25 }, (_, index) => `p-${index}`);
    const cookie = agePromptCookie('demo_age', '/min-side', ['p-0', 'bad id', 'p-0', ...many]);
    expect(cookie).toMatch(
      /^demo_age=p-5,p-6,.*,p-24; Path=\/min-side; Max-Age=31536000; SameSite=Lax; Secure$/
    );
  });

  it('writes the age cookie on the site root for a config without a portal path', () => {
    window.history.replaceState(null, '', '/');
    dashboard(
      { tab: 'family' },
      { ...PARITY_CONFIG, paths: { ...PARITY_CONFIG.paths, portal: null } }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ikke nå' }));

    expect(document.cookie).toContain('demo_portal_age_ok=p-jonas');
    // biome-ignore lint/suspicious/noDocumentCookie: the test resets what the component wrote.
    document.cookie = 'demo_portal_age_ok=; Path=/; Max-Age=0';
  });

  it('reads the Vipps flash: the three outcomes, nothing else', () => {
    expect(vippsLinkFlash('linked')).toBe('linked');
    expect(vippsLinkFlash('link_conflict')).toBe('link_conflict');
    expect(vippsLinkFlash('link_failed')).toBe('link_failed');
    expect(vippsLinkFlash('granted')).toBeNull();
    expect(vippsLinkFlash(undefined)).toBeNull();
  });

  it('builds «book again» only for the site’s own wizard, and only with a service', () => {
    expect(bookAgainHref(PARITY_CONFIG, '/bestill', { serviceId: 'a b', resourceId: 'r&1' })).toBe(
      '/bestill?service=a%20b&stylist=r%261'
    );
    expect(bookAgainHref(PARITY_CONFIG, '/bestill', { resourceId: 'r-1' })).toBe('/bestill');
    expect(bookAgainHref(PARITY_CONFIG, '/bestill')).toBe('/bestill');
    expect(bookAgainHref(PARITY_CONFIG, 'https://example.test', { serviceId: 's' })).toBe(
      'https://example.test'
    );
  });

  it('ships the dashboard’s own words in both packs, with the same placeholders', () => {
    for (const key of Object.keys(BOOKING_LABELS.nb).filter((k) => k.startsWith('portal.'))) {
      const holes = (label: BookingLabel) => labelText(label).match(/\{\w+\}/g) ?? [];
      expect(holes(BOOKING_LABELS.en[key as 'portal.greeting']), key).toEqual(
        holes(BOOKING_LABELS.nb[key as 'portal.greeting'])
      );
    }
  });
});
