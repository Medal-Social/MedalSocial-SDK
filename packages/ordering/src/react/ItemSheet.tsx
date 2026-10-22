/**
 * The dish sheet: a modal dialog where the guest picks the dish's choices, how
 * many, and a note to the kitchen, then adds it to the cart.
 *
 * Presentational and controlled: the page owns `open`, and `onAdd` hands it
 * the line (ids and choices only, as the cart draft stores them). The price on
 * the add button is for the guest's eyes — the server prices the order.
 *
 * The add button stays pressable while a required choice is missing, marked
 * `aria-disabled`: pressing it shows what is missing next to the group and
 * moves focus there, which a truly disabled button could not do.
 */
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { OrderingMenuItem, OrderingModifierGroup } from '../core';
import { MAX_NOTE_LENGTH, MAX_QUANTITY } from '../core/draft-store';
import {
  type Selections,
  selectionMode,
  unitPriceOre,
  validateSelection,
  validateSelections,
} from '../core/modifiers';
import { createMoney, type Money } from '../core/money';
import { fill, mergeLabels, type OrderingLabels } from './labels';

/** What the sheet hands the page: one cart line. `note` is left out when empty. */
export interface ItemSheetLine {
  itemId: string;
  quantity: number;
  selections: Record<string, string[]>;
  note?: string;
}

export interface ItemSheetProps {
  /** The dish; `null` renders nothing. */
  item: OrderingMenuItem | null;
  open: boolean;
  /** Escape, the close button or a click outside. */
  onClose: () => void;
  onAdd: (line: ItemSheetLine) => void;
  /** BCP 47. Default `nb`. */
  locale?: string;
  /** Default `createMoney({ locale })`. */
  money?: Money;
  labels?: Partial<OrderingLabels>;
  /** A cart line being edited: the sheet starts from it and says «Oppdater». */
  initial?: { quantity: number; selections: Selections; note?: string };
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]';

/** A quantity from an edited line: a whole number from 1 to `MAX_QUANTITY`, else 1. */
function startQuantity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(value)));
}

/**
 * The sheet's state starts from `item` and `initial` when it opens, and is
 * kept (keyed by the dish id) while it stays open. Editing two lines of the
 * SAME dish one after the other: close the sheet in between, or give it a
 * `key` (the line id), or it keeps the first line's choices.
 */
export function ItemSheet(props: ItemSheetProps) {
  if (!props.open || props.item === null) return null;
  return <Sheet key={props.item.id} {...props} item={props.item} />;
}

function groupHint(group: OrderingModifierGroup, labels: OrderingLabels): string {
  const { min_select: min, max_select: max } = group;
  if (min === max) return fill(labels.chooseExactly, { n: min });
  if (min === 0) return max === 1 ? labels.optional : fill(labels.chooseUpTo, { n: max });
  return fill(labels.chooseBetween, { min, max });
}

