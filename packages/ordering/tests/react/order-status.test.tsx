import type { OrderingOrderStatusView } from '@medalsocial/sdk';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteResult } from '../../src/core/client';
import { STATUS_POLL_MS } from '../../src/core/status';
import { OrderStatus } from '../../src/react/OrderStatus';
import { axeViolations } from '../support/axe';

function view(overrides: Partial<OrderingOrderStatusView> = {}): OrderingOrderStatusView {
  return {
    order_id: 'o1',
    order_number: 'P-1029-004',
    status: 'placed',
    payment: { method: 'vipps', state: 'reserved' },
    updated_at: '2026-10-29T11:00:00Z',
    timeline: [{ status: 'placed', at: '2026-10-29T11:00:00Z' }],
    ...overrides,
  };
}

type Load = (id: string, signal: AbortSignal) => Promise<RouteResult<OrderingOrderStatusView>>;

function answers(...results: Array<RouteResult<OrderingOrderStatusView> | Error>) {
  const load = vi.fn<Load>();
  for (const result of results) {
    if (result instanceof Error) load.mockRejectedValueOnce(result);
    else load.mockResolvedValueOnce(result);
  }
  return load;
}

const ok = (overrides: Partial<OrderingOrderStatusView> = {}) => ({
  ok: true as const,
  data: view(overrides),
});

