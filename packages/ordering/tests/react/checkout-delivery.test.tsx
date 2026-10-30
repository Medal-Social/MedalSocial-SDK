import type {
  DeliveryAddressSuggestion,
  DeliveryQuote,
  DeliveryResolvedAddress,
  OrderingOrderCreated,
} from '@medalsocial/sdk';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCart } from '../../src/core/cart';
import type { PlaceOrderRequest } from '../../src/core/checkout';
import type { RouteResult } from '../../src/core/client';
import { Checkout, type CheckoutProps } from '../../src/react/Checkout';
import { axeViolations } from '../support/axe';
import { location } from '../support/location';
import { MENU } from '../support/menu';

/** The money's space; Testing Library's text matching reads it as a plain space. */
const NBSP = '\u00A0';
/** Thursday 29 October 2026, 12:00 in Oslo. */
const NOW = new Date('2026-10-29T11:00:00Z');
const CART = resolveCart(MENU, [
  { lineId: 'l1', itemId: 'burger', quantity: 1, selections: { size: ['large'] } },
  { lineId: 'l2', itemId: 'water', quantity: 2, selections: {} },
]);
const CART_TOTAL = CART.totalOre;
const CREATED: OrderingOrderCreated = {
  order_id: 'o1',
  order_number: 'P-1029-001',
  status: 'awaiting_payment',
};
const DELIVERS = location({
  channels: { ...location().channels, delivery: { enabled: true, open: true } },
});
const SUGGESTIONS: DeliveryAddressSuggestion[] = [
  { id: 'kv_1', label: 'Storgata 1', secondary: '0155 Oslo' },
];
const ADDRESS: DeliveryResolvedAddress = {
  address_id: 'addr_1',
  label: 'Storgata 1, 0155 Oslo',
  street: 'Storgata',
  house_number: '1',
  post_code: '0155',
  city: 'Oslo',
  lat: 59.91,
  lon: 10.75,
  source: 'kartverket',
};

/** A quote good for `validMs` more from the real clock. */
function quote(overrides: Partial<DeliveryQuote> = {}, validMs = 5 * 60_000): DeliveryQuote {
  return {
    quote_id: 'q_1',
    customer_fee: { amount: 5900, currency: 'NOK' },
    cost: { amount: 7900, currency: 'NOK' },
    eta_minutes: 35,
    delivered_by: '2026-10-29T17:35:00Z',
    valid_until: new Date(Date.now() + validMs).toISOString(),
    address: 'Storgata 1, 0155 Oslo',
    venue_id: 'v_1',
    ...overrides,
  };
}

type QuoteFn = NonNullable<CheckoutProps['quoteDelivery']>;
type PlaceFn = (r: PlaceOrderRequest) => Promise<RouteResult<OrderingOrderCreated>>;

afterEach(() => {
  vi.useRealTimers();
});

function checkout(props: Partial<CheckoutProps> = {}) {
  const suggestAddress = vi.fn<NonNullable<CheckoutProps['suggestAddress']>>(async () => ({
    ok: true,
    data: SUGGESTIONS,
  }));
  const resolveAddress = vi.fn<NonNullable<CheckoutProps['resolveAddress']>>(async () => ({
    ok: true,
    data: ADDRESS,
  }));
  const quoteDelivery = vi.fn<QuoteFn>(async () => ({ ok: true, data: quote() }));
  const onPlace = vi.fn<PlaceFn>(async () => ({ ok: true, data: CREATED }));
  const onPlaced = vi.fn();
  const view = render(
    <Checkout
      location={DELIVERS}
      timeZone="Europe/Oslo"
      cart={CART}
      channel="delivery"
      suggestAddress={suggestAddress}
      resolveAddress={resolveAddress}
      quoteDelivery={quoteDelivery}
      onPlace={onPlace}
      onPlaced={onPlaced}
      now={NOW}
      {...props}
    />
  );
  return {
    suggestAddress,
    resolveAddress,
    quoteDelivery,
    onPlace,
    onPlaced,
    user: userEvent.setup(),
    ...view,
  };
}

