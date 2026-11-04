import type { DeliveryAddressSuggestion, DeliveryResolvedAddress } from '@medalsocial/sdk';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteResult } from '../../src/core/client';
import { AddressCombobox, type AddressComboboxProps } from '../../src/react/AddressCombobox';
import { axeViolations } from '../support/axe';

const SUGGESTIONS: DeliveryAddressSuggestion[] = [
  { id: 'kv_1', label: 'Storgata 1', secondary: '0155 Oslo' },
  { id: 'kv_2', label: 'Storgata 10', secondary: '0155 Oslo' },
  { id: 'kv_3', label: 'Storgata 12', secondary: '0155 Oslo' },
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

type Suggest = AddressComboboxProps['suggest'];
type Resolve = AddressComboboxProps['resolve'];

afterEach(() => {
  vi.useRealTimers();
});

function combobox(props: Partial<AddressComboboxProps> = {}) {
  const suggest = vi.fn<Suggest>(async () => ({ ok: true, data: SUGGESTIONS }));
  const resolve = vi.fn<Resolve>(async () => ({ ok: true, data: ADDRESS }));
  const onResolved = vi.fn();
  const view = render(
    <AddressCombobox suggest={suggest} resolve={resolve} onResolved={onResolved} {...props} />
  );
  const input = screen.getByRole('combobox');
  return { suggest, resolve, onResolved, input, user: userEvent.setup(), ...view };
}

/** The live region's words. */
function announced(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? '';
}

describe('AddressCombobox', () => {
  it('asks for suggestions 250 ms after the last keystroke, with one session', async () => {
    vi.useFakeTimers();
    const suggest = vi.fn<Suggest>(async () => ({ ok: true, data: SUGGESTIONS }));
    render(<AddressCombobox suggest={suggest} resolve={vi.fn()} onResolved={vi.fn()} />);
    const input = screen.getByRole('combobox');
    const type = (value: string) => fireEvent.change(input, { target: { value } });
    type('st');
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    // Under three letters there is nothing to look up.
    expect(suggest).not.toHaveBeenCalled();
    type('sto');
    type('storg');
    await act(async () => vi.advanceTimersByTimeAsync(249));
    expect(suggest).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(suggest).toHaveBeenCalledOnce();
    const [q, session, signal] = suggest.mock.calls[0] ?? [];
    expect(q).toBe('storg');
    expect(session).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(signal).toBeInstanceOf(AbortSignal);
    type('storga');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(suggest.mock.calls[1]?.[1]).toBe(session);
    expect(signal?.aborted).toBe(true);
  });

  it('is a combobox controlling a listbox, and announces how many it found', async () => {
    const { input, user } = combobox();
    expect(screen.getByRole('combobox', { name: 'Adresse' })).toBe(input);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await user.type(input, 'storgata');
    const list = await screen.findByRole('listbox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', list.id);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Storgata 10155 Oslo',
      'Storgata 100155 Oslo',
      'Storgata 120155 Oslo',
    ]);
    expect(announced()).toBe('3 adresser');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('moves through the options with the arrow keys, wrapping, and picks one with Enter', async () => {
    const { input, user, resolve, onResolved, suggest } = combobox();
    await user.type(input, 'storgata');
    await screen.findByRole('listbox');
    const options = screen.getAllByRole('option');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', options[2]?.id);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    await user.keyboard('{Enter}');
    const session = suggest.mock.calls[0]?.[1];
    expect(resolve).toHaveBeenCalledWith('kv_1', session);
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(ADDRESS));
    expect(input).toHaveValue('Storgata 1, 0155 Oslo');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveFocus();
    // The lookup is done: the next one is a new session.
    await user.clear(input);
    expect(onResolved).toHaveBeenLastCalledWith(null);
    await user.type(input, 'kirkeveien');
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(2));
    expect(suggest.mock.calls[1]?.[1]).not.toBe(session);
  });

  it('starts a new lookup session after a pick, even when typing goes on while it is checked', async () => {
    let finish: (value: RouteResult<DeliveryResolvedAddress>) => void = () => {};
    const resolve = vi.fn<Resolve>(
      () =>
        new Promise((done) => {
          finish = done;
        })
    );
    const { input, user, suggest } = combobox({ resolve });
    await user.type(input, 'storgata');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    const picked = suggest.mock.calls[0]?.[1];
    expect(resolve).toHaveBeenCalledWith('kv_1', picked);
    // Typing again before the check answers: that turn wins, the pick's answer is stale.
    await user.clear(input);
    await user.type(input, 'kirkeveien');
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(2));
    expect(suggest.mock.calls[1]?.[1]).not.toBe(picked);
    await act(async () => finish({ ok: true, data: ADDRESS }));
    expect(input).toHaveValue('kirkeveien');
  });

  it('closes with Escape and on leaving the field, and opens again with the arrows', async () => {
    const { input, user } = combobox();
    await user.type(input, 'storgata');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(input).toHaveValue('storgata');
    await user.keyboard('{Escape}{Enter}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]?.id);
    await user.keyboard('{Escape}{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]?.id);
    await user.tab();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('leaving the field during the wait drops the lookup still to come', async () => {
    vi.useFakeTimers();
    const suggest = vi.fn<Suggest>(async () => ({ ok: true, data: SUGGESTIONS }));
    render(<AddressCombobox suggest={suggest} resolve={vi.fn()} onResolved={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'storgata' } });
    fireEvent.blur(input);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(suggest).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('leaving the field while a lookup is on its way keeps its answer from opening the list', async () => {
    let answer: (r: RouteResult<DeliveryAddressSuggestion[]>) => void = () => {};
    const suggest = vi.fn<Suggest>(() => new Promise((resolve) => (answer = resolve)));
    const { input, user } = combobox({ suggest });
    await user.type(input, 'storgata');
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    const signal = suggest.mock.calls[0]?.[2];
    await user.tab();
    expect(signal?.aborted).toBe(true);
    await act(async () => answer({ ok: true, data: SUGGESTIONS }));
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(announced()).toBe('');
  });

  it('a pointer pick wins over the blur: pressing an option keeps the focus and picks it', async () => {
    const { input, user, resolve, onResolved } = combobox();
    await user.type(input, 'storgata');
    const option = await screen.findByRole('option', { name: /Storgata 12/ });
    // The press is prevented, so the field never blurs and the list stays.
    expect(fireEvent.mouseDown(option)).toBe(false);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.click(option);
    expect(resolve).toHaveBeenCalledWith('kv_3', expect.any(String));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(ADDRESS));
  });

  it('leaving the field while the pick is checked keeps the verified address', async () => {
    let finish: (r: RouteResult<DeliveryResolvedAddress>) => void = () => {};
    const resolve = vi.fn<Resolve>(() => new Promise((r) => (finish = r)));
    const { input, user, onResolved } = combobox({ resolve });
    await user.type(input, 'storgata');
    await user.click(await screen.findByRole('option', { name: /Storgata 12/ }));
    await user.tab();
    await act(async () => finish({ ok: true, data: ADDRESS }));
    expect(onResolved).toHaveBeenCalledWith(ADDRESS);
    expect(input).toHaveValue('Storgata 1, 0155 Oslo');
  });

  it('Enter with the list open and nothing chosen does nothing', async () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const suggest = vi.fn<Suggest>(async () => ({ ok: true, data: SUGGESTIONS }));
    const resolve = vi.fn<Resolve>();
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <AddressCombobox suggest={suggest} resolve={resolve} onResolved={vi.fn()} />
        <button type="submit">Send</button>
      </form>
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'storgata');
    await screen.findByRole('listbox');
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('picks an option with a click, keeping the focus in the field', async () => {
    const { input, user, resolve, onResolved } = combobox();
    await user.type(input, 'storgata');
    await user.click(await screen.findByRole('option', { name: /Storgata 12/ }));
    expect(resolve).toHaveBeenCalledWith('kv_3', expect.any(String));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(ADDRESS));
    expect(input).toHaveFocus();
  });

  it('says so when nothing is found, and when the lookup fails', async () => {
    const { input, user, suggest } = combobox();
    suggest.mockResolvedValueOnce({ ok: true, data: [] });
    await user.type(input, 'xyzzy');
    await waitFor(() => expect(announced()).toBe('Fant ingen adresser.'));
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    suggest.mockResolvedValueOnce({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'x' },
    });
    await user.type(input, 'q');
    await waitFor(() => expect(announced()).toBe('Noe gikk galt. Prøv igjen om litt.'));
    suggest.mockRejectedValueOnce(new Error('offline'));
    await user.type(input, 'r');
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(announced()).toBe('Noe gikk galt. Prøv igjen om litt.'));
    expect(screen.getByRole('listbox', { hidden: true })).not.toBeVisible();
  });

  it('shows one found address in the singular, in English', async () => {
    const { user, suggest } = combobox({ locale: 'en' });
    suggest.mockResolvedValueOnce({
      ok: true,
      data: [SUGGESTIONS[0] as DeliveryAddressSuggestion],
    });
    await user.type(screen.getByRole('combobox', { name: 'Address' }), 'storgata 1');
    await waitFor(() => expect(announced()).toBe('1 address'));
  });

  it('keeps only the latest lookup’s suggestions', async () => {
    const answers: ((r: RouteResult<DeliveryAddressSuggestion[]>) => void)[] = [];
    const suggest = vi.fn<Suggest>(() => new Promise((resolve) => answers.push(resolve)));
    const { input, user } = combobox({ suggest });
    await user.type(input, 'sto');
    await waitFor(() => expect(answers).toHaveLength(1));
    await user.type(input, 'rgata');
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1]?.({ ok: true, data: [SUGGESTIONS[1] as never] }));
    await act(async () => answers[0]?.({ ok: true, data: SUGGESTIONS }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    // Cleared under three letters: a late answer opens nothing.
    await user.clear(input);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('asks for the house number when the address is not verified, tied to the field', async () => {
    const { input, user, resolve, onResolved, suggest } = combobox();
    resolve.mockResolvedValueOnce({
      ok: false,
      error: { code: 'ADDRESS_NOT_VERIFIED', message: 'Not verified.' },
    });
    await user.type(input, 'storgata');
    await user.click(await screen.findByRole('option', { name: /Storgata 12/ }));
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(input).toHaveAccessibleDescription(
      'Gate og husnummer, for eksempel Storgata 1. Vi fant ikke adressen. Husk husnummer.'
    );
    expect(onResolved).not.toHaveBeenCalled();
    expect(input).toHaveValue('Storgata 12, 0155 Oslo');
    const first = suggest.mock.calls[0]?.[1];
    await user.type(input, ' B');
    expect(input).not.toHaveAttribute('aria-invalid');
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(2));
    expect(suggest.mock.calls[1]?.[1]).not.toBe(first);
  });

  it('reads a resolve that throws as try again, and shows that it is checking', async () => {
    let fail: (e: Error) => void = () => {};
    const resolve = vi.fn<Resolve>(() => new Promise((_r, reject) => (fail = reject)));
    const { input, user } = combobox({ resolve });
    await user.type(input, 'storgata');
    await user.click(await screen.findByRole('option', { name: /Storgata 12/ }));
    expect(announced()).toBe('Sjekker adressen …');
    await act(async () => fail(new Error('offline')));
    expect(input).toHaveAccessibleDescription(
      'Gate og husnummer, for eksempel Storgata 1. Noe gikk galt. Prøv igjen om litt.'
    );
  });

  it('drops a resolve the guest typed past, and anything after unmounting', async () => {
    let finish: (r: RouteResult<DeliveryResolvedAddress>) => void = () => {};
    const resolve = vi.fn<Resolve>(() => new Promise((r) => (finish = r)));
    const { input, user, onResolved, suggest, unmount } = combobox({ resolve });
    await user.type(input, 'storgata');
    await user.click(await screen.findByRole('option', { name: /Storgata 12/ }));
    await user.type(input, 'x');
    await act(async () => finish({ ok: true, data: ADDRESS }));
    expect(onResolved).not.toHaveBeenCalled();
    await user.type(input, 'y');
    unmount();
    await new Promise((r) => setTimeout(r, 300));
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('starts from a value, which an edit takes away, and takes the site’s words', async () => {
    const onResolved = vi.fn();
    render(
      <AddressCombobox
        suggest={vi.fn(async () => ({ ok: true as const, data: [] }))}
        resolve={vi.fn()}
        onResolved={onResolved}
        initialValue="Storgata 1, 0155 Oslo"
        labels={{ address: 'Hvor bor du?' }}
      />
    );
    const input = screen.getByRole('combobox', { name: 'Hvor bor du?' });
    expect(input).toHaveValue('Storgata 1, 0155 Oslo');
    await userEvent.setup().type(input, 'x');
    expect(onResolved).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('has options at least 44 px tall', async () => {
    const { input, user } = combobox();
    await user.type(input, 'storgata');
    for (const option of await screen.findAllByRole('option')) {
      expect(option.className).toContain('min-h-11');
    }
  });

  it('has no axe violations, open or with an error', async () => {
    const { container, input, user, resolve } = combobox();
    await user.type(input, 'storgata');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}');
    expect(await axeViolations(container)).toEqual([]);
    resolve.mockResolvedValueOnce({
      ok: false,
      error: { code: 'ADDRESS_NOT_VERIFIED', message: 'x' },
    });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(await axeViolations(container)).toEqual([]);
  });
});
