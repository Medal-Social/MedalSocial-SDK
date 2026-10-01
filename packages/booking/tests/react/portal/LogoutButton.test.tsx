import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «Logg ut». One button, one order of events that matters: the action (which
 * revokes upstream and clears the cookie) BEFORE the navigation — and ONE
 * navigation, a full document load to `/`, which crosses root layouts and
 * drops the router cache on its own (no `router.push` + `router.refresh`).
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../../src/react/portal/leave', () => ({ leavePortal: vi.fn() }));

import { leavePortal as leaveMinSide } from '../../../src/react/portal/leave';
import { PortalLogoutButton } from '../../../src/react/portal/wired';
import { Kit } from './harness';

const logoutAction = vi.fn();

function LogoutButton() {
  return (
    <Kit>
      {(booking) => (
        <PortalLogoutButton booking={booking} actions={{ logout: logoutAction }} logoutHref="/" />
      )}
    </Kit>
  );
}

/** A promise the test resolves by hand, to look at the form mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logoutAction).mockResolvedValue({ data: { ok: true } });
});

describe('LogoutButton', () => {
  it('logs out, then makes one full navigation to the front page', async () => {
    const order: string[] = [];
    vi.mocked(logoutAction).mockImplementation(async () => {
      order.push('action');
      return { data: { ok: true as const } };
    });
    vi.mocked(leaveMinSide).mockImplementation(() => {
      order.push('leave');
    });
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Logg ut' }));

    await waitFor(() => expect(leaveMinSide).toHaveBeenCalledTimes(1));
    expect(leaveMinSide).toHaveBeenCalledWith('/');
    expect(order).toEqual(['action', 'leave']);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('stays put with a message when the action fails, so nothing claims a logout that did not happen', async () => {
    vi.mocked(logoutAction).mockResolvedValue({ serverError: 'boom' } as never);
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Logg ut' }));

    await waitFor(() =>
      expect(screen.getByText(/Vi fikk ikke kontakt med bookingsystemet/)).toBeInTheDocument()
    );
    expect(leaveMinSide).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    // The message lands inside the transition; the button re-enables when it ends.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Logg ut' })).not.toBeDisabled());
  });

  it('is disabled while the action is in flight', async () => {
    const { promise, resolve } = deferred<{ data: { ok: true } }>();
    vi.mocked(logoutAction).mockReturnValue(promise);
    render(<LogoutButton />);

    const button = screen.getByRole('button', { name: 'Logg ut' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(leaveMinSide).not.toHaveBeenCalled();

    resolve({ data: { ok: true } });

    await waitFor(() => expect(leaveMinSide).toHaveBeenCalledWith('/'));
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
