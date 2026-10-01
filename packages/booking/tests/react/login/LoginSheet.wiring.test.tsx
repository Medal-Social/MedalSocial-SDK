import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBookingConfig } from '../../../src/core/config';
import type { PortalActions } from '../../../src/react/actions';
import { LoginSheet } from '../../../src/react/LoginSheet';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * What the package adds around meda's login: the routes it asks (from
 * `config.paths.portalApi`), how it reads the app's action and the route's
 * answers, when it offers Vipps, and where the page login lands.
 */

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const EMAIL = 'kari@example.com';
const fetchMock = vi.fn();

function answer(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function renderInline(
  overrides: Partial<{
    config: typeof PARITY_CONFIG;
    startLogin: PortalActions['startLogin'];
    startVipps: PortalActions['startVipps'];
    returnPath: string | null;
    classNames: Parameters<typeof LoginSheet>[0]['classNames'];
  }> = {}
) {
  const startLogin: PortalActions['startLogin'] =
    overrides.startLogin ?? vi.fn().mockResolvedValue({ status: 'sent' });
  render(
    <LoginSheet
      presentation="inline"
      config={overrides.config ?? PARITY_CONFIG}
      labels={TEST_LABELS}
      classNames={overrides.classNames}
      returnPath={overrides.returnPath}
      actions={{
        startLogin,
        startVipps:
          'startVipps' in overrides ? overrides.startVipps : vi.fn().mockResolvedValue(null),
      }}
    />
  );
  return { startLogin };
}

async function sendCode() {
  fireEvent.change(screen.getByLabelText('E-post'), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole('button', { name: 'Send kode' }));
  return screen.findByLabelText('Engangskode');
}

function paste(input: HTMLElement, text: string) {
  fireEvent.paste(input, { clipboardData: { getData: () => text } });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginSheet wiring', () => {
  it('asks the routes under the configured portal API', async () => {
    const config = resolveBookingConfig({
      ...PARITY_CONFIG,
      paths: { ...PARITY_CONFIG.paths, portalApi: '/api/account' },
    });
    fetchMock.mockImplementation(() => answer({ ok: true }));
    renderInline({ config });

    paste(await sendCode(), '123456');

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/min-side'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/login/verify');
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('reads a plain «sent» from an action that is not wrapped in an envelope', async () => {
    renderInline();
    expect(await sendCode()).toBeInTheDocument();
  });

  it('reads the plain action’s refusal of an address as a bad address', async () => {
    renderInline({
      startLogin: vi.fn().mockResolvedValue({ ok: false, reason: 'invalid', message: 'Nei.' }),
    });
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: 'Send kode' }));
    expect(await screen.findByText(TEST_LABELS['login.notice.badEmail'])).toBeInTheDocument();
    expect(screen.queryByLabelText('Engangskode')).toBeNull();
  });

  it('says it could not reach the booking system when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    renderInline();

    paste(await sendCode(), '123456');

    expect(
      await screen.findByText(
        'Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.'
      )
    ).toBeInTheDocument();
  });

  it('treats a body that is not the route’s as unreachable', async () => {
    fetchMock.mockImplementation(() => answer(null, 403));
    renderInline();

    paste(await sendCode(), '123456');

    expect(
      await screen.findByText(
        'Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.'
      )
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('passes a conflict from the e-mail route through as the taken-account sentence', async () => {
    fetchMock.mockImplementation(() => answer({ ok: false, reason: 'conflict' }, 409));
    renderInline();

    paste(await sendCode(), '123456');

    expect(
      await screen.findByText(
        'Denne Vipps-kontoen er allerede koblet til en annen profil. Logg inn med e-post, eller ring salongen.'
      )
    ).toBeInTheDocument();
  });

  it('lands on the site root when the site has no portal and nothing asked to return', async () => {
    const config = resolveBookingConfig({
      ...PARITY_CONFIG,
      paths: { ...PARITY_CONFIG.paths, portal: null },
    });
    fetchMock.mockImplementation(() => answer({ ok: true, guardian: null }));
    renderInline({ config });

    paste(await sendCode(), '123456');

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('offers no Vipps without the app’s start action', () => {
    renderInline({ startVipps: undefined });
    expect(screen.queryByRole('button', { name: 'Logg inn med Vipps' })).toBeNull();
    expect(screen.queryByText('eller')).toBeNull();
  });

  it('offers no Vipps on a site without the method', () => {
    const config = resolveBookingConfig({
      ...PARITY_CONFIG,
      portal: { ...PARITY_CONFIG.portal, methods: ['email_code'] },
    });
    renderInline({ config });
    expect(screen.queryByRole('button', { name: 'Logg inn med Vipps' })).toBeNull();
  });

  it('lands the panel, code and Vipps classNames on their slots', async () => {
    renderInline({
      classNames: {
        loginPanel: { root: 'panel-root' },
        vipps: { button: 'vipps-button' },
        otp: { row: 'otp-row' },
      },
    });
    expect(document.querySelector('.panel-root')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Logg inn med Vipps' })).toHaveClass('vipps-button');

    await sendCode();
    expect(document.querySelector('.otp-row')).not.toBeNull();
  });

  it('lands the sheet’s classNames on its prompt row', () => {
    render(
      <LoginSheet
        presentation="sheet"
        resumePath="/bestill?resume=1"
        onSignedIn={vi.fn()}
        config={PARITY_CONFIG}
        labels={TEST_LABELS}
        classNames={{ loginSheet: { prompt: 'sheet-prompt' } }}
        actions={{ startLogin: vi.fn() }}
      />
    );
    expect(screen.getByText(/Har du konto\?/)).toHaveClass('sheet-prompt');
  });
});