async function tick(ms = STATUS_POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('OrderStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('status polls then stops', async () => {
    const load = answers(
      ok(),
      ok({ status: 'accepted', ready_at: '2026-10-29T11:25:00Z' }),
      ok({ status: 'ready' }),
      ok({ status: 'handed_over' })
    );
    render(<OrderStatus orderId="o1" load={load} />);
    await tick(0);
    expect(screen.getByRole('heading')).toHaveTextContent('Bestilling P-1029-004');
    expect(screen.getByRole('status')).toHaveTextContent('Mottatt');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]).toBe('o1');

    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('GodkjentKlar ca. kl. 12:25');
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((s) => s.getAttribute('aria-current'))).toEqual([
      null,
      'step',
      null,
      null,
      null,
    ]);

    await tick();
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Utlevert');
    expect(load).toHaveBeenCalledTimes(4);
    await tick(STATUS_POLL_MS * 4);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('starts from a status the page has and waits a round before reading', async () => {
    const load = answers(ok({ status: 'completed' }));
    render(
      <OrderStatus
        orderId="o1"
        load={load}
        initial={view({
          status: 'awaiting_payment',
          payment: { method: 'vipps', state: 'pending' },
        })}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Venter på betalingVenter på betalingen i Vipps.'
    );
    expect(screen.queryByRole('list')).toBeNull();
    await tick(STATUS_POLL_MS - 1);
    expect(load).not.toHaveBeenCalled();
    await tick(1);
    expect(screen.getByRole('status')).toHaveTextContent('Fullført');
    expect(
      screen.getAllByRole('listitem').every((s) => s.getAttribute('aria-current') === null)
    ).toBe(true);
  });

  it('does not read at all when the order is already over', () => {
    const load = answers();
    render(<OrderStatus orderId="o1" load={load} initial={view({ status: 'completed' })} />);
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the last status through a failed read and tries again', async () => {
    const load = answers(
      ok({ status: 'preparing' }),
      { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } },
      new Error('boom'),
      ok({ status: 'ready' })
    );
    render(<OrderStatus orderId="o1" load={load} />);
    await tick(0);
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent(
      'TilberedesVi får ikke hentet status akkurat nå.'
    );
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Vi får ikke hentet status akkurat nå.');
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Klar');
    expect(screen.getByRole('status')).not.toHaveTextContent('Vi får ikke');
  });

  it('starts afresh for another order in the same place', async () => {
    const load = answers(ok({ order_id: 'o2', order_number: 'P-2', status: 'placed' }));
    const { rerender } = render(
      <OrderStatus orderId="o1" load={load} initial={view({ status: 'completed' })} />
    );
    expect(screen.getByRole('heading')).toHaveTextContent('P-1029-004');
    rerender(<OrderStatus orderId="o2" load={load} />);
    await tick(0);
    expect(load).toHaveBeenCalledWith('o2', expect.any(AbortSignal));
    expect(screen.getByRole('heading')).toHaveTextContent('Bestilling P-2');
  });

  it('stops on an order that does not exist', async () => {
    const load = answers({ ok: false, error: { code: 'ORDER_NOT_FOUND', message: 'x' } });
    render(<OrderStatus orderId="nope" load={load} locale="en" />);
    await tick(0);
    expect(screen.getByRole('heading')).toHaveTextContent('Order status');
    expect(screen.getByRole('status')).toHaveTextContent('We could not find this order.');
    await tick(STATUS_POLL_MS * 3);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(load).toHaveBeenCalledOnce();
  });

  it('reads again at once when the guest comes back to the tab, never twice at a time', async () => {
    let finish: (r: RouteResult<OrderingOrderStatusView>) => void = () => {};
    const load = vi.fn<Load>(() => new Promise((resolve) => (finish = resolve)));
    render(<OrderStatus orderId="o1" load={load} />);
    expect(load).toHaveBeenCalledOnce();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(load).toHaveBeenCalledOnce();
    await act(async () => finish(ok({ status: 'accepted' })));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(load).toHaveBeenCalledTimes(2);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(load).toHaveBeenCalledTimes(2);
    hidden.mockRestore();
  });

  it('stops reading and ignores a late answer after unmount', async () => {
    let finish: (r: RouteResult<OrderingOrderStatusView>) => void = () => {};
    const load = vi.fn<Load>(() => new Promise((resolve) => (finish = resolve)));
    const { unmount } = render(<OrderStatus orderId="o1" load={load} />);
    const signal = load.mock.calls[0]?.[1] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(ok()));
    await tick(STATUS_POLL_MS * 2);
    expect(load).toHaveBeenCalledOnce();
  });

  it.each([
    [
      view({
        status: 'declined',
        decline_reason: 'too_busy',
        payment: { method: 'vipps', state: 'released' },
      }),
      'AvvistRestauranten har for mye å gjøre akkurat nå.Du er ikke trukket for bestillingen.',
    ],
    [
      view({
        status: 'declined',
        decline_reason: 'other',
        payment: { method: 'pay_at_counter', state: 'none' },
      }),
      'AvvistRestauranten kunne ikke ta imot bestillingen.Du er ikke trukket for bestillingen.',
    ],
    [
      view({ status: 'declined', payment: { method: 'vipps', state: 'released' } }),
      'AvvistRestauranten kunne ikke ta imot bestillingen.Du er ikke trukket for bestillingen.',
    ],
    [
      view({
        status: 'declined',
        decline_reason: 'timeout',
        payment: { method: 'vipps', state: 'released' },
      }),
      'AvvistRestauranten svarte ikke i tide.Du er ikke trukket for bestillingen.',
    ],
    [
      view({
        status: 'declined',
        decline_reason: 'sold_out',
        payment: { method: 'vipps', state: 'released' },
      }),
      'AvvistRestauranten hadde ikke alt du bestilte.Du er ikke trukket for bestillingen.',
    ],
    [
      view({
        status: 'declined',
        decline_reason: 'closing_soon',
        payment: { method: 'vipps', state: 'released' },
      }),
      'AvvistRestauranten stenger snart.Du er ikke trukket for bestillingen.',
    ],
    [
      view({ status: 'abandoned', payment: { method: 'vipps', state: 'failed' } }),
      'ForlattDu er ikke trukket for bestillingen.',
    ],
    [view({ status: 'cancelled', payment: { method: 'vipps', state: 'captured' } }), 'Kansellert'],
    [
      view({ status: 'refunded', payment: { method: 'vipps', state: 'refunded' } }),
      'RefundertPengene er betalt tilbake.',
    ],
    [view({ status: 'handed_over', ready_at: '2026-10-29T11:25:00Z' }), 'Utlevert'],
  ])('tells how it ended (%#)', (initial, text) => {
    render(<OrderStatus orderId="o1" load={vi.fn()} initial={initial} />);
    expect(screen.getByRole('status').textContent).toBe(text);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <OrderStatus
        orderId="o1"
        load={vi.fn()}
        initial={view({ status: 'preparing', ready_at: '2026-10-29T11:25:00Z' })}
        timeZone="Europe/Oslo"
      />
    );
    vi.useRealTimers();
    expect(await axeViolations(container)).toEqual([]);
  });
});