function Sheet({
  item,
  onClose,
  onAdd,
  locale = 'nb',
  money: moneyProp,
  labels: overrides,
  initial,
}: ItemSheetProps & { item: OrderingMenuItem }) {
  const labels = mergeLabels(locale, overrides);
  const defaultMoney = useMemo(() => createMoney({ locale }), [locale]);
  const money = moneyProp ?? defaultMoney;
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const groups = useRef<Record<string, HTMLFieldSetElement | null>>({});
  const [quantity, setQuantity] = useState(() => startQuantity(initial?.quantity));
  const [note, setNote] = useState(initial?.note ?? '');
  const [showErrors, setShowErrors] = useState(false);
  // Only the dish's own groups and options: a stale line's other choices are
  // dropped, as one the guest could not see could not be unticked either.
  const [selections, setSelections] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      item.modifier_groups.map((group) => [
        group.id,
        (initial?.selections[group.id] ?? []).filter((optionId) =>
          group.options.some((option) => option.id === optionId)
        ),
      ])
    )
  );

  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const root = document.documentElement;
    const { overflow, paddingRight } = root.style;
    // Hiding the page's scrollbar widens the page; pad by its width so nothing shifts.
    const scrollbar = window.innerWidth - root.clientWidth;
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    root.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      root.style.overflow = overflow;
      root.style.paddingRight = paddingRight;
      opener.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const valid = validateSelections(item, selections);
  const price = money.formatOre(unitPriceOre(item, selections) * quantity);

  function add() {
    if (!valid.ok) {
      setShowErrors(true);
      groups.current[valid.groupId]?.focus();
      return;
    }
    const trimmed = note.trim();
    onAdd({
      itemId: item.id,
      quantity,
      selections,
      ...(trimmed === '' ? {} : { note: trimmed }),
    });
  }

  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const noteId = `${id}-note`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        data-testid="ordering-sheet-backdrop"
        aria-hidden="true"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={item.description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl bg-background text-foreground shadow-xl outline-none sm:rounded-2xl"
      >
        {item.image_url ? (
          // biome-ignore lint/performance/noImgElement: not tied to Next; the site's own loader may already resize the photo
          <img src={item.image_url} alt="" className="aspect-video w-full object-cover" />
        ) : null}
        <div className="flex items-start justify-between gap-4 p-4">
          <h2 id={titleId} className="text-xl font-semibold">
            {item.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-full px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {labels.close}
          </button>
        </div>
        {item.description ? (
          <p id={descriptionId} className="px-4 text-muted-foreground">
            {item.description}
          </p>
        ) : null}

        {item.sold_out ? (
          <p className="m-4 rounded-lg bg-muted p-3 font-medium">{labels.itemSoldOut}</p>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            {item.modifier_groups.map((group) => (
              <GroupField
                key={group.id}
                group={group}
                selected={selections[group.id] as string[]}
                showError={showErrors}
                labels={labels}
                money={money}
                fieldRef={(node) => {
                  groups.current[group.id] = node;
                }}
                onChange={(next) => setSelections((prev) => ({ ...prev, [group.id]: next }))}
              />
            ))}

            <fieldset>
              <legend className="mb-1 font-medium">{labels.quantity}</legend>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label={labels.fewer}
                  aria-disabled={quantity <= 1 ? 'true' : undefined}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="min-h-11 min-w-11 rounded-full border border-border text-lg aria-disabled:opacity-40"
                >
                  <span aria-hidden="true">−</span>
                </button>
                <output aria-live="polite" className="min-w-8 text-center tabular-nums">
                  {quantity}
                </output>
                <button
                  type="button"
                  aria-label={labels.more}
                  aria-disabled={quantity >= MAX_QUANTITY ? 'true' : undefined}
                  onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
                  className="min-h-11 min-w-11 rounded-full border border-border text-lg aria-disabled:opacity-40"
                >
                  <span aria-hidden="true">+</span>
                </button>
              </div>
            </fieldset>

            <div className="flex flex-col gap-1">
              <label htmlFor={noteId} className="font-medium">
                {labels.note}
              </label>
              <textarea
                id={noteId}
                value={note}
                maxLength={MAX_NOTE_LENGTH}
                rows={2}
                aria-describedby={`${noteId}-hint`}
                onChange={(event) => setNote(event.target.value)}
                className="rounded-lg border border-input bg-background p-2"
              />
              <p id={`${noteId}-hint`} className="text-sm text-muted-foreground">
                {fill(labels.noteHint, { n: MAX_NOTE_LENGTH })}
              </p>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 border-t border-border bg-background p-4">
          <button
            type="button"
            disabled={item.sold_out}
            aria-disabled={valid.ok ? undefined : 'true'}
            onClick={add}
            className="min-h-11 w-full rounded-full bg-primary px-4 font-semibold text-primary-foreground aria-disabled:opacity-60 disabled:opacity-40"
          >
            {fill(initial ? labels.update : labels.add, { price })}
          </button>
        </div>
      </div>
    </div>
  );
}

interface GroupFieldProps {
  group: OrderingModifierGroup;
  selected: string[];
  showError: boolean;
  labels: OrderingLabels;
  money: Money;
  fieldRef: (node: HTMLFieldSetElement | null) => void;
  onChange: (next: string[]) => void;
}

function GroupField({
  group,
  selected,
  showError,
  labels,
  money,
  fieldRef,
  onChange,
}: GroupFieldProps) {
  const id = useId();
  const single = selectionMode(group) === 'single';
  const result = validateSelection(group, selected);
  const error = !showError || result.ok ? null : errorText(group, result.reason, labels);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <fieldset
      ref={fieldRef}
      tabIndex={-1}
      role={single ? 'radiogroup' : undefined}
      aria-labelledby={`${id}-legend`}
      aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
      className="flex flex-col gap-1 outline-none"
    >
      <legend id={`${id}-legend`} className="font-medium">
        {group.name}
      </legend>
      <p id={hintId} className="text-sm text-muted-foreground">
        {groupHint(group, labels)}
      </p>
      {error === null ? null : (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      {single && group.min_select === 0 ? (
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name={id}
            checked={selected.length === 0}
            onChange={() => onChange([])}
            className="size-5 accent-primary"
          />
          <span>{labels.none}</span>
        </label>
      ) : null}
      {group.options.map((option) => {
        const checked = selected.includes(option.id);
        const full = !single && selected.length >= group.max_select;
        const delta = money.formatDeltaOre(option.price_delta_ore);
        return (
          <label key={option.id} className="flex min-h-11 items-center gap-3">
            <input
              type={single ? 'radio' : 'checkbox'}
              name={id}
              checked={checked}
              disabled={!checked && (option.sold_out || full)}
              onChange={() =>
                onChange(
                  single
                    ? [option.id]
                    : checked
                      ? selected.filter((chosen) => chosen !== option.id)
                      : [...selected, option.id]
                )
              }
              className="size-5 accent-primary"
            />
            <span className="flex-1">{option.name}</span>
            {option.sold_out ? (
              <span className="rounded-full bg-muted px-2 text-sm">{labels.soldOut}</span>
            ) : null}
            {delta === '' ? null : (
              <span className="text-sm text-muted-foreground tabular-nums">{delta}</span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}

function errorText(group: OrderingModifierGroup, reason: string, labels: OrderingLabels): string {
  if (reason !== 'below_min') return labels.notPossible;
  const n = group.min_select;
  return fill(
    group.min_select === group.max_select ? labels.mustChoose : labels.mustChooseAtLeast,
    {
      n,
    }
  );
}
