import type { OrderingOrderCreated, OrderingSlot } from '@medalsocial/sdk';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { resolveCart } from '../../src/core/cart';
import type { PlaceOrderRequest } from '../../src/core/checkout';
import type { RouteResult } from '../../src/core/client';
import { createMoney } from '../../src/core/money';
import { Checkout, type CheckoutProps } from '../../src/react/Checkout';
import { axeViolations } from '../support/axe';
import { location } from '../support/location';
import { MENU } from '../support/menu';

const NBSP = ' ';
/** Thursday 29 October 2026, 12:00 in Oslo. */
const NOW = new Date('2026-10-29T11:00:00Z');
const CART = resolveCart(MENU, [
  {
    lineId: 'l1',
    itemId: 'burger',
    quantity: 1,
    selections: { size: ['large'] },
    note: 'Well done',
  },
  { lineId: 'l2', itemId: 'water', quantity: 2, selections: {} },
]);
const CREATED: OrderingOrderCreated = {
  order_id: 'o1',
  order_number: 'P-1029-001',
  status: 'placed',
};

function checkout(props: Partial<CheckoutProps> = {}) {
  const onPlace = vi.fn<(r: PlaceOrderRequest) => Promise<RouteResult<OrderingOrderCreated>>>(
    async () => ({
      ok: true,
      data: CREATED,
    })
  );
  const onPlaced = vi.fn();
  const onRefused = vi.fn();
  const view = render(
    <Checkout
      location={location()}
      timeZone="Europe/Oslo"
      cart={CART}
      onPlace={onPlace}
      onPlaced={onPlaced}
      onRefused={onRefused}
      now={NOW}
      {...props}
    />
  );
  return { onPlace, onPlaced, onRefused, user: userEvent.setup(), ...view };
}

async function fillDetails(
  user: ReturnType<typeof userEvent.setup>,
  details = { name: 'Kari', phone: '912 34 567' },
  nameLabel = 'Navn',
  phoneLabel = 'Mobilnummer'
) {
  await user.type(screen.getByLabelText(nameLabel), details.name);
  await user.type(screen.getByLabelText(phoneLabel), details.phone);
}

