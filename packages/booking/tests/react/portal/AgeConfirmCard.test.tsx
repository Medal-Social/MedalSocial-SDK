import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import type { PortalFamilyMemberDto, PortalProfileDto } from '../../../src/core/portal/dto';
import type { PortalActions } from '../../../src/react/actions';
import { agePromptCookieName } from '../../../src/react/portal/age-prompt';
import { PortalFamilyEditor } from '../../../src/react/portal/wired';
import { PARITY_CONFIG } from '../../support/parity-config';
import { Kit } from './harness';

const savePersonAction = vi.fn<PortalActions['savePerson']>();
const removePersonAction = vi.fn<PortalActions['removePerson']>();
const AGE_PROMPT_COOKIE = agePromptCookieName(PARITY_CONFIG);

function FamilyEditor({
  family,
  currentYear,
  personDetails = false,
  stylists = [],
  agePrompt,
}: {
  family: PortalFamilyMemberDto[];
  currentYear?: number;
  personDetails?: boolean;
  stylists?: ReadonlyArray<{ id: string; name: string }>;
  agePrompt?: { dismissed: readonly string[] };
}) {
  return (
    <Kit>
      {(booking) => (
        <PortalFamilyEditor
          booking={booking}
          family={family}
          currentYear={currentYear}
          personDetails={personDetails}
          stylists={stylists}
          dismissed={agePrompt?.dismissed}
          cookieName={AGE_PROMPT_COOKIE}
          actions={{ savePerson: savePersonAction, removePerson: removePersonAction }}
        />
      )}
    </Kit>
  );
}

/**
 * «Bekreft alderen til …» — the barnehage follow-up in «Mine barn». A child
 * whose month Medal does not know (every barnehage registration: the flow
 * files a year from an age band and never asks for a month) gets one small
 * card; confirming saves through the same person action as the editor, and
 * both confirming and «Ikke nå» are remembered in the age-prompt cookie.
 */

const YEAR = 2026;

function member(overrides: Partial<PortalFamilyMemberDto> = {}): PortalFamilyMemberDto {
  return {
    personId: 'p-emma',
    name: 'Emma',
    birthYear: 2022,
    birthMonth: null,
    notes: 'Liker film',
    preferredResourceId: 'res-bjarne',
    ...overrides,
  };
}

function profile(family: PortalFamilyMemberDto[]): PortalProfileDto {
  return {
    contactId: 'ct-1',
    email: 'kari@example.com',
    firstName: 'Kari',
    lastName: null,
    phone: null,
    family,
    personDetails: true,
    marketingConsent: false,
  };
}

function ok(family: PortalFamilyMemberDto[]) {
  return {
    data: { ok: true as const, profile: profile(family), personId: 'p-emma', fallback: false },
  };
}

function card() {
  return screen.queryByRole('region', { name: /Bekreft alderen til/ });
}

function clearCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: the test resets what the component writes.
  document.cookie = `${AGE_PROMPT_COOKIE}=; Path=/min-side; Max-Age=0`;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The cookie is scoped to `/min-side`; `document.cookie` only shows it there.
  window.history.pushState(null, '', '/min-side?fane=barn');
  clearCookie();
});

afterEach(clearCookie);

