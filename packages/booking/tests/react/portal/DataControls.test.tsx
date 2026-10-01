import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../../src/react/portal/leave', () => ({ leavePortal: vi.fn() }));

import { leavePortal as leaveMinSide } from '../../../src/react/portal/leave';
import { PortalDataControls } from '../../../src/react/portal/wired';
import { Kit } from './harness';

const exportDataAction = vi.fn();
const deleteMeAction = vi.fn();

function DataControls() {
  return (
    <Kit>
      {(booking) => (
        <PortalDataControls
          booking={booking}
          actions={{ exportData: exportDataAction, deleteMe: deleteMeAction }}
          deletedHref="/min-side/slettet"
        />
      )}
    </Kit>
  );
}

const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:test');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no object URLs; the component only needs them to exist.
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: removing the jsdom stand-ins.
  delete (URL as any).createObjectURL;
  // biome-ignore lint/suspicious/noExplicitAny: removing the jsdom stand-ins.
  delete (URL as any).revokeObjectURL;
});

describe('DataControls', () => {
  it('turns the export into a file download named by the action', async () => {
    vi.mocked(exportDataAction).mockResolvedValue({
      data: { ok: true, filename: 'min-side-eksport-2026-09-05.json', json: '{"a":1}' },
    });
    // `sameTurn` is true only for the synchronous turn `click()` runs in: it
    // drops at the first microtask. A revoke that reads it as `true` happened
    // before the browser could start the download.
    let sameTurn = false;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      sameTurn = true;
      queueMicrotask(() => {
        sameTurn = false;
      });
    });
    const revokedInClickTurn: boolean[] = [];
    revokeObjectURL.mockImplementation(() => revokedInClickTurn.push(sameTurn));
    render(<DataControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Last ned mine data' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe('{"a":1}');
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('min-side-eksport-2026-09-05.json');
    // Revoked a tick later, not synchronously: Safari starts the download
    // after `click()` returns, and a URL revoked before that is a download of
    // nothing.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:test'));
    expect(revokedInClickTurn).toEqual([false]);
    // Nothing of the export is left in the page.
    expect(document.body.innerHTML).not.toContain('"a":1');
    click.mockRestore();
  });

  it('opens the confirm panel with the consequences before anything is deleted', () => {
    render(<DataControls />);

    expect(screen.queryByLabelText(/Skriv SLETT/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Slett meg' }));

    expect(
      screen.getByText(
        'Kommende timer avbestilles, historikken anonymiseres, og du kan ikke logge inn igjen.'
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Skriv SLETT/)).toBeInTheDocument();
    expect(deleteMeAction).not.toHaveBeenCalled();
  });

  it('does not call the action unless SLETT is typed exactly', () => {
    render(<DataControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Slett meg' }));

    fireEvent.change(screen.getByLabelText(/Skriv SLETT/), { target: { value: 'slett' } });
    fireEvent.click(screen.getByRole('button', { name: 'Slett meg for alltid' }));

    expect(deleteMeAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Skriv SLETT med store bokstaver/)).toBeInTheDocument();
  });

  /** One full document load, `replace`d: it is a fresh page AND it drops the
   * router cache (and the history entry) holding the dead dashboard — no
   * `router.push` + `router.refresh` pair. */
  it('deletes with the literal word, then makes one navigation to the farewell page', async () => {
    vi.mocked(deleteMeAction).mockResolvedValue({ data: { ok: true } });
    render(<DataControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Slett meg' }));

    fireEvent.change(screen.getByLabelText(/Skriv SLETT/), { target: { value: 'SLETT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Slett meg for alltid' }));

    await waitFor(() => expect(deleteMeAction).toHaveBeenCalledWith({ confirm: 'SLETT' }));
    await waitFor(() => expect(leaveMinSide).toHaveBeenCalledTimes(1));
    expect(leaveMinSide).toHaveBeenCalledWith('/min-side/slettet', { replace: true });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('can be backed out of', () => {
    render(<DataControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Slett meg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));

    expect(screen.queryByLabelText(/Skriv SLETT/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Slett meg' })).toBeInTheDocument();
  });
});
