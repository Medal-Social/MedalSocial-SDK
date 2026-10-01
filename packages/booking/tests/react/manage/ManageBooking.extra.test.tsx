import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingManageDto } from '../../../src/core/types';
import { ManageBooking } from '../../../src/react/ManageBooking';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * What `<ManageBooking>` adds over the moved suite: the defaults it takes from
 * the config, the calendar entry's variants, and the failure paths of its own
 * fetches.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 5, 13);

function booking(overrides: Partial<BookingManageDto> = {}): BookingManageDto {
  const startTs = NOW + 72 * HOUR;
  return {
    bookingId: 'bk_1',
    status: 'confirmed',
    rescheduledFromId: null,
    startTs,
    endTs: startTs + 30 * 60_000,
    serviceId: 'svc-1',
    serviceName: 'Klipp',
    resourceId: 'res-1',
    resourceName: 'Bjarne',
    bookedForName: null,
    partySequenceId: null,
    amountOre: 49_000,
    cancelWindowHours: 24,
    rescheduleWindowHours: 24,
    canCancel: true,
    canReschedule: true,
    ...overrides,
  };
}

const Manage = (props: Partial<ComponentProps<typeof ManageBooking>>) => (
  <ManageBooking config={PARITY_CONFIG} labels={TEST_LABELS} booking={booking()} {...props} />
);

const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fetchMock = vi.fn(async () => jsonOk({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The calendar file behind «Legg til i kalender», unfolded. */
function calendar(): string {
  const href = screen.getByRole('link', { name: 'Legg til i kalender' }).getAttribute('href') ?? '';
  return decodeURIComponent(href.replace(/^data:text\/calendar;charset=utf-8,/, '')).replace(
    /\r\n /g,
    ''
  );
}

describe('ManageBooking — config defaults', () => {
  it('takes the phone, the address and the paths from the config', async () => {
    render(<Manage booking={booking({ canCancel: false, canReschedule: false })} />);

    expect(screen.getByRole('link', { name: /Ring oss for å endre/ })).toHaveAttribute(
      'href',
      'tel:22334455'
    );
    expect(screen.getByText('Torget 1, 0001 Oslo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Se alle timene dine på Min side' })).toHaveAttribute(
      'href',
      '/min-side'
    );
  });

  it('links «book a new time» to the booking path unless told otherwise', () => {
    const { unmount } = render(<Manage booking={booking({ status: 'cancelled' })} />);
    expect(screen.getByRole('link', { name: 'Bestill ny time' })).toHaveAttribute(
      'href',
      '/bestill'
    );
    unmount();

    render(<Manage booking={booking({ status: 'cancelled' })} bookHref="https://example.test/b" />);
    expect(screen.getByRole('link', { name: 'Bestill ny time' })).toHaveAttribute(
      'href',
      'https://example.test/b'
    );
  });

  it('draws no portal link when the site has no portal', () => {
    render(
      <Manage config={{ ...PARITY_CONFIG, paths: { ...PARITY_CONFIG.paths, portal: null } }} />
    );
    expect(screen.queryByRole('link', { name: 'Se alle timene dine på Min side' })).toBeNull();
  });

  it('posts to the tokenless collection path when no action path is given', async () => {
    render(<Manage />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, avbestill' }));
    await screen.findByRole('link', { name: 'Finn ny time' });
    expect(fetchMock).toHaveBeenCalledWith('/api/booking/manage', expect.anything());
  });
});

describe('ManageBooking — the calendar entry', () => {
  it('publishes a first booking under its own id, with the business name and address', () => {
    render(<Manage booking={booking({ bookedForName: 'Ola' })} siteUrl="https://example.test" />);
    const ics = calendar();
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('UID:bk_1');
    expect(ics).toContain('SEQUENCE:0');
    expect(ics).toContain('SUMMARY:Klipp for Ola hos Salong Demo');
    expect(ics).toContain('LOCATION:Torget 1\\, 0001 Oslo');
    expect(ics).not.toContain('Endre eller avbestill');
    expect(ics).toContain('PRODID:-//Salong Demo//Booking//NO');
    expect(screen.getByRole('link', { name: 'Legg til i kalender' })).toHaveAttribute(
      'download',
      'time.ics'
    );
  });

  it('updates the entry a moved booking was created under, with a root-relative link', () => {
    render(
      <Manage
        booking={booking({ rescheduledFromId: 'bk_0', serviceName: 'Unknown service' })}
        address={null}
        selfManagePath="/bestill/administrer/mt_2"
      />
    );
    const ics = calendar();
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('UID:bk_0');
    expect(ics).toContain('SEQUENCE:1');
    expect(ics).toContain('SUMMARY:Time hos Salong Demo');
    expect(ics).toContain('Endre eller avbestill: /bestill/administrer/mt_2');
    expect(ics).not.toContain('LOCATION');
  });
});

describe('ManageBooking — failures', () => {
  it('reads an unnamed route error, or an unreadable body, as an outage', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('not json');
      },
    });
    render(<Manage phone={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, avbestill' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Noe gikk galt hos oss. Prøv igjen, eller ring oss.'
    );
  });

  it('relays a named route error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict' }),
    });
    render(<Manage phone={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, avbestill' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Timen kan ikke endres nå');
  });

  it('reads a network failure on a mutation as an outage', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    render(<Manage phone={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, avbestill' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Noe gikk galt hos oss');
  });

  it('asks for no openings for a booking whose service is gone', () => {
    render(<Manage booking={booking({ serviceId: null })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));
    expect(screen.getByText(/Vi får ikke hentet ledige tider/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the failure card when the openings cannot be fetched at all', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    render(<Manage />);
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));
    expect(await screen.findByText(/Vi får ikke hentet ledige tider/)).toBeInTheDocument();
  });

  it('asks any stylist when none is booked, and takes a body without slots as none', async () => {
    render(<Manage booking={booking({ resourceId: null })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));
    expect(await screen.findByRole('heading', { name: 'Når passer det?' })).toBeInTheDocument();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/^\/api\/booking\/availability\?service_id=svc-1&/);
    expect(url).not.toContain('resource_id');
  });
});

describe('ManageBooking — after a move', () => {
  it('reschedules and keeps the old address bar when no new token came back', async () => {
    window.history.replaceState(null, '', '/bestill/administrer/mt_old');
    fetchMock.mockImplementation(async (input: unknown) =>
      String(input).includes('availability')
        ? jsonOk({ slots: [{ startTs: NOW + 73 * HOUR, resourceId: 'res-1' }] })
        : jsonOk({ ok: true })
    );
    render(<Manage />);
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));
    fireEvent.click(await screen.findByRole('button', { name: /^16:00$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bekreft endring' }));
    await waitFor(() => expect(screen.getByText(/Timen er flyttet til/)).toBeInTheDocument());
    expect(window.location.pathname).toBe('/bestill/administrer/mt_old');
  });
});