describe('«Bekreft alderen» in Mine barn', () => {
  it('asks about the first child with no birth month, year prefilled', () => {
    render(
      <FamilyEditor
        family={[member({ personId: 'p-jonas', name: 'Jonas', birthMonth: 5 }), member()]}
        currentYear={YEAR}
        personDetails
        agePrompt={{ dismissed: [] }}
      />
    );

    const region = card();
    expect(region).not.toBeNull();
    expect(
      within(region as HTMLElement).getByRole('heading', { name: 'Bekreft alderen til Emma' })
    ).toBeInTheDocument();
    expect(
      within(region as HTMLElement).getByText('Legg til fødselsmåned for riktig alder.')
    ).toBeInTheDocument();
    expect(within(region as HTMLElement).getByLabelText('Fødselsår')).toHaveValue('2022');
    expect(within(region as HTMLElement).getByLabelText('Fødselsmåned (valgfritt)')).toHaveValue(
      ''
    );
  });

  it('is not drawn without the prop, for a dismissed child, or where Medal keeps no month', () => {
    const { unmount } = render(
      <FamilyEditor family={[member()]} currentYear={YEAR} personDetails />
    );
    expect(card()).toBeNull();
    unmount();

    const second = render(
      <FamilyEditor
        family={[member()]}
        currentYear={YEAR}
        personDetails
        agePrompt={{ dismissed: ['p-emma'] }}
      />
    );
    expect(card()).toBeNull();
    second.unmount();

    render(
      <FamilyEditor
        family={[member()]}
        currentYear={YEAR}
        personDetails={false}
        agePrompt={{ dismissed: [] }}
      />
    );
    expect(card()).toBeNull();
  });

  it('saves the year and month for that child only, leaving notes and stylist alone', async () => {
    vi.mocked(savePersonAction).mockResolvedValue(ok([member({ birthYear: 2021, birthMonth: 9 })]));
    render(
      <FamilyEditor
        family={[member()]}
        currentYear={YEAR}
        personDetails
        agePrompt={{ dismissed: [] }}
      />
    );

    const region = card() as HTMLElement;
    fireEvent.change(within(region).getByLabelText('Fødselsår'), { target: { value: '2021' } });
    fireEvent.change(within(region).getByLabelText('Fødselsmåned (valgfritt)'), {
      target: { value: '9' },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Bekreft' }));

    await waitFor(() =>
      expect(savePersonAction).toHaveBeenCalledWith({
        create: false,
        person_id: 'p-emma',
        person: { name: 'Emma', birth_year: 2021, birth_month: 9 },
      })
    );
    expect(await screen.findByText('Alderen til Emma er lagret.')).toBeInTheDocument();
    expect(card()).toBeNull();
    expect(document.cookie).toContain(`${AGE_PROMPT_COOKIE}=p-emma`);
    // The editor row below took what Medal stored.
    expect(
      within(screen.getByRole('form', { name: 'Emma' })).getByLabelText('Fødselsmåned (valgfritt)')
    ).toHaveValue('9');
  });

  it("keeps unsaved typing in that child's editor row, taking only the fields it sent", async () => {
    vi.mocked(savePersonAction).mockResolvedValue(ok([member({ birthYear: 2021, birthMonth: 9 })]));
    render(
      <FamilyEditor
        family={[member()]}
        currentYear={YEAR}
        personDetails
        agePrompt={{ dismissed: [] }}
      />
    );

    // The parent starts editing Emma below, then answers the card above.
    const row = screen.getByRole('form', { name: 'Emma' });
    fireEvent.change(within(row).getByLabelText('Navn'), { target: { value: 'Emma Sofie' } });
    fireEvent.change(within(row).getByLabelText('Notat til frisøren'), {
      target: { value: 'Liker film og musikk' },
    });
    const region = card() as HTMLElement;
    fireEvent.change(within(region).getByLabelText('Fødselsår'), { target: { value: '2021' } });
    fireEvent.change(within(region).getByLabelText('Fødselsmåned (valgfritt)'), {
      target: { value: '9' },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Bekreft' }));

    expect(await screen.findByText('Alderen til Emma er lagret.')).toBeInTheDocument();
    // The card sent Medal's stored name, not the draft.
    expect(savePersonAction).toHaveBeenCalledWith(
      expect.objectContaining({ person: { name: 'Emma', birth_year: 2021, birth_month: 9 } })
    );
    const after = screen.getByRole('form', { name: 'Emma Sofie' });
    expect(within(after).getByLabelText('Navn')).toHaveValue('Emma Sofie');
    expect(within(after).getByLabelText('Notat til frisøren')).toHaveValue('Liker film og musikk');
    expect(within(after).getByLabelText('Fødselsår')).toHaveValue('2021');
    expect(within(after).getByLabelText('Fødselsmåned (valgfritt)')).toHaveValue('9');
  });

  it('confirms an unchanged year without asking Medal anything, and remembers it', async () => {
    render(
      <FamilyEditor
        family={[member()]}
        currentYear={YEAR}
        personDetails
        agePrompt={{ dismissed: [] }}
      />
    );

    fireEvent.click(within(card() as HTMLElement).getByRole('button', { name: 'Bekreft' }));

    expect(await screen.findByText('Alderen til Emma er bekreftet.')).toBeInTheDocument();
    expect(savePersonAction).not.toHaveBeenCalled();
    expect(card()).toBeNull();
    expect(document.cookie).toContain(`${AGE_PROMPT_COOKIE}=p-emma`);
  });

  it('«Ikke nå» hides it and remembers, then the next child is asked about', () => {
    render(
      <FamilyEditor
        family={[member(), member({ personId: 'p-theo', name: 'Theo' })]}
        currentYear={YEAR}
        personDetails
        agePrompt={{ dismissed: [] }}
      />
    );

    fireEvent.click(within(card() as HTMLElement).getByRole('button', { name: 'Ikke nå' }));

    expect(document.cookie).toContain(`${AGE_PROMPT_COOKIE}=p-emma`);
    expect(
      within(card() as HTMLElement).getByRole('heading', { name: 'Bekreft alderen til Theo' })
    ).toBeInTheDocument();
    expect(savePersonAction).not.toHaveBeenCalled();
  });

  it('keeps the card and says why when the save fails', async () => {
    vi.mocked(savePersonAction).mockResolvedValue({
      data: { ok: false, reason: 'invalid', message: 'Sjekk navn, fødselsår og måned.' },
    });
    render(
      <FamilyEditor
        family={[member()]}
        currentYear={YEAR}
        personDetails
        agePrompt={{ dismissed: [] }}
      />
    );

    const region = card() as HTMLElement;
    fireEvent.change(within(region).getByLabelText('Fødselsmåned (valgfritt)'), {
      target: { value: '3' },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Bekreft' }));

    expect(await within(region).findByText('Sjekk navn, fødselsår og måned.')).toBeInTheDocument();
    expect(card()).not.toBeNull();
    expect(document.cookie).not.toContain(`${AGE_PROMPT_COOKIE}=p-emma`);
  });

  it('sends a parent whose session died to the login', async () => {
    vi.mocked(savePersonAction).mockResolvedValue({ data: { ok: false, reason: 'session' } });
    render(
      <FamilyEditor
        family={[member()]}
        currentYear={YEAR}
        personDetails
        agePrompt={{ dismissed: [] }}
      />
    );

    const region = card() as HTMLElement;
    fireEvent.change(within(region).getByLabelText('Fødselsmåned (valgfritt)'), {
      target: { value: '3' },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Bekreft' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/min-side/logg-inn'));
  });
});
