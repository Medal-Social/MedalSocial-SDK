import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «Om deg» against mocked server actions.
 *
 * What is asserted is the SHAPE of the patch — a cleared name is omitted, not
 * sent blank; a kept name is trimmed; the phone always travels — and that
 * every sentence the form shows is pinned to the input it is about. The
 * marketing box is checked for the one property a checkbox that talks to a
 * server must have: it shows what the server has, not what was clicked.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import type { PortalProfileDto } from '../../../src/core/portal/dto';
import type { PortalActions } from '../../../src/react/actions';
import { PortalProfileForm } from '../../../src/react/portal/wired';
import { Kit } from './harness';

const updateProfileAction = vi.fn<PortalActions['updateProfile']>();
const setMarketingConsentAction = vi.fn<PortalActions['setMarketingConsent']>();

function ProfileForm({ profile }: { profile: PortalProfileDto }) {
  return (
    <Kit>
      {(booking) => (
        <PortalProfileForm
          booking={booking}
          profile={profile}
          actions={{
            updateProfile: updateProfileAction,
            setMarketingConsent: setMarketingConsentAction,
          }}
        />
      )}
    </Kit>
  );
}

const PROFILE: PortalProfileDto = {
  contactId: 'ct-1',
  email: 'kari@example.com',
  firstName: 'Kari',
  lastName: 'Nordmann',
  phone: '40000000',
  family: [],
  personDetails: false,
  marketingConsent: false,
};

const RESTORED = 'Navn kan ikke være tomt – vi beholdt det gamle.';
const UNREACHABLE = 'Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.';

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateProfileAction).mockResolvedValue({ data: { ok: true, profile: PROFILE } });
  vi.mocked(setMarketingConsentAction).mockResolvedValue({
    data: { ok: true, marketingConsent: true },
  });
});

describe('ProfileForm', () => {
  it('shows the profile, with the e-mail read-only', () => {
    render(<ProfileForm profile={PROFILE} />);

    expect(screen.getByLabelText('Fornavn')).toHaveValue('Kari');
    expect(screen.getByLabelText('Etternavn')).toHaveValue('Nordmann');
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
    const email = screen.getByLabelText('E-post');
    expect(email).toHaveValue('kari@example.com');
    expect(email).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('sends trimmed names and the phone as typed, and says «Lagret»', async () => {
    render(<ProfileForm profile={PROFILE} />);

    type('Fornavn', '  Kari ');
    type('Etternavn', ' Nordmann  ');
    type('Mobilnummer', '400 00 000');
    save();

    await waitFor(() =>
      expect(updateProfileAction).toHaveBeenCalledWith({
        first_name: 'Kari',
        last_name: 'Nordmann',
        phone: '400 00 000',
      })
    );
    expect(await screen.findByText('Lagret')).toBeInTheDocument();
    expect(screen.queryByText(RESTORED)).not.toBeInTheDocument();
  });

  it('omits cleared names from the patch, re-fills them, and says they were kept', async () => {
    render(<ProfileForm profile={PROFILE} />);

    type('Fornavn', '   ');
    type('Etternavn', '');
    type('Mobilnummer', '');
    save();

    // Both names absent — not `''` — and the phone present as `''`, which is
    // how «no phone» is spelled on the wire.
    await waitFor(() => expect(updateProfileAction).toHaveBeenCalledWith({ phone: '' }));
    const notice = await screen.findByText(RESTORED);
    expect(screen.queryByText('Lagret')).not.toBeInTheDocument();
    // Re-filled from what Medal handed back.
    const first = screen.getByLabelText('Fornavn');
    const last = screen.getByLabelText('Etternavn');
    expect(first).toHaveValue('Kari');
    expect(last).toHaveValue('Nordmann');
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
    // The notice is about the name fields, and only them.
    expect(first.getAttribute('aria-describedby')).toContain(notice.id);
    expect(last.getAttribute('aria-describedby')).toContain(notice.id);
    expect(first).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mobilnummer')).not.toHaveAttribute('aria-describedby');
  });

  it('pins the notice to just the name that was cleared', async () => {
    render(<ProfileForm profile={PROFILE} />);

    type('Etternavn', '');
    save();

    await waitFor(() =>
      expect(updateProfileAction).toHaveBeenCalledWith({ first_name: 'Kari', phone: '40000000' })
    );
    const notice = await screen.findByText(RESTORED);
    expect(screen.getByLabelText('Etternavn').getAttribute('aria-describedby')).toContain(
      notice.id
    );
    expect(screen.getByLabelText('Fornavn')).not.toHaveAttribute('aria-describedby');
  });

  it('says «Lagret» when a cleared name was genuinely cleared on file too', async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({
      data: { ok: true, profile: { ...PROFILE, lastName: null } },
    });
    render(<ProfileForm profile={PROFILE} />);

    type('Etternavn', '');
    save();

    expect(await screen.findByText('Lagret')).toBeInTheDocument();
    expect(screen.getByLabelText('Etternavn')).toHaveValue('');
  });

  it('wires a rejected phone to the phone field', async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({
      validationErrors: { phone: { _errors: ['Telefonnummeret må ha åtte siffer.'] } },
    });
    render(<ProfileForm profile={PROFILE} />);

    type('Mobilnummer', '1234');
    save();

    const error = await screen.findByText('Telefonnummeret må ha åtte siffer.');
    const phone = screen.getByLabelText('Mobilnummer');
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(phone.getAttribute('aria-describedby')).toContain(error.id);
    expect(screen.getByLabelText('Fornavn')).not.toHaveAttribute('aria-invalid');

    // Typing again withdraws the complaint.
    type('Mobilnummer', '12345678');
    expect(screen.queryByText('Telefonnummeret må ha åtte siffer.')).not.toBeInTheDocument();
    expect(phone).not.toHaveAttribute('aria-invalid');
  });

  it('shows a request failure without blaming a field', async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({ serverError: 'boom' });
    render(<ProfileForm profile={PROFILE} />);

    save();

    expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument();
    expect(screen.getByLabelText('Mobilnummer')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mobilnummer')).not.toHaveAttribute('aria-describedby');
  });

  it("shows Medal's own sentence when it rejects the edit", async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({
      data: { ok: false, reason: 'invalid', message: 'Nummeret er ikke i bruk.' },
    });
    render(<ProfileForm profile={PROFILE} />);

    save();

    expect(await screen.findByText('Nummeret er ikke i bruk.')).toBeInTheDocument();
  });

  it('goes to the login when the save finds the session dead', async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({ data: { ok: false, reason: 'session' } });
    render(<ProfileForm profile={PROFILE} />);

    save();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/min-side/logg-inn'));
    expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument();
  });

  describe('marketing consent', () => {
    it('flips at once and stays flipped when Medal takes it', async () => {
      render(<ProfileForm profile={PROFILE} />);

      const box = screen.getByRole('checkbox');
      fireEvent.click(box);

      expect(box).toBeChecked();
      await waitFor(() =>
        expect(setMarketingConsentAction).toHaveBeenCalledWith({ granted: true })
      );
      await waitFor(() => expect(box).not.toBeDisabled());
      expect(box).toBeChecked();
      expect(updateProfileAction).not.toHaveBeenCalled();
    });

    it('shows what Medal stored, not what was clicked', async () => {
      vi.mocked(setMarketingConsentAction).mockResolvedValue({
        data: { ok: true, marketingConsent: false },
      });
      render(<ProfileForm profile={PROFILE} />);

      fireEvent.click(screen.getByRole('checkbox'));

      await waitFor(() => expect(setMarketingConsentAction).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
    });

    it('rolls back and says so when the call failed', async () => {
      vi.mocked(setMarketingConsentAction).mockResolvedValue({ serverError: 'boom' });
      render(<ProfileForm profile={PROFILE} />);

      const box = screen.getByRole('checkbox');
      fireEvent.click(box);
      expect(box).toBeChecked();

      expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument();
      expect(box).not.toBeChecked();
    });

    it('goes to the login when the session is dead', async () => {
      vi.mocked(setMarketingConsentAction).mockResolvedValue({
        data: { ok: false, reason: 'session' },
      });
      render(<ProfileForm profile={PROFILE} />);

      fireEvent.click(screen.getByRole('checkbox'));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/min-side/logg-inn'));
    });
  });
});

