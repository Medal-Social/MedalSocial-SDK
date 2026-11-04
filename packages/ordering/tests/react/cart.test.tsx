import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { resolveCart } from '../../src/core/cart';
import type { DraftLine } from '../../src/core/draft-store';
import { createMoney } from '../../src/core/money';
import { CartBar } from '../../src/react/CartBar';
import { CartList } from '../../src/react/CartList';
import { axeViolations } from '../support/axe';
import { MENU } from '../support/menu';

const NBSP = '\u00A0';

function line(
  lineId: string,
  itemId: string,
  quantity = 1,
  selections: Record<string, string[]> = {},
  note?: string
): DraftLine {
  return { lineId, itemId, quantity, selections, ...(note ? { note } : {}) };
}

const CART = resolveCart(MENU, [
  line('l1', 'burger', 2, { size: ['large'], extras: ['cheese'] }, 'No onion'),
  line('l2', 'water', 1),
]);

describe('CartBar', () => {
  it('shows the count and total and opens the cart', async () => {
    const onOpen = vi.fn();
    render(<CartBar cart={CART} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: `3 retter Se bestillingen · 414${NBSP}kr` });
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('says one dish, in English, with the site money', () => {
    render(
      <CartBar
        cart={{ count: 1, totalOre: 2550 }}
        onOpen={() => {}}
        locale="en"
        money={createMoney({ locale: 'en-GB', currency: 'GBP' })}
        className="sm:static"
      />
    );
    expect(screen.getByRole('button')).toHaveTextContent('1 dish View order · £25.50');
  });

  it('is nothing while the cart is empty', () => {
    const { container } = render(<CartBar cart={{ count: 0, totalOre: 0 }} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no axe violations', async () => {
    const { container } = render(<CartBar cart={CART} onOpen={() => {}} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('CartList', () => {
  it('lists each dish with its choices, note and price, then the total', () => {
    render(<CartList cart={CART} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toBe(`2 × Burgerlarge, cheeseNo onion389${NBSP}kr`);
    expect(items[1]?.textContent).toBe(`1 × Water25${NBSP}kr`);
    expect(screen.getByText('Totalt').parentElement?.textContent).toBe(`Totalt414${NBSP}kr`);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('steps the quantity within 1 to 99 and removes a line', async () => {
    const user = userEvent.setup();
    const onQuantity = vi.fn();
    const onRemove = vi.fn();
    const cart = resolveCart(MENU, [line('one', 'water', 1), line('max', 'water', 99)]);
    render(<CartList cart={cart} onQuantity={onQuantity} onRemove={onRemove} />);
    const [first, second] = screen.getAllByRole('group', { name: 'Antall: Water' });
    await user.click(within(first as HTMLElement).getByRole('button', { name: 'Én færre' }));
    await user.click(within(first as HTMLElement).getByRole('button', { name: 'Én til' }));
    await user.click(within(second as HTMLElement).getByRole('button', { name: 'Én til' }));
    await user.click(within(second as HTMLElement).getByRole('button', { name: 'Én færre' }));
    expect(onQuantity.mock.calls).toEqual([
      ['one', 2],
      ['max', 98],
    ]);
    await user.click(screen.getAllByRole('button', { name: 'Fjern Water' })[1] as HTMLElement);
    expect(onRemove).toHaveBeenCalledWith('max');
  });

  it('removes without a stepper, and steps without a remove button', () => {
    const { rerender } = render(<CartList cart={CART} onRemove={() => {}} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Fjern/ })).toHaveLength(2);
    rerender(<CartList cart={CART} onQuantity={() => {}} />);
    expect(screen.queryByRole('button', { name: /Fjern/ })).toBeNull();
  });

  it('names what was taken out, and says when nothing is left', () => {
    const cart = resolveCart(MENU, [line('a', 'pizza'), line('b', 'soup'), line('c', 'burger')]);
    render(<CartList cart={cart} locale="en" />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Something was taken out of your order');
    expect(
      within(notice)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual([
      'A dish is no longer on the menu.',
      'Soup is sold out.',
      'The choices for Burger have changed. Please add it again.',
    ]);
    expect(screen.getByText('Your order is empty.')).toBeInTheDocument();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('has no axe violations', async () => {
    const cart = resolveCart(MENU, [
      line('l1', 'burger', 2, { size: ['large'] }),
      line('x', 'soup'),
    ]);
    const { container } = render(
      <CartList cart={cart} onQuantity={() => {}} onRemove={() => {}} />
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
