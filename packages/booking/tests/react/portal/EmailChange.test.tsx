import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «E-post» → «Endre» on Min side → Profil: the new address, then the code,
 * then «changed» — against a mocked `fetch` to the portal API routes. A
 * refusal is a sentence, never a logout; only `session` goes to the login.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import type { VippsLinkStartResult } from '@medalsocial/meda/booking';
import { PortalEmailChange } from '../../../src/react/portal/email-change';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';
import { Kit } from './harness';

const label = (key: keyof typeof TEST_LABELS) => {
  const value = TEST_LABELS[key];
  return typeof value === 'string' ? value : (value ?? []).join('');
};

const API = PARITY_CONFIG.paths.portalApi;
const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();
const startVippsLink = vi.fn<() => Promise<VippsLinkStartResult>>();

function answer(status: number, body: unknown) {
  return Promise.resolve(Response.json(body, { status }));
}

function Subject({ vippsLinked = false }: { vippsLinked?: boolean }) {
  return (
    <Kit>
      {(booking) => (
        <PortalEmailChange
          booking={booking}
          email="kari@example.com"
          vippsLinked={vippsLinked}
          startVippsLink={startVippsLink}
          resendDelayMs={30_000}
        />
      )}
    </Kit>
  );
}

async function openAndSend(address = 'kari.ny@example.com') {
  fireEvent.click(screen.getByRole('button', { name: label('emailChange.buttonLabel') }));
  const input = await screen.findByLabelText(label('emailChange.newEmail'));
  fireEvent.change(input, { target: { value: address } });
  fireEvent.click(screen.getByRole('button', { name: label('emailChange.send') }));
}

function enterCode(code: string) {
  const input = screen.getByLabelText(label('otp.label'));
  fireEvent.change(input, { target: { value: code } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((input) =>
    String(input).endsWith('/email/start')
      ? answer(200, { ok: true, to: 'k•••@e•••.com' })
      : answer(200, { ok: true, email: 'kari.ny@example.com', signedIn: true })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PortalEmailChange', () => {
  it('shows the address on file with a named «Endre» button', () => {
    render(<Subject />);

    expect(screen.getByRole('region', { name: label('emailChange.heading') })).toBeInTheDocument();
    expect(screen.getByText('kari@example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('emailChange.buttonLabel') })
    ).toHaveTextContent(label('emailChange.button'));
  });

  it('walks both steps: sends the code, verifies it, and says where mail now goes', async () => {
    render(<Subject />);
    await openAndSend();

    expect(await screen.findByText('Vi har sendt en kode til k•••@e•••.com.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/email/start`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'kari.ny@example.com' }),
      })
    );
    // Start says «sent» even when no mail could go out: the help is always there.
    expect(screen.getByText(label('emailChange.noCode'))).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(label('otp.label'))).toHaveFocus());

    enterCode('007123');

    expect(
      await screen.findByText(
        'E-posten er endret. Bekreftelser og påminnelser går nå til kari.ny@example.com.'
      )
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${API}/email/verify`,
      expect.objectContaining({ body: JSON.stringify({ code: '007123' }) })
    );
    expect(screen.getByRole('heading', { name: label('emailChange.doneTitle') })).toHaveFocus();
    expect(screen.queryByText(label('emailChange.vippsRelink'))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: label('emailChange.finish') }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('says Vipps was disconnected and offers to reconnect it', async () => {
    startVippsLink.mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(<Subject vippsLinked />);
    await openAndSend();
    await screen.findByLabelText(label('otp.label'));
    enterCode('007123');

    expect(await screen.findByText(label('emailChange.vippsRelink'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: label('emailChange.vippsRelinkButton') }));
    await waitFor(() => expect(startVippsLink).toHaveBeenCalledWith(null));
  });

  it('keeps the customer on the code step for a wrong code — no logout', async () => {
    fetchMock.mockImplementation((input) =>
      String(input).endsWith('/email/start')
        ? answer(200, { ok: true, to: 'k•••@e•••.com' })
        : answer(422, { ok: false, reason: 'refused', refusal: 'code_invalid' })
    );
    render(<Subject />);
    await openAndSend();
    await screen.findByLabelText(label('otp.label'));
    enterCode('000000');

    expect(await screen.findByText(label('emailChange.refused.code_invalid'))).toBeInTheDocument();
    expect(screen.getByLabelText(label('otp.label'))).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sends a taken address back to the first step, with the salon copy', async () => {
    fetchMock.mockImplementation((input) =>
      String(input).endsWith('/email/start')
        ? answer(200, { ok: true, to: 'k•••@e•••.com' })
        : answer(422, { ok: false, reason: 'refused', refusal: 'email_taken' })
    );
    render(<Subject />);
    await openAndSend();
    await screen.findByLabelText(label('otp.label'));
    enterCode('123456');

    expect(
      await screen.findByText(
        'Denne e-posten er allerede i bruk hos salongen. Ring oss om den er din.'
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText(label('emailChange.newEmail'))).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    ['unchanged', 'emailChange.refused.unchanged'],
    ['too_many_codes', 'emailChange.refused.too_many_codes'],
  ] as const)('explains a start refused as %s beside the field', async (refusal, key) => {
    fetchMock.mockImplementation(() => answer(422, { ok: false, reason: 'refused', refusal }));
    render(<Subject />);
    await openAndSend();

    expect(await screen.findByText(label(key))).toBeInTheDocument();
    expect(screen.getByLabelText(label('emailChange.newEmail'))).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });

  it('checks the address before asking', async () => {
    render(<Subject />);
    await openAndSend('not-an-address');

    expect(await screen.findByText(label('emailChange.invalidEmail'))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a dead session to the login', async () => {
    fetchMock.mockImplementation(() => answer(401, { ok: false, reason: 'session' }));
    render(<Subject />);
    await openAndSend();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(PARITY_CONFIG.paths.portalLogin));
  });

  it('offers a new code only after the delay, and a way back to the address', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Subject />);
    await openAndSend();
    await screen.findByLabelText(label('otp.label'));

    const resend = screen.getByRole('button', { name: /Send ny kode om \d+ s/ });
    expect(resend).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    const ready = screen.getByRole('button', { name: label('emailChange.resend') });
    expect(ready).toBeEnabled();
    fireEvent.click(ready);
    expect(await screen.findByText(label('emailChange.resent'))).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: label('emailChange.otherAddress') }));
    expect(screen.getByLabelText(label('emailChange.newEmail'))).toHaveValue('kari.ny@example.com');
  });
});
