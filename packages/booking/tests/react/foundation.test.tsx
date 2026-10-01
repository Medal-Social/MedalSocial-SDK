/**
 * The pieces every component stands on: the provider's merging, the kit's
 * locale rules, the action reader and the wizard's screen adapters.
 */

import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveBookingConfig } from '../../src/core/config';
import type { WizardState } from '../../src/core/machine';
import { readAction } from '../../src/react/actions';
import { createBookingKit } from '../../src/react/kit';
import { mergeLabels } from '../../src/react/labels';
import { BookingProvider, useBookingKit } from '../../src/react/Provider';
import {
  addedChildEntries,
  ageLine,
  childLine,
  detailsLines,
  detailsScreenBase,
  partyPeople,
  serviceScreenBase,
} from '../../src/react/wizard/adapters';
import { TEST_LABELS } from '../support/labels';
import { PARITY_CONFIG } from '../support/parity-config';

const kit = createBookingKit(PARITY_CONFIG, TEST_LABELS);
const WORDS = { unreachable: 'U', invalidInput: 'I' };

describe('BookingProvider and useBookingKit', () => {
  it('merges nested providers: config, labels and slot classes, inner over outer', () => {
    const outer = { 'wizard.title': 'Outer', 'wizard.retry': 'Again' };
    const inner = { 'wizard.title': 'Inner' };
    const { result } = renderHook(
      () => useBookingKit({ classNames: { who: { heading: 'own' } } }),
      {
        wrapper: ({ children }) => (
          <BookingProvider
            config={PARITY_CONFIG}
            labels={{ ...TEST_LABELS, ...outer }}
            classNames={{ who: { root: 'outer-root', heading: 'outer' } }}
          >
            <BookingProvider labels={inner} classNames={{ service: { root: 'svc' } }}>
              {children}
            </BookingProvider>
          </BookingProvider>
        ),
      }
    );
    const { kit: merged, classNames } = result.current;
    expect(merged.config.locale).toBe(PARITY_CONFIG.locale);
    expect(merged.labels['wizard.title']).toBe('Inner');
    expect(merged.labels['wizard.retry']).toBe('Again');
    expect(classNames.who).toEqual({ root: 'outer-root', heading: 'own' });
    expect(classNames.service).toEqual({ root: 'svc' });
  });

  it('merges a nested provider’s slot classes slot by slot, not screen by screen', () => {
    const { result } = renderHook(() => useBookingKit({}), {
      wrapper: ({ children }) => (
        <BookingProvider config={PARITY_CONFIG} classNames={{ time: { chip: 'a', root: 'r' } }}>
          <BookingProvider classNames={{ time: { chip: 'b' } }}>{children}</BookingProvider>
        </BookingProvider>
      ),
    });
    expect(result.current.classNames.time).toEqual({ chip: 'b', root: 'r' });
  });

  it('takes a provider’s labels when the inner one names none', () => {
    const { result } = renderHook(() => useBookingKit({}), {
      wrapper: ({ children }) => (
        <BookingProvider config={PARITY_CONFIG} labels={TEST_LABELS}>
          <BookingProvider>{children}</BookingProvider>
        </BookingProvider>
      ),
    });
    expect(result.current.kit.labels['who.heading']).toBe(TEST_LABELS['who.heading']);
    expect(result.current.classNames).toEqual({});
  });

  it('shares one kit between components with the same inputs', () => {
    const first = renderHook(() => useBookingKit({ config: PARITY_CONFIG, labels: TEST_LABELS }));
    const second = renderHook(() => useBookingKit({ config: PARITY_CONFIG, labels: TEST_LABELS }));
    expect(first.result.current.kit).toBe(second.result.current.kit);
  });

  it('refuses to render without a config', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useBookingKit({}))).toThrow(/needs a `config`/);
  });

  it('warns once per pack when no label pack was resolved, and shows no consent it has not got', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bare = resolveBookingConfig({ timeZone: 'Europe/Oslo' });
    const { result } = renderHook(() => useBookingKit({ config: bare }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No label pack'));
    expect(result.current.kit.labels['details.marketing.text']).toBeUndefined();
  });

  it('renders its children', () => {
    render(
      <BookingProvider config={PARITY_CONFIG}>
        <p>inside</p>
      </BookingProvider>
    );
    expect(screen.getByText('inside')).toBeInTheDocument();
  });
});

