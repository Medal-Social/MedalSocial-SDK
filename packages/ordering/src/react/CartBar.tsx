/**
 * The cart bar: a bar fixed to the bottom of a phone screen with how many
 * dishes are in the cart and the total, pressing it opens the cart or
 * checkout. Nothing while the cart is empty. On a wider screen the page may
 * place it itself (`className`, e.g. `sm:static`).
 *
 * The total is for the guest's eyes — the server prices the order.
 */
import { useMemo } from 'react';
import type { ResolvedCart } from '../core/cart';
import { createMoney, type Money } from '../core/money';
import { fill, mergeLabels, type OrderingLabels } from '../core/ui-labels';
import { cx } from './cx';

export interface CartBarProps {
  cart: Pick<ResolvedCart, 'count' | 'totalOre'>;
  onOpen: () => void;
  /** BCP 47. Default `nb`. */
  locale?: string;
  /** Default `createMoney({ locale })`. */
  money?: Money;
  labels?: Partial<OrderingLabels>;
  className?: string;
}

export function CartBar({
  cart,
  onOpen,
  locale = 'nb',
  money: moneyProp,
  labels: overrides,
  className,
}: CartBarProps) {
  const labels = mergeLabels(locale, overrides);
  const defaultMoney = useMemo(() => createMoney({ locale }), [locale]);
  const money = moneyProp ?? defaultMoney;
  if (cart.count <= 0) return null;
  const count =
    cart.count === 1 ? labels.cartCountOne : fill(labels.cartCountMany, { n: cart.count });
  return (
    <div
      className={cx(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        className
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-full bg-primary px-5 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="rounded-full bg-primary-foreground/15 px-2 py-0.5 text-sm tabular-nums">
          {count}
        </span>{' '}
        <span className="tabular-nums">
          {fill(labels.viewCart, { price: money.formatOre(cart.totalOre) })}
        </span>
      </button>
    </div>
  );
}
