import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import type { PortalFamilyMemberDto, PortalProfileDto } from '../../../src/core/portal/dto';
import type { PersonActionResult, PortalActions } from '../../../src/react/actions';
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
 * «Mine barn», one child at a time (SP10). What matters here is the WIRING:
 * that a row saves through the person action with the child's id (so a
 * rename edits the same child), that the SP10 details are offered only where
 * Medal keeps them, and that the save is optimistic and locked like SP9's.
 */

const YEAR = 2026;

function member(overrides: Partial<PortalFamilyMemberDto> = {}): PortalFamilyMemberDto {
  return {
    personId: 'p-jonas',
    name: 'Jonas',
    birthYear: 2018,
    birthMonth: null,
    notes: null,
    preferredResourceId: null,
    ...overrides,
  };
}

const JONAS = member();
const STYLISTS = [
  { id: 'res-bjarne', name: 'Bjarne' },
  { id: 'res-ola', name: 'Ola' },
];

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

function ok(
  family: PortalFamilyMemberDto[],
  extra: Partial<Extract<PersonActionResult, { ok: true }>> = {}
) {
  return {
    data: {
      ok: true as const,
      profile: profile(family),
      personId: null,
      fallback: false,
      ...extra,
    },
  };
}

function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function rowFor(name: string) {
  return screen.getByRole('form', { name });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(savePersonAction).mockResolvedValue(ok([JONAS]));
  vi.mocked(removePersonAction).mockResolvedValue(ok([]));
});