describe('the kit', () => {
  it('writes the possessive the language writes', () => {
    expect(kit.possessive('Theo')).toBe('Theos');
    expect(kit.possessive('Jonas')).toBe("Jonas'");
    const en = createBookingKit(
      resolveBookingConfig({ timeZone: 'Europe/London', locale: 'en-GB' }),
      mergeLabels('en-GB')
    );
    expect(en.possessive('Theo')).toBe("Theo's");
    expect(en.possessive('Jonas')).toBe("Jonas'");
    for (const locale of ['no', 'nn-NO']) {
      const other = createBookingKit(
        resolveBookingConfig({ timeZone: 'Europe/Oslo', locale }),
        mergeLabels(locale)
      );
      expect(other.possessive('Theo')).toBe('Theos');
    }
  });

  it('names months and weekday heads on the business’s calendar', () => {
    expect(kit.clock.monthName(9)).toBe('september');
    expect(kit.clock.weekdayHeads()).toEqual(['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø']);
  });

  it('labels a group with no word of its own by its key', () => {
    const plain = createBookingKit(PARITY_CONFIG, mergeLabels('nb'));
    expect(plain.categories.find((group) => group.key === 'herre')?.label).toBe('Herre');
  });
});

describe('readAction', () => {
  it('reads a plain result and an envelope alike', () => {
    expect(readAction({ ok: true, n: 1 }, WORDS)).toEqual({ ok: true, value: { ok: true, n: 1 } });
    expect(readAction({ data: { status: 'sent' } }, WORDS)).toEqual({
      ok: true,
      value: { status: 'sent' },
    });
  });

  it('reads a dead session and the action’s own sentence', () => {
    expect(readAction({ ok: false, reason: 'session' }, WORDS)).toEqual({
      ok: false,
      failure: { kind: 'session' },
    });
    expect(readAction({ data: { ok: false, reason: 'invalid', message: 'M' } }, WORDS)).toEqual({
      ok: false,
      failure: { kind: 'error', message: 'M' },
    });
  });

  it('finds zod’s first message wherever it is nested, else the generic one', () => {
    const nested = { validationErrors: { _errors: [], a: 'x', b: { _errors: ['Deep'] } } };
    expect(readAction(nested, WORDS)).toEqual({
      ok: false,
      failure: { kind: 'error', message: 'Deep' },
    });
    expect(readAction({ validationErrors: { a: null, b: {} } }, WORDS)).toEqual({
      ok: false,
      failure: { kind: 'error', message: 'I' },
    });
  });

  it('reads anything else as unreachable', () => {
    for (const answer of [undefined, { serverError: 'boom' }, { ok: false, reason: 'odd' }]) {
      expect(readAction(answer as never, WORDS)).toEqual({
        ok: false,
        failure: { kind: 'error', message: 'U' },
      });
    }
  });
});

describe('the wizard’s screen adapters', () => {
  it('says no age for an unknown or a future year', () => {
    expect(ageLine(kit, undefined, undefined, '2026-09-02')).toBe('');
    expect(ageLine(kit, 2030, undefined, '2026-09-02')).toBe('');
    expect(childLine(kit, { name: 'X', birthYear: 2030 }, '2026-09-02')).toBe('');
    expect(
      addedChildEntries(kit, [{ key: 'new:1', name: 'Ny' }], '2026-09-02').map((e) => e.line)
    ).toEqual(['']);
  });

  it('calls a guest grown-up «adult», and a child with no age by name alone', () => {
    const people = partyPeople(
      kit,
      [
        { key: 'adult', adult: true },
        { key: 'n:1', name: 'Mia', birthYear: 2030 },
      ],
      () => null,
      () => null
    );
    expect(people.map((person) => person.label)).toEqual([TEST_LABELS['people.adult'], 'Mia']);
  });

  it('offers no children’s menu split for a site without one', () => {
    const adults = resolveBookingConfig({
      timeZone: 'Europe/Oslo',
      categories: [{ key: 'annet', audience: 'any' }],
    });
    expect(serviceScreenBase(createBookingKit(adults, TEST_LABELS)).childCategory).toBeUndefined();
  });

  it('seats lines with no slot at the start of time, and links terms only with words', () => {
    const state = {
      ...kit.wizard.initialState(),
      items: [{ service: { id: 's', durationMinutes: 30 } }],
      startTs: null,
    } as unknown as WizardState;
    expect(detailsLines(kit, state)).toEqual([{ startTs: 0, resourceId: null }]);
    const unworded = createBookingKit(PARITY_CONFIG, { ...TEST_LABELS, 'details.terms.link': '' });
    expect(detailsScreenBase(unworded).termsHref).toBeNull();
    const worded = createBookingKit(PARITY_CONFIG, {
      ...TEST_LABELS,
      'details.terms.link': 'Vilkår',
    });
    expect(detailsScreenBase(worded).termsHref).toBe(PARITY_CONFIG.consent.termsUrl);
  });
});