/**
 * Optimistic: «Lagret» (or the «kept your name» notice) and the trimmed names
 * show at once, not after Medal's answer and the dashboard's server re-render.
 * A failure takes it back — the fields as the parent typed them, and why.
 */
describe('ProfileForm optimistic save', () => {
  function deferred() {
    let settle: (value: Awaited<ReturnType<typeof updateProfileAction>>) => void = () => {};
    const promise = new Promise<Awaited<ReturnType<typeof updateProfileAction>>>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  it('shows «Lagret» and the trimmed names before Medal answers', async () => {
    const call = deferred();
    vi.mocked(updateProfileAction).mockReturnValue(call.promise);
    render(<ProfileForm profile={PROFILE} />);

    type('Fornavn', '  Kari ');
    save();

    expect(await screen.findByText('Lagret')).toBeInTheDocument();
    expect(screen.getByLabelText('Fornavn')).toHaveValue('Kari');
    // Locked until Medal answers: an edit now would be overwritten by it.
    expect(screen.getByLabelText('Fornavn')).toBeDisabled();
    expect(screen.getByLabelText('Mobilnummer')).toBeDisabled();

    call.settle({ data: { ok: true, profile: PROFILE } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lagre' })).toBeEnabled());
    expect(screen.getByText('Lagret')).toBeInTheDocument();
    expect(screen.getByLabelText('Fornavn')).toBeEnabled();
  });

  it('predicts a kept name from the profile on file', async () => {
    const call = deferred();
    vi.mocked(updateProfileAction).mockReturnValue(call.promise);
    render(<ProfileForm profile={PROFILE} />);

    type('Fornavn', '');
    save();

    expect(await screen.findByText(RESTORED)).toBeInTheDocument();
    expect(screen.getByLabelText('Fornavn')).toHaveValue('Kari');
    call.settle({ data: { ok: true, profile: PROFILE } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lagre' })).toBeEnabled());
    expect(screen.getByText(RESTORED)).toBeInTheDocument();
  });

  it('rolls back to what the parent typed, with the reason, when the save fails', async () => {
    const call = deferred();
    vi.mocked(updateProfileAction).mockReturnValue(call.promise);
    render(<ProfileForm profile={PROFILE} />);

    type('Fornavn', '  Kari ');
    save();
    expect(await screen.findByText('Lagret')).toBeInTheDocument();

    call.settle({ serverError: 'boom' });

    expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument();
    expect(screen.queryByText('Lagret')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fornavn')).toHaveValue('  Kari ');
  });
});
