/**
 * The menu: a sticky row of category links over one section per category,
 * each dish a card the guest presses to open the dish sheet.
 *
 * Presentational and controlled: the page passes the menu it fetched and
 * opens the sheet from `onSelectItem`. A sold-out dish, and every dish while
 * the restaurant is closed, stays focusable (so a screen reader still reads
 * why) but is `aria-disabled` and never reaches `onSelectItem`.
 *
 * Allergens are named in words beside a small mark — a symbol alone is not
 * enough to tell a guest what is in their food.
 */
import { useId, useMemo } from 'react';
import type { OrderingMenu, OrderingMenuItem } from '../core';
import { allergenLabel, dietaryLabel } from '../core/labels';
import { createMoney, type Money } from '../core/money';
import { mergeLabels, type OrderingLabels } from '../core/ui-labels';
import { ClosedNotice } from './ClosedNotice';

export interface MenuListProps {
  menu: OrderingMenu;
  onSelectItem: (item: OrderingMenuItem) => void;
  /** BCP 47. Default `nb`. */
  locale?: string;
  /** Default `createMoney({ locale })`. */
  money?: Money;
  labels?: Partial<OrderingLabels>;
  /** Set while the restaurant takes no orders: the notice shows and nothing can be chosen. */
  closed?: { nextOpenAt?: Date | string | number | null; timeZone?: string };
  /** The clock for the closed notice, for tests. */
  now?: Date;
  className?: string;
}

/** FNV-1a over the UTF-16 code units, in base 36: short, stable and spread. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * A category's anchor, stable and readable: `ordering-category-<id>` when the
 * id is already safe in a fragment. Otherwise the unsafe characters become
 * `-` and a short hash of the raw id follows, so `a.b` and `a-b` still get
 * two anchors.
 */
function sectionId(categoryId: string): string {
  const safe = categoryId.replace(/[^A-Za-z0-9_-]/g, '-');
  return safe === categoryId
    ? `ordering-category-${safe}`
    : `ordering-category-${safe}-${shortHash(categoryId)}`;
}

export function MenuList({
  menu,
  onSelectItem,
  locale = 'nb',
  money: moneyProp,
  labels: overrides,
  closed,
  now,
  className,
}: MenuListProps) {
  const labels = mergeLabels(locale, overrides);
  const defaultMoney = useMemo(() => createMoney({ locale }), [locale]);
  const money = moneyProp ?? defaultMoney;
  const id = useId();
  const closedId = `${id}-closed`;
  const categories = menu.categories.filter((category) => category.items.length > 0);

  return (
    <div className={className}>
      {closed ? (
        <ClosedNotice
          id={closedId}
          nextOpenAt={closed.nextOpenAt}
          timeZone={closed.timeZone}
          locale={locale}
          labels={overrides}
          now={now}
          className="mb-4"
        />
      ) : null}
      {categories.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{labels.menuEmpty}</p>
      ) : (
        <>
          <nav
            aria-label={labels.categories}
            className="sticky top-0 z-10 -mx-4 overflow-x-auto border-b border-border bg-background px-4"
          >
            <ul className="flex gap-2 py-2">
              {categories.map((category) => (
                <li key={category.id} className="shrink-0">
                  <a
                    href={`#${sectionId(category.id)}`}
                    className="inline-flex min-h-11 items-center rounded-full px-4 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {category.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {categories.map((category) => (
            <section
              key={category.id}
              id={sectionId(category.id)}
              aria-labelledby={`${sectionId(category.id)}-title`}
              className="scroll-mt-16 py-4"
            >
              <h2 id={`${sectionId(category.id)}-title`} className="mb-3 text-xl font-semibold">
                {category.name}
              </h2>
              <ul className="flex flex-col gap-3">
                {category.items.map((item, itemIndex) => (
                  <li key={item.id}>
                    <MenuItemCard
                      item={item}
                      baseId={`${sectionId(category.id)}-${itemIndex}`}
                      locale={locale}
                      money={money}
                      labels={labels}
                      closedId={closed ? closedId : null}
                      onSelect={onSelectItem}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

interface MenuItemCardProps {
  item: OrderingMenuItem;
  baseId: string;
  locale: string;
  money: Money;
  labels: OrderingLabels;
  /** The closed notice's id while closed, else `null`. */
  closedId: string | null;
  onSelect: (item: OrderingMenuItem) => void;
}

function MenuItemCard({
  item,
  baseId,
  locale,
  money,
  labels,
  closedId,
  onSelect,
}: MenuItemCardProps) {
  const titleId = `${baseId}-title`;
  const priceId = `${baseId}-price`;
  const soldOutId = `${baseId}-sold-out`;
  const unavailable = item.sold_out || closedId !== null;
  const describedBy = [priceId, item.sold_out ? soldOutId : null, closedId]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      aria-labelledby={titleId}
      className="relative flex gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-ring"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 id={titleId} className="font-semibold">
          <button
            type="button"
            aria-disabled={unavailable ? 'true' : undefined}
            aria-describedby={describedBy}
            onClick={() => {
              if (!unavailable) onSelect(item);
            }}
            className="text-left outline-none after:absolute after:inset-0 after:content-[''] aria-disabled:cursor-not-allowed"
          >
            {item.name}
          </button>
        </h3>
        {item.description ? (
          <p className="text-sm text-muted-foreground">{item.description}</p>
        ) : null}
        <p id={priceId} className="font-medium tabular-nums">
          {money.formatOre(item.price_ore)}
        </p>
        {item.sold_out ? (
          <p>
            <span id={soldOutId} className="rounded-full bg-muted px-2 py-0.5 text-sm font-medium">
              {labels.soldOut}
            </span>
          </p>
        ) : null}
        {item.allergens.length > 0 ? (
          <ul aria-label={labels.allergens} className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {item.allergens.map((allergen) => (
              <li key={allergen} className="inline-flex items-center gap-1">
                <AllergenMark />
                {allergenLabel(allergen, locale)}
              </li>
            ))}
          </ul>
        ) : null}
        {item.dietary.length > 0 ? (
          <ul aria-label={labels.dietary} className="flex flex-wrap gap-1 text-sm">
            {item.dietary.map((mark) => (
              <li
                key={mark}
                className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground"
              >
                {dietaryLabel(mark, locale)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {item.image_url ? (
        // biome-ignore lint/performance/noImgElement: not tied to Next; the site's own loader may already resize the photo
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-24 shrink-0 rounded-lg object-cover"
        />
      ) : null}
    </article>
  );
}

/** A small warning mark in front of an allergen's name; decorative, the name says it. */
function AllergenMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 fill-none stroke-current"
      strokeWidth="1.5"
    >
      <path d="M8 1.5 15 14H1z" strokeLinejoin="round" />
      <path d="M8 6v4M8 11.5v.5" strokeLinecap="round" />
    </svg>
  );
}