describe('FamilyEditor', () => {
  it('shows the children on file with a year range of eighteen years', () => {
    render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

    expect(screen.getByRole('heading', { name: 'Familie' })).toBeInTheDocument();
    expect(screen.getByLabelText('Navn')).toHaveValue('Jonas');
    const year = screen.getByLabelText('Fødselsår');
    expect(year).toHaveValue('2018');
    const options = Array.from((year as HTMLSelectElement).options).map((o) => o.value);
    expect(options[0]).toBe('');
    expect(options[1]).toBe('2026');
    expect(options.at(-1)).toBe('2008');
  });

  it('keeps a birth year that has aged out of the range on the list, and selected', () => {
    render(<FamilyEditor family={[member({ birthYear: 2000 })]} currentYear={YEAR} />);

    expect(screen.getByLabelText('Fødselsår')).toHaveValue('2000');
  });

  it('offers month, «Fast frisør» and «Notat til frisøren» only where Medal keeps them', () => {
    const { unmount } = render(
      <FamilyEditor family={[JONAS]} currentYear={YEAR} stylists={STYLISTS} />
    );
    expect(screen.queryByLabelText('Fødselsmåned (valgfritt)')).toBeNull();
    expect(screen.queryByLabelText('Fast frisør')).toBeNull();
    unmount();

    render(
      <FamilyEditor
        family={[
          member({ birthMonth: 4, notes: 'Redd for maskin', preferredResourceId: 'res-bjarne' }),
        ]}
        currentYear={YEAR}
        personDetails
        stylists={STYLISTS}
      />
    );
    expect(screen.getByLabelText('Fødselsmåned (valgfritt)')).toHaveValue('4');
    expect(screen.getByLabelText('Fast frisør')).toHaveValue('res-bjarne');
    expect(screen.getByLabelText('Notat til frisøren')).toHaveValue('Redd for maskin');
    const stylists = within(screen.getByLabelText('Fast frisør')).getAllByRole('option');
    expect(stylists.map((option) => option.textContent)).toEqual(['Ingen fast', 'Bjarne', 'Ola']);
  });

  it('renames a child IN PLACE, by id, with the details in the wire shape', async () => {
    vi.mocked(savePersonAction).mockResolvedValue(
      ok([member({ name: 'Jonas Emil', birthMonth: 4, preferredResourceId: 'res-bjarne' })], {
        personId: 'p-jonas',
      })
    );
    render(<FamilyEditor family={[JONAS]} currentYear={YEAR} personDetails stylists={STYLISTS} />);

    fireEvent.change(screen.getByLabelText('Navn'), { target: { value: ' Jonas Emil ' } });
    fireEvent.change(screen.getByLabelText('Fødselsmåned (valgfritt)'), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('Fast frisør'), { target: { value: 'res-bjarne' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));

    await waitFor(() => expect(savePersonAction).toHaveBeenCalledTimes(1));
    expect(savePersonAction).toHaveBeenCalledWith({
      create: false,
      person_id: 'p-jonas',
      person: {
        name: 'Jonas Emil',
        birth_year: 2018,
        birth_month: 4,
        notes: null,
        preferred_resource_id: 'res-bjarne',
      },
    });
    expect(await screen.findByText('Lagret')).toBeInTheDocument();
    expect(screen.getByLabelText('Navn')).toHaveValue('Jonas Emil');
  });

  it('creates a new child and keeps the details fields for the first one', async () => {
    // Nobody on the profile: nothing to read `personDetails` off, so a new
    // row offers the details and the action finds out whether Medal keeps them.
    const created = member({ personId: 'p-mia', name: 'Mia', birthYear: 2021 });
    vi.mocked(savePersonAction).mockResolvedValue(ok([created], { personId: 'p-mia' }));
    render(<FamilyEditor family={[]} currentYear={YEAR} stylists={STYLISTS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Legg til barn' }));
    const row = rowFor('Nytt barn');
    fireEvent.change(within(row).getByLabelText('Navn'), { target: { value: 'Mia' } });
    fireEvent.change(within(row).getByLabelText('Fødselsår'), { target: { value: '2021' } });
    fireEvent.change(within(row).getByLabelText('Notat til frisøren'), {
      target: { value: 'Første klipp' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Lagre' }));

    await waitFor(() =>
      expect(savePersonAction).toHaveBeenCalledWith({
        create: true,
        person_id: null,
        person: {
          name: 'Mia',
          birth_year: 2021,
          birth_month: null,
          notes: 'Første klipp',
          preferred_resource_id: null,
        },
      })
    );
    expect(await within(rowFor('Mia')).findByText('Lagret')).toBeInTheDocument();
  });

  it('says so when Medal could only keep the name and year (no person endpoints yet)', async () => {
    vi.mocked(savePersonAction).mockResolvedValue(
      ok([member({ personId: null, name: 'Mia', birthYear: 2021 })], { fallback: true })
    );
    render(<FamilyEditor family={[]} currentYear={YEAR} stylists={STYLISTS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Legg til barn' }));
    const row = rowFor('Nytt barn');
    fireEvent.change(within(row).getByLabelText('Navn'), { target: { value: 'Mia' } });
    fireEvent.change(within(row).getByLabelText('Fødselsår'), { target: { value: '2021' } });
    fireEvent.change(within(row).getByLabelText('Fast frisør'), {
      target: { value: 'res-bjarne' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Lagre' }));

    expect(
      await screen.findByText(/Måned, fast frisør og notat kan ikke lagres ennå/)
    ).toBeVisible();
  });

  it('addresses a child the profile could not name by its index', async () => {
    render(<FamilyEditor family={[member({ personId: null })]} currentYear={YEAR} />);

    fireEvent.change(screen.getByLabelText('Navn'), { target: { value: 'Jonas E' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));

    await waitFor(() =>
      expect(savePersonAction).toHaveBeenCalledWith({
        create: false,
        person_id: null,
        index: 0,
        person: { name: 'Jonas E', birth_year: 2018 },
      })
    );
  });

  it('removes one child by id', async () => {
    render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fjern Jonas' }));

    await waitFor(() => expect(removePersonAction).toHaveBeenCalledWith({ person_id: 'p-jonas' }));
    expect(await screen.findByText('Fjernet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Navn')).toBeNull();
  });

  it('drops a new row that was never saved without asking Medal', () => {
    render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

    fireEvent.click(screen.getByRole('button', { name: 'Legg til barn' }));
    expect(screen.getAllByLabelText('Navn')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Fjern rad' }));

    expect(screen.getAllByLabelText('Navn')).toHaveLength(1);
    expect(removePersonAction).not.toHaveBeenCalled();
  });

  it('stops adding at ten children', () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      member({ personId: `p-${i}`, name: `Barn ${i}`, birthYear: 2015 })
    );
    render(<FamilyEditor family={ten} currentYear={YEAR} />);

    expect(screen.queryByRole('button', { name: 'Legg til barn' })).not.toBeInTheDocument();
  });

  it('refuses a half-filled row instead of guessing, and marks only that field', () => {
    render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

    fireEvent.click(screen.getByRole('button', { name: 'Legg til barn' }));
    const row = rowFor('Nytt barn');
    fireEvent.change(within(row).getByLabelText('Navn'), { target: { value: 'Mia' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Lagre' }));

    expect(within(row).getByText('Barnet trenger både navn og fødselsår.')).toBeInTheDocument();
    expect(within(row).getByLabelText('Fødselsår')).toHaveAttribute('aria-invalid', 'true');
    expect(within(row).getByLabelText('Navn')).not.toHaveAttribute('aria-invalid');
    expect(within(rowFor('Jonas')).getByLabelText('Fødselsår')).not.toHaveAttribute('aria-invalid');
    expect(savePersonAction).not.toHaveBeenCalled();
  });

  it('shows the action’s sentence when Medal rejects the edit', async () => {
    vi.mocked(savePersonAction).mockResolvedValue({
      data: { ok: false, reason: 'invalid', message: 'Dette barnet er allerede lagt inn.' },
    });
    render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(await screen.findByText('Dette barnet er allerede lagt inn.')).toBeInTheDocument();
  });

  it('goes to the login when the session is dead', async () => {
    vi.mocked(savePersonAction).mockResolvedValue({ data: { ok: false, reason: 'session' } });
    render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/min-side/logg-inn'));
  });

  it('keeps another child’s unsaved typing when one child is saved', async () => {
    const theo = member({ personId: 'p-theo', name: 'Theo', birthYear: 2020 });
    vi.mocked(savePersonAction).mockResolvedValue(
      ok([member({ name: 'Jonas E' }), theo], { personId: 'p-jonas' })
    );
    render(<FamilyEditor family={[JONAS, theo]} currentYear={YEAR} />);

    fireEvent.change(within(rowFor('Theo')).getByLabelText('Navn'), {
      target: { value: 'Theodor' },
    });
    fireEvent.change(within(rowFor('Jonas')).getByLabelText('Navn'), {
      target: { value: 'Jonas E' },
    });
    fireEvent.click(within(rowFor('Jonas E')).getByRole('button', { name: 'Lagre' }));

    expect(await within(rowFor('Jonas E')).findByText('Lagret')).toBeInTheDocument();
    expect(within(rowFor('Theodor')).getByLabelText('Navn')).toHaveValue('Theodor');
  });

  /**
   * SP9's optimistic save, per child: the outcome shows at the tap, every row
   * locked until Medal answers, and a failure puts the parent's edits back.
   */
  describe('optimistic save', () => {
    it('shows «Lagret» before Medal answers, with the rows locked', async () => {
      const call = deferred<Awaited<ReturnType<typeof savePersonAction>>>();
      vi.mocked(savePersonAction).mockReturnValue(call.promise);
      render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

      fireEvent.change(screen.getByLabelText('Navn'), { target: { value: ' Jonas ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));

      expect(await screen.findByText('Lagret')).toBeInTheDocument();
      expect(screen.getByLabelText('Navn')).toHaveValue('Jonas');
      expect(screen.getByLabelText('Navn')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Fjern Jonas' })).toBeDisabled();

      call.settle(ok([JONAS], { personId: 'p-jonas' }));
      await waitFor(() => expect(screen.getByLabelText('Navn')).toBeEnabled());
      expect(screen.getByText('Lagret')).toBeInTheDocument();
    });

    it('rolls back to what the parent had, with the reason, when the save fails', async () => {
      const call = deferred<Awaited<ReturnType<typeof savePersonAction>>>();
      vi.mocked(savePersonAction).mockReturnValue(call.promise);
      render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

      fireEvent.change(screen.getByLabelText('Navn'), { target: { value: 'Jonas Emil' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));
      expect(await screen.findByText('Lagret')).toBeInTheDocument();

      call.settle({ serverError: 'boom' });

      expect(
        await screen.findByText(
          'Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText('Lagret')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Navn')).toHaveValue('Jonas Emil');
    });

    it('hides a removed child at once and puts them back when the removal fails', async () => {
      const call = deferred<Awaited<ReturnType<typeof removePersonAction>>>();
      vi.mocked(removePersonAction).mockReturnValue(call.promise);
      render(<FamilyEditor family={[JONAS]} currentYear={YEAR} />);

      fireEvent.click(screen.getByRole('button', { name: 'Fjern Jonas' }));
      await waitFor(() => expect(screen.queryByLabelText('Navn')).toBeNull());

      call.settle({ serverError: 'boom' });

      expect(await screen.findByLabelText('Navn')).toHaveValue('Jonas');
      expect(
        screen.getByText('Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.')
      ).toBeInTheDocument();
    });
  });
});
