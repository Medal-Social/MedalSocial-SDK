import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Vipps button, against a mocked server action.
 *
 * On success the real action never returns — it redirects — so the only
 * answers a test can see are the two reasons it did NOT: «unavailable» and
 * «throttled», each with its own sentence, and `null`, which is silence.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { LoginSheet } from '../../../src/react/LoginSheet';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * The source's button is meda's `VippsButton` now, drawn by the login with the
 * app's start action; the site's own orange comes in as `classNames.vipps`.
 * So the button is rendered the way a site gets it: inside the inline login.
 */
const startVippsLoginAction = vi.fn();
const VIPPS_ORANGE = {
  vipps: {
    button:
      'w-full rounded-full bg-[#FF5B24] text-white hover:bg-[#e6501f] focus-visible:ring-[#FF5B24]/40',
  },
};
function VippsLoginButton() {
  return (
    <LoginSheet
      presentation="inline"
      config={PARITY_CONFIG}
      labels={TEST_LABELS}
      classNames={VIPPS_ORANGE}
      actions={{ startLogin: vi.fn(), startVipps: startVippsLoginAction }}
    />
  );
}

const UNAVAILABLE = 'Vipps-innlogging er ikke tilgjengelig akkurat nå. Bruk e-post i stedet.';
const THROTTLED = 'Prøv igjen om et øyeblikk.';

function button() {
  return screen.getByRole('button', { name: 'Fortsett med Vipps' });
}

async function submit() {
  fireEvent.click(button());
  await waitFor(() => expect(startVippsLoginAction).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startVippsLoginAction).mockResolvedValue(null);
});

describe('VippsLoginButton', () => {
  it('renders one submit button in Vipps orange, and no sentence', () => {
    render(<VippsLoginButton />);

    const submitButton = button();
    expect(submitButton).toHaveAttribute('type', 'submit');
    expect(submitButton.className).toContain('bg-[#FF5B24]');
    expect(submitButton.className).toContain('text-white');
    expect(submitButton.closest('form')).not.toBeNull();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    expect(screen.queryByText(THROTTLED)).not.toBeInTheDocument();
  });

  it('submits the action with the form data and stays silent on null', async () => {
    render(<VippsLoginButton />);

    await submit();

    const [, formData] = vi.mocked(startVippsLoginAction).mock.calls[0];
    expect(formData).toBeInstanceOf(FormData);
    await waitFor(() => expect(button()).not.toBeDisabled());
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it('says «use e-mail instead» when Vipps is unavailable', async () => {
    vi.mocked(startVippsLoginAction).mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(<VippsLoginButton />);

    await submit();

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument();
    expect(button()).not.toBeDisabled();
  });

  it('says «try again in a moment» when throttled', async () => {
    vi.mocked(startVippsLoginAction).mockResolvedValue({ ok: false, reason: 'throttled' });
    render(<VippsLoginButton />);

    await submit();

    expect(await screen.findByText(THROTTLED)).toBeInTheDocument();
  });

  it('disables the button while the action is pending', async () => {
    let settle: (state: null) => void = () => {};
    vi.mocked(startVippsLoginAction).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );
    render(<VippsLoginButton />);

    await submit();

    await waitFor(() => expect(button()).toBeDisabled());
    settle(null);
    await waitFor(() => expect(button()).not.toBeDisabled());
  });
});