async function chooseAddress(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('combobox', { name: 'Adresse' }), 'storgata 1');
  await user.click(await screen.findByRole('option'));
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Navn'), 'Kari');
  await user.type(screen.getByLabelText('Mobilnummer'), '91234567');
}

const orderButton = () => screen.getByRole('button', { name: /Betal med Vipps|Henter|Sender/ });

describe('Checkout — delivery', () => {
  it('quotes the resolved address with the subtotal, shows the fee, and the total includes it', async () => {
    const { user, quoteDelivery, onPlace, onPlaced } = checkout();
    expect(screen.getByRole('radio', { name: 'Levering' })).toBeChecked();
    // Vipps only: no choice of payment.
    expect(screen.queryByRole('radio', { name: 'Betal i disken' })).toBeNull();
    expect(screen.getByText('Velg adressen fra listen for å se leveringsprisen.')).toBeVisible();
    expect(orderButton()).toBeDisabled();
    await chooseAddress(user);
    expect(quoteDelivery).toHaveBeenCalledWith({ address_id: 'addr_1', order_total: CART_TOTAL });
    expect(await screen.findByText(`Levering · 59 kr`)).toBeInTheDocument();
    expect(screen.getByText('Levert ca. 18:35')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: `Betal med Vipps · 288,50${NBSP}kr` });
    expect(button).toBeEnabled();

    await user.type(screen.getByLabelText('Etasje (valgfritt)'), ' 3 ');
    const door = screen.getByLabelText('Dørkode (valgfritt)');
    expect(door).toHaveAttribute('autocomplete', 'off');
    await user.type(door, '1234');
    await user.type(screen.getByLabelText('Beskjed til budet (valgfritt)'), ' Ring på ');
    await user.click(screen.getByLabelText('Lever på døren'));
    await fillDetails(user);
    await user.click(button);
    expect(onPlace).toHaveBeenCalledWith({
      channel: 'delivery',
      lines: [
        { product_id: 'burger', quantity: 1, option_ids: ['large'] },
        { product_id: 'water', quantity: 2, option_ids: [] },
      ],
      customer: { name: 'Kari', phone: '91234567' },
      preferences: { cutlery: true, no_contact: true },
      payment_method: 'vipps',
      delivery: {
        verified_address_id: 'addr_1',
        quote_id: 'q_1',
        floor: '3',
        door_code: '1234',
        comment: 'Ring på',
      },
    });
    expect(onPlaced).toHaveBeenCalledWith(CREATED);
    expect(quoteDelivery).toHaveBeenCalledOnce();
  });

  it('shows free delivery, and leaves empty door details out', async () => {
    const { user, quoteDelivery, onPlace } = checkout({ locale: 'en' });
    quoteDelivery.mockResolvedValueOnce({
      ok: true,
      data: quote({ customer_fee: null, delivered_by: null }),
    });
    await user.type(screen.getByRole('combobox', { name: 'Address' }), 'storgata 1');
    await user.click(await screen.findByRole('option'));
    expect(await screen.findByText('Free delivery')).toBeInTheDocument();
    expect(screen.queryByText(/Delivered around/)).toBeNull();
    await user.type(screen.getByLabelText('Name'), 'Kari');
    await user.type(screen.getByLabelText('Mobile number'), '91234567');
    await user.click(screen.getByRole('button', { name: /^Pay with Vipps · NOK.229\.50$/ }));
    expect(onPlace.mock.calls[0]?.[0]).toMatchObject({
      preferences: { cutlery: true, no_contact: false },
      delivery: { verified_address_id: 'addr_1', quote_id: 'q_1' },
    });
    expect(Object.keys(onPlace.mock.calls[0]?.[0].delivery ?? {})).toEqual([
      'verified_address_id',
      'quote_id',
    ]);
  });

  it('keeps the button off while the price is on its way', async () => {
    let finish: (r: RouteResult<DeliveryQuote>) => void = () => {};
    const quoteDelivery = vi.fn<QuoteFn>(() => new Promise((r) => (finish = r)));
    const { user } = checkout({ quoteDelivery });
    await chooseAddress(user);
    await waitFor(() => expect(quoteDelivery).toHaveBeenCalled());
    // Under the address, and on the button.
    expect(screen.getAllByText('Henter leveringspris …')).toHaveLength(2);
    expect(orderButton()).toBeDisabled();
    await act(async () => finish({ ok: true, data: quote() }));
    expect(orderButton()).toBeEnabled();
  });

  it('asks again when the subtotal changes, and never orders on the old price', async () => {
    let finish: (r: RouteResult<DeliveryQuote>) => void = () => {};
    const { user, quoteDelivery, rerender, onPlace } = checkout();
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    quoteDelivery.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const bigger = resolveCart(MENU, [
      { lineId: 'l1', itemId: 'burger', quantity: 3, selections: { size: ['large'] } },
    ]);
    rerender(
      <Checkout
        location={DELIVERS}
        timeZone="Europe/Oslo"
        cart={bigger}
        channel="delivery"
        suggestAddress={vi.fn()}
        resolveAddress={vi.fn()}
        quoteDelivery={quoteDelivery}
        onPlace={onPlace}
        onPlaced={vi.fn()}
        now={NOW}
      />
    );
    await waitFor(() => expect(quoteDelivery).toHaveBeenCalledTimes(2));
    expect(quoteDelivery.mock.calls[1]?.[0]).toEqual({
      address_id: 'addr_1',
      order_total: bigger.totalOre,
    });
    expect(orderButton()).toBeDisabled();
    await act(async () =>
      finish({ ok: true, data: quote({ quote_id: 'q_2', customer_fee: null }) })
    );
    expect(screen.getByText('Gratis levering')).toBeInTheDocument();
    expect(orderButton()).toBeEnabled();
  });

  it('drops a price that comes back for an older cart', async () => {
    const answers: ((r: RouteResult<DeliveryQuote>) => void)[] = [];
    const quoteDelivery = vi.fn<QuoteFn>(() => new Promise((r) => answers.push(r)));
    const { user, rerender, resolveAddress, suggestAddress } = checkout({ quoteDelivery });
    await chooseAddress(user);
    await waitFor(() => expect(answers).toHaveLength(1));
    const bigger = resolveCart(MENU, [
      { lineId: 'l1', itemId: 'burger', quantity: 3, selections: { size: ['large'] } },
    ]);
    const view = (cart: typeof CART) => (
      <Checkout
        location={DELIVERS}
        timeZone="Europe/Oslo"
        cart={cart}
        channel="delivery"
        suggestAddress={suggestAddress}
        resolveAddress={resolveAddress}
        quoteDelivery={quoteDelivery}
        onPlace={vi.fn()}
        onPlaced={vi.fn()}
        now={NOW}
      />
    );
    rerender(view(bigger));
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[0]?.({ ok: true, data: quote({ quote_id: 'q_old' }) }));
    expect(orderButton()).toBeDisabled();
    await act(async () =>
      answers[1]?.({ ok: true, data: quote({ customer_fee: { amount: 100, currency: 'NOK' } }) })
    );
    expect(screen.getByText('Levering · 1 kr')).toBeInTheDocument();
  });

  it('sends nothing when the form is sent before there is a price', async () => {
    const { container, onPlace } = checkout({
      initial: { name: 'Kari', phone: '91234567' },
    });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(onPlace).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('asks again on its own before the price runs out, and stops when it unmounts', async () => {
    const quoteDelivery = vi.fn<QuoteFn>(async () => ({
      ok: true,
      data: quote({}, 90_000 + 150),
    }));
    const { user, unmount } = checkout({ quoteDelivery });
    await chooseAddress(user);
    await waitFor(() => expect(quoteDelivery).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    unmount();
    const calls = quoteDelivery.mock.calls.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(quoteDelivery).toHaveBeenCalledTimes(calls);
  });

  it.each(['QUOTE_EXPIRED', 'QUOTE_NOT_USABLE'] as const)(
    'on %s asks for a new price and lets the guest confirm it',
    async (code) => {
      const { user, quoteDelivery, onPlace, onPlaced } = checkout();
      await chooseAddress(user);
      await screen.findByText(`Levering · 59 kr`);
      await fillDetails(user);
      onPlace.mockResolvedValueOnce({ ok: false, error: { code, message: 'x' } });
      quoteDelivery.mockResolvedValueOnce({
        ok: true,
        data: quote({ quote_id: 'q_2', customer_fee: { amount: 4900, currency: 'NOK' } }),
      });
      await user.click(orderButton());
      const alert = await screen.findByText(
        `Ny leveringspris: 49 kr. Trykk bestill igjen for å godta.`
      );
      expect(alert).toHaveFocus();
      expect(quoteDelivery).toHaveBeenCalledTimes(2);
      expect(onPlaced).not.toHaveBeenCalled();
      expect(screen.getByText(`Levering · 49 kr`)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: `Betal med Vipps · 278,50${NBSP}kr` }));
      expect(onPlace).toHaveBeenCalledTimes(2);
      expect(onPlace.mock.calls[1]?.[0].delivery?.quote_id).toBe('q_2');
      expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    }
  );

  it('a price that ran out while the tab slept is asked for again before ordering', async () => {
    const { user, quoteDelivery, onPlace } = checkout();
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    await fillDetails(user);
    quoteDelivery.mockResolvedValueOnce({
      ok: true,
      data: quote({ quote_id: 'q_2' }, 10 * 60_000),
    });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 4 * 60_000 });
    await user.click(orderButton());
    expect(
      await screen.findByText(`Ny leveringspris: 59 kr. Trykk bestill igjen for å godta.`)
    ).toBeInTheDocument();
    expect(onPlace).not.toHaveBeenCalled();
    await user.click(orderButton());
    expect(onPlace.mock.calls[0]?.[0].delivery?.quote_id).toBe('q_2');
  });

  it('a price already due on arrival is asked for once at the press, never in a loop', async () => {
    const { user, quoteDelivery, onPlace } = checkout();
    // Valid for 60 s: inside the 90 s margin the moment it arrives (a fast clock, a short validity).
    quoteDelivery.mockResolvedValue({ ok: true, data: quote({}, 60_000) });
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(quoteDelivery).toHaveBeenCalledTimes(1);
    await fillDetails(user);
    await user.click(orderButton());
    expect(quoteDelivery).toHaveBeenCalledTimes(2);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('a price without valid_until is ordered with at the press: no timer, no new price', async () => {
    const { user, quoteDelivery, onPlace } = checkout();
    quoteDelivery.mockResolvedValue({ ok: true, data: quote({ valid_until: null }) });
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    await fillDetails(user);
    await user.click(orderButton());
    expect(onPlace).toHaveBeenCalledOnce();
    expect(onPlace.mock.calls[0]?.[0].delivery?.quote_id).toBe('q_1');
    expect(quoteDelivery).toHaveBeenCalledOnce();
  });

  it('a late price for a subtotal the cart left does not replace the one that fits again', async () => {
    const answers: ((r: RouteResult<DeliveryQuote>) => void)[] = [];
    const quoteDelivery = vi.fn<QuoteFn>(() => new Promise((r) => answers.push(r)));
    const { user, rerender, resolveAddress, suggestAddress, onPlace } = checkout({
      quoteDelivery,
    });
    await chooseAddress(user);
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => answers[0]?.({ ok: true, data: quote() }));
    await screen.findByText(`Levering · 59 kr`);
    const bigger = resolveCart(MENU, [
      { lineId: 'l1', itemId: 'burger', quantity: 3, selections: { size: ['large'] } },
    ]);
    const view = (cart: typeof CART) => (
      <Checkout
        location={DELIVERS}
        timeZone="Europe/Oslo"
        cart={cart}
        channel="delivery"
        suggestAddress={suggestAddress}
        resolveAddress={resolveAddress}
        quoteDelivery={quoteDelivery}
        onPlace={onPlace}
        onPlaced={vi.fn()}
        now={NOW}
      />
    );
    rerender(view(bigger));
    await waitFor(() => expect(answers).toHaveLength(2));
    // Back to the first cart: its price still fits, and the bigger cart's answer is stale.
    rerender(view(CART));
    expect(screen.getByText(`Levering · 59 kr`)).toBeInTheDocument();
    await act(async () =>
      answers[1]?.({ ok: true, data: quote({ quote_id: 'q_big', customer_fee: null }) })
    );
    expect(screen.getByText(`Levering · 59 kr`)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: `Betal med Vipps · 288,50${NBSP}kr` });
    expect(button).toBeEnabled();
    await fillDetails(user);
    await user.click(button);
    expect(onPlace).toHaveBeenCalledOnce();
    expect(onPlace.mock.calls[0]?.[0].delivery?.quote_id).toBe('q_1');
    expect(answers).toHaveLength(2);
  });

  it('says why there is no price, and offers to try again when it may help', async () => {
    const { user, quoteDelivery } = checkout();
    quoteDelivery.mockResolvedValueOnce({
      ok: false,
      error: { code: 'QUOTE_TIMEOUT', message: 'x' },
    });
    await chooseAddress(user);
    expect(
      await screen.findByText('Det tok for lang tid å hente leveringsprisen. Prøv igjen.')
    ).toBeInTheDocument();
    expect(orderButton()).toBeDisabled();
    quoteDelivery.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(await screen.findByText('Noe gikk galt. Prøv igjen om litt.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(await screen.findByText(`Levering · 59 kr`)).toBeInTheDocument();
    expect(quoteDelivery).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['ADDRESS_NOT_DELIVERABLE', 'Vi kan ikke levere til denne adressen nå.'],
    ['DELIVERY_UNAVAILABLE', 'Levering er ikke tilgjengelig akkurat nå.'],
    ['ADDRESS_NOT_VERIFIED', 'Vi fant ikke adressen. Husk husnummer.'],
  ] as const)('%s is said in plain words, with nothing to retry', async (code, words) => {
    const { user, quoteDelivery } = checkout();
    quoteDelivery.mockResolvedValueOnce({ ok: false, error: { code, message: 'x' } });
    await chooseAddress(user);
    expect(await screen.findByText(new RegExp(`^${words}`))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prøv igjen' })).toBeNull();
    expect(orderButton()).toBeDisabled();
  });

  it('a changed address takes the price away until a new one is picked', async () => {
    const { user } = checkout();
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    await user.type(screen.getByRole('combobox'), 'x');
    expect(screen.getByText('Velg adressen fra listen for å se leveringsprisen.')).toBeVisible();
    expect(orderButton()).toBeDisabled();
  });

  it('an edited address takes a failed price’s words and its retry away', async () => {
    const { user, quoteDelivery } = checkout();
    quoteDelivery.mockResolvedValueOnce({
      ok: false,
      error: { code: 'QUOTE_TIMEOUT', message: 'x' },
    });
    await chooseAddress(user);
    const words = 'Det tok for lang tid å hente leveringsprisen. Prøv igjen.';
    expect(await screen.findByText(words)).toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), 'x');
    expect(screen.queryByText(words)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prøv igjen' })).toBeNull();
    expect(screen.getByText('Velg adressen fra listen for å se leveringsprisen.')).toBeVisible();
  });

  it('an edited address drops a price still on its way', async () => {
    let finish: (r: RouteResult<DeliveryQuote>) => void = () => {};
    const quoteDelivery = vi.fn<QuoteFn>(() => new Promise((r) => (finish = r)));
    const { user } = checkout({ quoteDelivery });
    await chooseAddress(user);
    await waitFor(() => expect(quoteDelivery).toHaveBeenCalled());
    await user.type(screen.getByRole('combobox'), 'x');
    expect(screen.queryByText('Henter leveringspris …')).toBeNull();
    await act(async () => finish({ ok: true, data: quote() }));
    expect(screen.queryByText(`Levering · 59 kr`)).toBeNull();
    expect(orderButton()).toBeDisabled();
  });

  it('keeps the price when the guest looks at pickup and comes back', async () => {
    const { user, quoteDelivery, onPlace } = checkout();
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    await user.click(screen.getByRole('radio', { name: 'Hent selv' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Betal i disken' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Levering' }));
    expect(screen.getByRole('combobox')).toHaveValue('Storgata 1, 0155 Oslo');
    expect(screen.getByText(`Levering · 59 kr`)).toBeInTheDocument();
    expect(quoteDelivery).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('radio', { name: 'Hent selv' }));
    await user.click(screen.getByRole('radio', { name: 'Betal i disken' }));
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: `Bestill · 229,50${NBSP}kr` }));
    expect(onPlace.mock.calls[0]?.[0]).not.toHaveProperty('delivery');
    expect(onPlace.mock.calls[0]?.[0].preferences).toEqual({ cutlery: true });
    // Back on delivery, an edited address takes the price away again.
    await user.click(screen.getByRole('radio', { name: 'Levering' }));
    await user.type(screen.getByRole('combobox'), 'x');
    expect(screen.getByText('Velg adressen fra listen for å se leveringsprisen.')).toBeVisible();
  });

  it('checks the door details before sending, as the API does', async () => {
    const { user, onPlace } = checkout({
      initial: {
        name: 'Kari',
        phone: '91234567',
        floor: 'x'.repeat(21),
        doorCode: 'x'.repeat(21),
        deliveryComment: 'x'.repeat(501),
        contactless: true,
      },
    });
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    expect(screen.getByLabelText('Lever på døren')).toBeChecked();
    await user.click(orderButton());
    expect(onPlace).not.toHaveBeenCalled();
    const floor = screen.getByLabelText('Etasje (valgfritt)');
    expect(floor).toHaveFocus();
    expect(floor).toHaveAccessibleDescription('Etasje kan være opptil 20 tegn.');
    await user.clear(floor);
    await user.click(orderButton());
    expect(screen.getByLabelText('Dørkode (valgfritt)')).toHaveFocus();
    expect(screen.getByText('Dørkoden kan være opptil 20 tegn.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Dørkode (valgfritt)'));
    await user.click(orderButton());
    const comment = screen.getByLabelText('Beskjed til budet (valgfritt)');
    expect(comment).toHaveFocus();
    expect(comment).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Beskjeden til budet kan være opptil 500 tegn.')).toBeInTheDocument();
  });

  it('puts a refused door detail on its field', async () => {
    const { user, onPlace } = checkout();
    onPlace.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_CUSTOMER', message: 'x', details: { reason: 'door_code' } },
    });
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    await fillDetails(user);
    await user.click(orderButton());
    expect(screen.getByLabelText('Dørkode (valgfritt)')).toHaveFocus();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('is not offered without all three delivery props, without Vipps, or when switched off', () => {
    const { unmount } = checkout({ quoteDelivery: undefined });
    expect(screen.queryByRole('radio', { name: 'Levering' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    unmount();
    const { unmount: u2 } = checkout({ suggestAddress: undefined });
    expect(screen.queryByRole('radio', { name: 'Levering' })).toBeNull();
    u2();
    const { unmount: u3 } = checkout({ resolveAddress: undefined });
    expect(screen.queryByRole('radio', { name: 'Levering' })).toBeNull();
    u3();
    const { unmount: u4 } = checkout({
      location: { ...DELIVERS, payment_methods: { vipps: false, pay_at_counter: true } },
    });
    expect(screen.queryByRole('radio', { name: 'Levering' })).toBeNull();
    u4();
    checkout({ location: location() });
    expect(screen.queryByRole('radio', { name: 'Levering' })).toBeNull();
  });

  it('delivery closed now shows the closed notice: it is as soon as possible only', () => {
    checkout({
      location: location({
        channels: {
          ...location().channels,
          takeaway: { enabled: false, open: false },
          dine_in: { enabled: false, open: false },
          delivery: { enabled: true, open: false, opens_at: '2026-10-30T09:00:00Z' },
        },
      }),
      allowScheduled: true,
      loadSlots: async () => [],
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Restauranten tar ikke imot bestillinger nå.'
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('asks for no price for an empty cart', async () => {
    const { user, quoteDelivery } = checkout({ cart: resolveCart(MENU, []) });
    await chooseAddress(user);
    await new Promise((r) => setTimeout(r, 50));
    expect(quoteDelivery).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container, user } = checkout();
    await chooseAddress(user);
    await screen.findByText(`Levering · 59 kr`);
    await user.click(orderButton());
    expect(await axeViolations(container)).toEqual([]);
  });
});
