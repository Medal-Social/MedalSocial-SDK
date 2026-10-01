import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «Vipps» on Min side → Profil: linked, or a button to link — against a
 * mocked action. The action redirects on success, so what a test sees are the
 * reasons it did NOT: `missing` (this Medal has no link route → the row
 * hides), `session`, `unavailable`, `throttled`. The return from Vipps is the
 * server-set `flash` the page read from the httpOnly cookie — never the URL.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => ({ success: vi.fn() }));

import type { VippsLinkFlash, VippsLinkStartResult } from '@medalsocial/meda/booking';
import { vippsFlashPath } from '../../../src/react/portal/vipps-flash';
import { PortalVippsLinkRow } from '../../../src/react/portal/wired';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';
import { Kit } from './harness';

const startVippsLinkAction = vi.fn<() => Promise<VippsLinkStartResult>>();
const VIPPS_FLASH_PATH = vippsFlashPath(PARITY_CONFIG);
const VIPPS_LINK_SUCCESS = TEST_LABELS['vippsLink.success'] as string;
const VIPPS_LINK_CONFLICT = TEST_LABELS['vippsLink.conflict'] as string;

function VippsLinkRow({ linked, flash }: { linked: boolean; flash: VippsLinkFlash | null }) {
  return (
    <Kit>
      {(booking) => (
        <PortalVippsLinkRow
          booking={booking}
          linked={linked}
          flash={flash}
          startVippsLink={startVippsLinkAction}
          onToast={toast.success}
        />
      )}
    </Kit>
  );
}

async function tapLink() {
  fireEvent.click(screen.getByRole('button', { name: 'Koble til Vipps' }));
  await waitFor(() => expect(startVippsLinkAction).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startVippsLinkAction).mockResolvedValue(null);
  window.history.replaceState(null, '', '/min-side?fane=profil');
});

describe('VippsLinkRow', () => {
  it('says «Koblet til Vipps» and offers no button when the profile is linked', () => {
    render(<VippsLinkRow linked flash={null} />);

    expect(screen.getByRole('region', { name: 'Vipps' })).toBeInTheDocument();
    expect(screen.getByText('Koblet til Vipps')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Koble til Vipps' })).toBeNull();
  });

  it('offers «Koble til Vipps» when it is not', () => {
    render(<VippsLinkRow linked={false} flash={null} />);

    expect(screen.getByRole('button', { name: 'Koble til Vipps' })).toBeInTheDocument();
    expect(screen.queryByText('Koblet til Vipps')).toBeNull();
  });

  it('hides the whole row when Medal has no link route', async () => {
    vi.mocked(startVippsLinkAction).mockResolvedValue({ ok: false, reason: 'missing' });
    render(<VippsLinkRow linked={false} flash={null} />);

    await tapLink();

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Vipps' })).toBeNull());
  });

  it('sends a parent whose session died to the login', async () => {
    vi.mocked(startVippsLinkAction).mockResolvedValue({ ok: false, reason: 'session' });
    render(<VippsLinkRow linked={false} flash={null} />);

    await tapLink();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/min-side/logg-inn'));
  });

  it('says why when Vipps could not be started', async () => {
    vi.mocked(startVippsLinkAction).mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(<VippsLinkRow linked={false} flash={null} />);

    await tapLink();

    expect(
      await screen.findByText('Vipps er ikke tilgjengelig akkurat nå. Prøv igjen senere.')
    ).toBeInTheDocument();
  });

  it('toasts «Vipps er koblet til» only on the server flash, and spends it', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<VippsLinkRow linked flash="linked" />);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(VIPPS_LINK_SUCCESS));
    expect(VIPPS_LINK_SUCCESS).toBe('Vipps er koblet til');
    expect(fetchSpy).toHaveBeenCalledWith(
      VIPPS_FLASH_PATH,
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(screen.getByText('Koblet til Vipps')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('takes its linked state ONLY from the profile, never from the flash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    // Even a «linked» flash does not turn an unlinked profile's row: the
    // toast says what happened, Medal's profile says what is.
    render(<VippsLinkRow linked={false} flash="linked" />);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Koble til Vipps' })).toBeInTheDocument();
    expect(screen.queryByText('Koblet til Vipps')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('asks nothing and toasts nothing without a flash', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<VippsLinkRow linked={false} flash={null} />);

    expect(toast.success).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('explains a Vipps account that belongs to another profile, and spends that flash too', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<VippsLinkRow linked={false} flash="link_conflict" />);

    expect(screen.getByText(VIPPS_LINK_CONFLICT)).toBeInTheDocument();
    expect(VIPPS_LINK_CONFLICT).toBe(
      'Denne Vipps-kontoen er allerede koblet til en annen profil. Ring salongen om du trenger hjelp.'
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Koble til Vipps' })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        VIPPS_FLASH_PATH,
        expect.objectContaining({ method: 'DELETE' })
      )
    );
    vi.unstubAllGlobals();
  });

  it('says a failed link can be tried again', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    render(<VippsLinkRow linked={false} flash="link_failed" />);

    expect(screen.getByText('Vi fikk ikke koblet til Vipps. Prøv igjen.')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
