/**
 * The delivery address field: a WAI-ARIA 1.2 combobox. The guest types, a
 * list of Norwegian addresses opens below (arrow keys move through it, Enter
 * or a tap picks one, Escape closes it), and the picked one is verified
 * before it counts.
 *
 * Controlled through props: `suggest(q, session, signal)` and
 * `resolve(id, session)` call the site's address routes (with
 * `fetchAddressSuggestions` / `resolveAddress` from `/core`), and
 * `onResolved` gets the verified address — or `null` as soon as the guest
 * changes the text again. Nothing is fetched here but through those props.
 *
 * Suggestions are asked for 250 ms after the last keystroke, from three
 * letters on; a newer lookup aborts the one before, and leaving the field
 * drops a lookup still to come (an option pressed with the mouse or a finger
 * keeps the focus, so it is picked, not dropped). A polite live region says
 * how many addresses were found. Both calls of one lookup share a session
 * token, and every finished lookup starts a new one. An address the register
 * does not know (`ADDRESS_NOT_VERIFIED`, often a missing house number) is
 * said under the field, tied to it with `aria-describedby`.
 */
import type { DeliveryAddressSuggestion, DeliveryResolvedAddress } from '@medalsocial/sdk';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { RouteResult } from '../core/client';
import { newLookupSession } from '../core/delivery';
import { refusalMessage } from '../core/errors';
import { fill, mergeLabels, type OrderingLabels } from '../core/ui-labels';
import { cx } from './cx';

/** Wait this long after the last keystroke before asking. */
const DEBOUNCE_MS = 250;

/** Fewer letters than this answer no addresses at Medal either. */
const MIN_QUERY = 3;

export interface AddressComboboxProps {
  /** Addresses for what the guest typed (the site's suggest route). */
  suggest: (
    q: string,
    session: string,
    signal: AbortSignal
  ) => Promise<RouteResult<DeliveryAddressSuggestion[]>>;
  /** The picked suggestion verified (the site's resolve route). */
  resolve: (id: string, session: string) => Promise<RouteResult<DeliveryResolvedAddress>>;
  /** The verified address, or `null` when the guest edits it away. */
  onResolved: (address: DeliveryResolvedAddress | null) => void;
  /**
   * What the field starts with: the label of an address the page already
   * holds as verified. The first edit takes it away (`onResolved(null)`).
   */
  initialValue?: string;
  /** BCP 47. Default `nb`. */
  locale?: string;
  labels?: Partial<OrderingLabels>;
  className?: string;
}

export function AddressCombobox({
  suggest,
  resolve,
  onResolved,
  initialValue = '',
  locale = 'nb',
  labels: overrides,
  className,
}: AddressComboboxProps) {
  const labels = mergeLabels(locale, overrides);
  const id = useId();
  const [text, setText] = useState(initialValue);
  const [options, setOptions] = useState<DeliveryAddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  // Every keystroke and pick is a new turn; an answer from an older turn is dropped.
  const turn = useRef(0);
  // Every lookup and every blur: a blur drops the suggestions on their way, not a pick's check.
  const lookup = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<AbortController | null>(null);
  const resolved = useRef(initialValue !== '');

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      inflight.current?.abort();
      turn.current += 1;
    },
    []
  );

  function lookupSession(): string {
    session.current ??= newLookupSession();
    return session.current;
  }

  /** Start a new turn: drop the pending lookup and close the list. */
  function nextTurn(): number {
    clearTimeout(timer.current);
    inflight.current?.abort();
    setOpen(false);
    setActive(-1);
    turn.current += 1;
    return turn.current;
  }

  function change(value: string) {
    setText(value);
    setError(null);
    if (resolved.current) {
      resolved.current = false;
      onResolved(null);
    }
    const mine = nextTurn();
    if (value.trim().length < MIN_QUERY) {
      setOptions([]);
      setStatus('');
      return;
    }
    timer.current = setTimeout(() => {
      const controller = new AbortController();
      inflight.current = controller;
      lookup.current += 1;
      const asked = lookup.current;
      const settle = (found: DeliveryAddressSuggestion[], words: string) => {
        if (mine !== turn.current || asked !== lookup.current) return;
        setOptions(found);
        setOpen(found.length > 0);
        setStatus(words);
      };
      suggest(value, lookupSession(), controller.signal).then(
        (result) => {
          if (!result.ok) return settle([], refusalMessage(result.error, labels));
          const n = result.data.length;
          const count = n === 1 ? labels.addressCountOne : labels.addressCountMany;
          settle(result.data, n === 0 ? labels.addressNone : fill(count, { n }));
        },
        () => settle([], labels.errorGeneric)
      );
    }, DEBOUNCE_MS);
  }

  async function pick(option: DeliveryAddressSuggestion) {
    const mine = nextTurn();
    const picked = lookupSession();
    // The pick ends this lookup session, whatever happens next: a lookup
    // typed while the address is checked, or after, starts a new one.
    session.current = null;
    setText(`${option.label}, ${option.secondary}`);
    setOptions([]);
    setStatus(labels.addressChecking);
    let result: RouteResult<DeliveryResolvedAddress>;
    try {
      result = await resolve(option.id, picked);
    } catch {
      result = { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'resolve threw' } };
    }
    if (mine !== turn.current) return;
    setStatus('');
    if (!result.ok) {
      setError(refusalMessage(result.error, labels));
      return;
    }
    resolved.current = true;
    setText(result.data.label);
    onResolved(result.data);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    const n = options.length;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && n > 0) {
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      if (!open) {
        setOpen(true);
        setActive(down ? 0 : n - 1);
      } else if (down) {
        setActive((a) => (a + 1) % n);
      } else {
        setActive((a) => (a <= 0 ? n - 1 : a - 1));
      }
    } else if (event.key === 'Enter' && open) {
      // An open list owns Enter: it picks, and never sends the form.
      event.preventDefault();
      const option = options[active];
      if (option) void pick(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const describedBy = [`${id}-hint`, error ? `${id}-error` : undefined].filter(Boolean).join(' ');

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={`${id}-input`} className="font-medium">
        {labels.address}
      </label>
      <div className="relative">
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          value={text}
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={(event) => change(event.target.value)}
          onKeyDown={keyDown}
          onBlur={() => {
            // A lookup still to come must not reopen the list once the guest has left.
            clearTimeout(timer.current);
            inflight.current?.abort();
            lookup.current += 1;
            setOpen(false);
            setActive(-1);
          }}
          className="min-h-11 w-full rounded-lg border border-input bg-background px-3 aria-invalid:border-destructive"
        />
        <div
          id={listId}
          role="listbox"
          aria-label={labels.address}
          hidden={!open}
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg"
        >
          {options.map((option, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard picks through the combobox (aria-activedescendant), as WAI-ARIA has it.
            <div
              key={option.id}
              id={optionId(index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              // Keep the focus in the field: a tap must not blur it and close the list first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void pick(option)}
              className="flex min-h-11 cursor-pointer flex-col justify-center px-3 aria-selected:bg-muted"
            >
              <span>{option.label}</span>
              <span className="text-sm text-muted-foreground">{option.secondary}</span>
            </div>
          ))}
        </div>
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {labels.addressHint}
      </p>
      <p aria-live="polite" className="text-sm text-muted-foreground empty:hidden">
        {status}
      </p>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