describe('Checkout', () => {
  it('places a pickup order paid at the counter, with no price and the lines from the cart', async () => {
    const { user, onPlace, onPlaced } = checkout({
      location: location({ payment_methods: { vipps: false, pay_at_counter: true } }),
    });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText('Hvordan vil du ha maten?')).toBeNull();
    await fillDetails(user);
    await user.type(screen.getByLabelText('E-post (valgfritt)'), ' kari@example.com ');
    await user.type(screen.getByLabelText('Allergier (valgfritt)'), ' Nuts ');
    await user.click(screen.getByLabelText('Jeg vil ha bestikk'));
    await user.click(screen.getByRole('button', { name: `Bestill · 229,50${NBSP}kr` }));
    expect(onPlace).toHaveBeenCalledWith({
      channel: 'takeaway',
      lines: [
        { product_id: 'burger', quantity: 1, option_ids: ['large'], note: 'Well done' },
        { product_id: 'water', quantity: 2, option_ids: [] },
      ],
      customer: { name: 'Kari', phone: '912 34 567', email: 'kari@example.com' },
      preferences: { cutlery: false, allergy_note: 'Nuts' },
      payment_method: 'pay_at_counter',
    });
    expect(onPlaced).toHaveBeenCalledWith(CREATED);
  });

  it('offers Vipps first, and dine-in at the table from the QR code', async () => {
    const { user, onPlace } = checkout({
      table: { token: 'tok', label: '12' },
      channel: 'dine_in',
    });
    expect(screen.getByRole('radio', { name: 'Spis her · Bord 12' })).toBeChecked();
    expect(screen.queryByLabelText('Jeg vil ha bestikk')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Vipps' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Hent selv' }));
    await user.click(screen.getByRole('radio', { name: 'Betal i disken' }));
    expect(screen.getByRole('button', { name: /^Bestill/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Jeg vil ha bestikk')).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Spis her · Bord 12' }));
    await user.click(screen.getByRole('radio', { name: 'Vipps' }));
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(onPlace.mock.calls[0]?.[0]).toMatchObject({
      channel: 'dine_in',
      table_token: 'tok',
      preferences: { cutlery: false },
      payment_method: 'vipps',
    });
  });

  it('shows the table alone when dine-in is the only way, and leaves dine-in out without a table', () => {
    const takeawayOff = location({
      channels: { ...location().channels, takeaway: { enabled: false, open: false } },
    });
    const { unmount } = checkout({ location: takeawayOff, table: { token: 't', label: '4' } });
    expect(screen.getByText('Bord 4')).toBeInTheDocument();
    unmount();
    checkout({ channel: 'dine_in' });
    expect(screen.queryByRole('radio', { name: /Spis her/ })).toBeNull();
  });

  it('checks the details first and focuses the first one at fault', async () => {
    const { user, onPlace } = checkout();
    await user.type(screen.getByLabelText('Mobilnummer'), '123');
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(onPlace).not.toHaveBeenCalled();
    const name = screen.getByLabelText('Navn');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Skriv navnet ditt.');
    await user.type(name, 'Kari');
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(screen.getByLabelText('Mobilnummer')).toHaveFocus();
    expect(screen.getByLabelText('Mobilnummer')).toHaveAccessibleDescription(
      'Skriv et gyldig mobilnummer.'
    );
  });

  it('error code mapped to copy', async () => {
    const { user, onPlace, onRefused, onPlaced } = checkout({
      location: location({
        channels: {
          ...location().channels,
          takeaway: { enabled: true, open: true, opens_at: '2026-10-30T09:00:00Z' },
        },
      }),
    });
    onPlace.mockResolvedValueOnce({ ok: false, error: { code: 'CLOSED', message: 'Closed.' } });
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Restauranten tar ikke imot bestillinger nå. Åpner i morgen kl. 10:00'
    );
    expect(alert).toHaveFocus();
    expect(onRefused).toHaveBeenCalledWith({ code: 'CLOSED', message: 'Closed.' });
    expect(onPlaced).not.toHaveBeenCalled();

    onPlace.mockResolvedValueOnce({
      ok: false,
      error: { code: 'SOLD_OUT', message: 'x', details: { ids: ['burger'] } },
    });
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Noe i bestillingen er utsolgt.');

    onPlace.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Noe gikk galt. Prøv igjen om litt.');
  });

  it('says the order was received when the page cannot move on, and keeps the form locked', async () => {
    const { user, onPlaced } = checkout();
    onPlaced.mockImplementation(() => {
      throw new Error('navigation failed');
    });
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Bestillingen ${CREATED.order_number} er mottatt. Last inn siden på nytt for å se den.`
    );
    expect(screen.getByLabelText('Navn')).toBeDisabled();
  });

  it('says the order was received when an async onPlaced rejects', async () => {
    const { user, onPlaced } = checkout();
    onPlaced.mockImplementation(async () => {
      throw new Error('router push failed');
    });
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Bestillingen ${CREATED.order_number} er mottatt.`
    );
    expect(screen.getByLabelText('Navn')).toBeDisabled();
  });

  it('locks every field while the order is on its way, and unlocks it when refused', async () => {
    const { user, onPlace } = checkout();
    let answer: (result: RouteResult<OrderingOrderCreated>) => void = () => {};
    onPlace.mockImplementationOnce(
      () =>
        new Promise((done) => {
          answer = done;
        })
    );
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    const name = screen.getByLabelText('Navn');
    expect(name).toBeDisabled();
    expect(screen.getByLabelText('Mobilnummer')).toBeDisabled();
    // A guest typing while it is sent changes nothing on the order that went.
    await user.type(name, 'X');
    expect(name).toHaveValue('Kari');
    expect(onPlace.mock.calls[0]?.[0].customer.name).toBe('Kari');
    await act(async () =>
      answer({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } })
    );
    expect(name).toBeEnabled();
    await user.type(name, 'n');
    expect(name).toHaveValue('Karin');
  });

  it('puts a refused detail on its field', async () => {
    const { user, onPlace } = checkout();
    onPlace.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_CUSTOMER', message: 'x', details: { reason: 'email' } },
    });
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(screen.getByLabelText('E-post (valgfritt)')).toHaveFocus();
    expect(screen.getByLabelText('E-post (valgfritt)')).toHaveAccessibleDescription(
      'Vi sender kvitteringen hit. Skriv en gyldig e-postadresse, eller la feltet stå tomt.'
    );
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    onPlace.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_CUSTOMER', message: 'x', details: { reason: 'door_code' } },
    });
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    // No door code field on a pickup form: the message goes above the button.
    expect(screen.getByRole('alert')).toHaveTextContent('Dørkoden kan være opptil 20 tegn.');

    onPlace.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_CUSTOMER', message: 'x', details: { reason: 'door' } },
    });
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Sjekk opplysningene dine.');
  });

  it('sends one order however often the button is pressed', async () => {
    let finish: (r: RouteResult<OrderingOrderCreated>) => void = () => {};
    const { user, onPlace, onPlaced } = checkout();
    onPlace.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await fillDetails(user);
    const button = screen.getByRole('button', { name: /Betal med Vipps/ });
    await user.click(button);
    expect(button).toHaveTextContent('Sender bestillingen …');
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onPlace).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: true, data: CREATED }));
    expect(onPlaced).toHaveBeenCalledOnce();
  });

  it('orders for a slot on a later day', async () => {
    const slots: OrderingSlot[] = [
      { start: '2026-10-30T16:00:00Z', end: '2026-10-30T16:15:00Z' },
      { start: '2026-10-30T16:15:00Z', end: '2026-10-30T16:30:00Z' },
    ];
    const loadSlots = vi.fn(async ({ date }: { date: string }) =>
      date === '2026-10-30' ? slots : []
    );
    const { user, onPlace } = checkout({ loadSlots, allowScheduled: true });
    await user.click(screen.getByRole('radio', { name: 'Velg tidspunkt' }));
    const day = screen.getByLabelText('Dag');
    expect([...(day as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'I dag',
      'I morgen',
      'lørdag 31. oktober',
    ]);
    await waitFor(() =>
      expect(screen.getByText('Ingen ledige tider denne dagen.')).toBeInTheDocument()
    );
    await user.selectOptions(day, '2026-10-30');
    const time = screen.getByLabelText('Tidspunkt');
    await waitFor(() => expect(time).toBeEnabled());
    expect([...(time as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Velg et tidspunkt.',
      '17:00',
      '17:15',
    ]);
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(time).toHaveFocus();
    expect(time).toHaveAttribute('aria-invalid', 'true');
    const describedBy = (time.getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
      '',
      'Velg et tidspunkt.',
    ]);
    await user.selectOptions(time, '2026-10-30T16:15:00Z');
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(onPlace.mock.calls[0]?.[0].timing).toEqual({
      kind: 'scheduled',
      at: '2026-10-30T16:15:00Z',
    });
    expect(loadSlots).toHaveBeenCalledWith({ channel: 'takeaway', date: '2026-10-29' });
  });

  it('keeps the chosen time when the page passes a new loadSlots function', async () => {
    const slots: OrderingSlot[] = [{ start: '2026-10-29T16:00:00Z', end: '2026-10-29T16:15:00Z' }];
    const first = vi.fn(async () => slots);
    const { user, rerender, onPlace, onPlaced, onRefused } = checkout({
      loadSlots: first,
      allowScheduled: true,
    });
    await user.click(screen.getByRole('radio', { name: 'Velg tidspunkt' }));
    const time = screen.getByLabelText('Tidspunkt');
    await waitFor(() => expect(time).toBeEnabled());
    await user.selectOptions(time, '2026-10-29T16:00:00Z');
    // A parent re-render with a new loader function: same channel and day.
    const second = vi.fn(async () => slots);
    rerender(
      <Checkout
        location={location()}
        timeZone="Europe/Oslo"
        cart={CART}
        onPlace={onPlace}
        onPlaced={onPlaced}
        onRefused={onRefused}
        now={NOW}
        loadSlots={second}
        allowScheduled
      />
    );
    expect(screen.getByLabelText('Tidspunkt')).toHaveValue('2026-10-29T16:00:00Z');
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledOnce();
  });

  it('keeps only the latest day’s slots, in English, and goes back to as soon as possible', async () => {
    const answers: Record<string, (s: OrderingSlot[]) => void> = {};
    const failures: Record<string, (e: Error) => void> = {};
    const loadSlots = vi.fn(
      ({ date }: { date: string }) =>
        new Promise<OrderingSlot[]>((resolve, reject) => {
          answers[date] = resolve;
          failures[date] = reject;
        })
    );
    const { user, onPlace } = checkout({ loadSlots, allowScheduled: true, locale: 'en' });
    await user.click(screen.getByRole('radio', { name: 'Choose a time' }));
    const day = screen.getByLabelText('Day');
    expect([...(day as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Today',
      'Tomorrow',
      'Saturday 31 October',
    ]);
    await user.selectOptions(day, '2026-10-31');
    await user.selectOptions(day, '2026-10-30');
    expect(loadSlots.mock.calls.map((c) => c[0].date)).toEqual([
      '2026-10-29',
      '2026-10-31',
      '2026-10-30',
    ]);
    await act(async () => failures['2026-10-31']?.(new Error('late')));
    await act(async () =>
      answers['2026-10-29']?.([{ start: '2026-10-29T15:00:00Z', end: '2026-10-29T15:15:00Z' }])
    );
    expect(screen.getByText('Finding free times …')).toBeInTheDocument();
    await act(async () =>
      answers['2026-10-30']?.([{ start: '2026-10-30T15:00:00Z', end: '2026-10-30T15:15:00Z' }])
    );
    expect(
      [...(screen.getByLabelText('Time') as HTMLSelectElement).options].map((o) => o.text)
    ).toEqual(['Please choose a time.', '16:00']);
    await user.click(screen.getByRole('radio', { name: 'As soon as possible' }));
    expect(screen.queryByLabelText('Time')).toBeNull();
    await fillDetails(user, { name: 'Kari', phone: '91234567' }, 'Name', 'Mobile number');
    await user.click(screen.getByRole('button', { name: /Pay with Vipps/ }));
    expect(onPlace.mock.calls[0]?.[0].timing).toBeUndefined();
  });

  it('refuses an allergy note over the limit before sending', async () => {
    const { user, onPlace } = checkout({
      initial: { name: 'Kari', phone: '91234567', allergyNote: 'x'.repeat(201) },
    });
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(onPlace).not.toHaveBeenCalled();
    const note = screen.getByLabelText('Allergier (valgfritt)');
    expect(note).toHaveFocus();
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Allerginotatet kan være opptil 200 tegn.')).toBeInTheDocument();
  });

  it('shows the loading line, and reads a failed slot load as none', async () => {
    let fail: (e: Error) => void = () => {};
    const loadSlots = vi.fn(() => new Promise<OrderingSlot[]>((_r, reject) => (fail = reject)));
    const closedNow = location({
      channels: {
        ...location().channels,
        takeaway: { enabled: true, open: false, opens_at: '2026-10-30T09:00:00Z' },
      },
    });
    const { unmount } = checkout({ loadSlots, allowScheduled: true, location: closedNow });
    // Closed now, but it takes orders ahead: only a slot, no «as soon as possible».
    expect(screen.queryByRole('radio', { name: 'Så snart som mulig' })).toBeNull();
    expect(screen.getByText('Henter ledige tider …')).toBeInTheDocument();
    await act(async () => fail(new Error('down')));
    expect(screen.getByText('Ingen ledige tider denne dagen.')).toBeInTheDocument();
    unmount();
  });

  it('offers no chosen time unless scheduled orders are allowed', () => {
    const closedNow = location({
      channels: {
        ...location().channels,
        takeaway: { enabled: true, open: false, opens_at: '2026-10-30T09:00:00Z' },
      },
    });
    const { unmount } = checkout({ loadSlots: async () => [] });
    expect(screen.queryByRole('radio', { name: 'Velg tidspunkt' })).toBeNull();
    unmount();
    checkout({ loadSlots: async () => [], location: closedNow });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Restauranten tar ikke imot bestillinger nå.'
    );
    expect(screen.queryByLabelText('Tidspunkt')).toBeNull();
  });

  it('closed shows next opening', () => {
    const closedNow = location({
      channels: {
        ...location().channels,
        takeaway: { enabled: true, open: false, opens_at: '2026-10-30T09:00:00Z' },
      },
    });
    checkout({ location: closedNow });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Restauranten tar ikke imot bestillinger nå.Åpner i morgen kl. 10:00'
    );
    expect(screen.queryByLabelText('Navn')).toBeNull();
    expect(screen.getByRole('button', { name: /Betal med Vipps/ })).toBeDisabled();
  });

  it('cannot order with no way to get the food, no way to pay or an empty cart', () => {
    const none = location({
      channels: { ...location().channels, takeaway: { enabled: false, open: false } },
    });
    const { unmount } = checkout({ location: none });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Restauranten tar ikke imot bestillinger nå.'
    );
    unmount();
    const { unmount: u2 } = checkout({
      location: location({ payment_methods: { vipps: false, pay_at_counter: false } }),
    });
    expect(screen.getByRole('button', { name: /Bestill/ })).toBeDisabled();
    u2();
    checkout({ cart: resolveCart(MENU, []) });
    expect(screen.getByRole('button', { name: /Betal med Vipps/ })).toBeDisabled();
  });

  it('starts from a returning guest’s details, in English with the site money', async () => {
    const { user, onPlace } = checkout({
      initial: {
        name: 'Kari',
        phone: '91234567',
        email: 'k@example.com',
        allergyNote: 'Nuts',
        cutlery: false,
      },
      locale: 'en',
      money: createMoney({ locale: 'en-GB', currency: 'GBP' }),
      labels: { payWithVipps: 'Pay now · {price}' },
    });
    expect(screen.getByLabelText('I would like cutlery')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Pay now · £229.50' }));
    expect(onPlace.mock.calls[0]?.[0]).toMatchObject({
      customer: { name: 'Kari', phone: '91234567', email: 'k@example.com' },
      preferences: { cutlery: false, allergy_note: 'Nuts' },
    });
  });

  it('uses the clock when no `now` is given', () => {
    render(
      <Checkout
        location={location()}
        timeZone="Europe/Oslo"
        cart={CART}
        onPlace={vi.fn()}
        onPlaced={vi.fn()}
        loadSlots={async () => []}
        allowScheduled
      />
    );
    expect(screen.getByRole('radio', { name: 'Så snart som mulig' })).toBeChecked();
  });

  it('has no axe violations', async () => {
    const { container, user } = checkout({
      loadSlots: async () => [],
      allowScheduled: true,
      table: { token: 't', label: '1' },
    });
    await user.click(screen.getByRole('radio', { name: 'Velg tidspunkt' }));
    await user.click(screen.getByRole('button', { name: /Betal med Vipps/ }));
    expect(await axeViolations(container)).toEqual([]);
  });
});
