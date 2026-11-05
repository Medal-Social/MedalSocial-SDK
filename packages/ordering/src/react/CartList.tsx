/**
 * The cart's lines: each dish with its choices, note and price, a quantity
 * stepper and a remove button, then the total. Lines the menu can no longer
 * serve (`cart.dropped`) are named above in a notice, so the guest learns
 * what was taken out rather than meeting a refused order.
 *
 * Presentational and controlled: the page resolves the draft against the
 * menu (`resolveCart`) and passes the draft store's mutators in.
 */
import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { DroppedLine, ResolvedCart } from '../core/cart';
import { MAX_QUANTITY } from '../core/draft-store';
import { createMoney, type Money } from '../core/money';
import { fill, mergeLabels, type OrderingLabels } from '../core/ui-labels';
import { cx } from './cx';

export interface CartListProps {
  cart: ResolvedCart;
  /** A new quantity for a line, 1 to `MAX_QUANTITY`. Left out: no stepper. */
  onQuantity?: (lineId: string, quantity: number) => void;
  /** Left out: no remove button. */
  onRemove?: (lineId: string) => void;
  /** BCP 47. Default `nb`. */
  locale?: string;
  /** Default `createMoney({ locale })`. */
  money?: Money;
  labels?: Partial<OrderingLabels>;
  className?: string;
}

function droppedText(dropped: DroppedLine, labels: OrderingLabels): string {
  const name = dropped.item?.name ?? labels.someDish;
  if (dropped.reason === 'sold_out') return fill(labels.droppedSoldOut, { name });
  if (dropped.reason === 'invalid_options') return fill(labels.droppedOptions, { name });
  return fill(labels.droppedUnavailable, { name });
}

export function CartList({
  cart,
  onQuantity,
  onRemove,
  locale = 'nb',
  money: moneyProp,
  labels: overrides,
  className,
}: CartListProps) {
  const labels = mergeLabels(locale, overrides);
  const defaultMoney = useMemo(() => createMoney({ locale }), [locale]);
  const money = moneyProp ?? defaultMoney;
  const id = useId();
  // «Fjern» unmounts its own line: focus moves to the nearest «Fjern» still in
  // the cart, after the removed line first and then before it, or to the
  // heading once the cart is empty, instead of falling to the top of the page.
  // The move belongs to the update that carries the tap out: a page that keeps
  // the line (or removes it later, asynchronously) gets no move, so a line that
  // leaves the cart for another reason never pulls focus.
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterRemove = useRef<{ removed: string; order: string[] } | null>(null);
  const lineIds = cart.lines.map(({ line }) => line.lineId).join(' ');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `lineIds` is the re-render that removed the line.
  useLayoutEffect(() => {
    const pending = focusAfterRemove.current;
    if (pending === null || removeButtons.current.has(pending.removed)) return;
    focusAfterRemove.current = null;
    const at = pending.order.indexOf(pending.removed);
    const nearest = [...pending.order.slice(at + 1), ...pending.order.slice(0, at).reverse()];
    const target = nearest.map((lineId) => removeButtons.current.get(lineId)).find(Boolean);
    (target ?? heading.current)?.focus();
  }, [lineIds]);
  const remove = (lineId: string) => {
    const pending = { removed: lineId, order: cart.lines.map(({ line }) => line.lineId) };
    focusAfterRemove.current = pending;
    onRemove?.(lineId);
    // The page's own update has rendered by now; a move it did not use expires.
    setTimeout(() => {
      if (focusAfterRemove.current === pending) focusAfterRemove.current = null;
    }, 0);
  };

  return (
    <section aria-labelledby={`${id}-title`} className={cx('flex flex-col gap-3', className)}>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {labels.yourOrder}
      </h2>
      {cart.dropped.length > 0 ? (
        <div role="status" className="rounded-lg border border-border bg-muted p-3">
          <p className="font-medium">{labels.droppedTitle}</p>
          <ul className="mt-1 list-disc ps-5 text-muted-foreground">
            {cart.dropped.map((dropped) => (
              <li key={dropped.line.lineId}>{droppedText(dropped, labels)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {cart.lines.length === 0 ? (
        <p className="text-muted-foreground">{labels.cartEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {cart.lines.map(({ line, item, options, totalOre }) => (
            <li key={line.lineId} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-medium">
                    {onQuantity ? item.name : `${line.quantity} × ${item.name}`}
                  </span>
                  {options.length > 0 ? (
                    <span className="text-sm text-muted-foreground">
                      {options.map((option) => option.name).join(', ')}
                    </span>
                  ) : null}
                  {line.note ? (
                    <span className="text-sm text-muted-foreground italic">{line.note}</span>
                  ) : null}
                </div>
                <span className="tabular-nums">{money.formatOre(totalOre)}</span>
              </div>
              {onQuantity || onRemove ? (
                <div className="flex items-center gap-3">
                  {onQuantity ? (
                    <fieldset
                      aria-label={`${labels.quantity}: ${item.name}`}
                      className="flex items-center gap-2"
                    >
                      <button
                        type="button"
                        aria-label={labels.fewer}
                        aria-disabled={line.quantity <= 1 ? 'true' : undefined}
                        onClick={() => {
                          if (line.quantity > 1) onQuantity(line.lineId, line.quantity - 1);
                        }}
                        className="min-h-11 min-w-11 rounded-full border border-border text-lg aria-disabled:opacity-40"
                      >
                        <span aria-hidden="true">−</span>
                      </button>
                      <output aria-live="polite" className="min-w-8 text-center tabular-nums">
                        {line.quantity}
                      </output>
                      <button
                        type="button"
                        aria-label={labels.more}
                        aria-disabled={line.quantity >= MAX_QUANTITY ? 'true' : undefined}
                        onClick={() => {
                          if (line.quantity < MAX_QUANTITY)
                            onQuantity(line.lineId, line.quantity + 1);
                        }}
                        className="min-h-11 min-w-11 rounded-full border border-border text-lg aria-disabled:opacity-40"
                      >
                        <span aria-hidden="true">+</span>
                      </button>
                    </fieldset>
                  ) : null}
                  {onRemove ? (
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) removeButtons.current.set(line.lineId, node);
                        else removeButtons.current.delete(line.lineId);
                      }}
                      aria-label={fill(labels.removeLine, { name: item.name })}
                      onClick={() => remove(line.lineId)}
                      className="ms-auto min-h-11 rounded-full px-3 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {labels.remove}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cart.lines.length > 0 ? (
        <p className="flex justify-between border-t border-border pt-3 font-semibold">
          <span>{labels.total}</span>
          <span className="tabular-nums">{money.formatOre(cart.totalOre)}</span>
        </p>
      ) : null}
    </section>
  );
}
