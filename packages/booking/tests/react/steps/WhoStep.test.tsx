import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { childLine, LIMIT_SENTENCE, personForChild, WhoStep } from '../../support/legacy-steps';

/**
 * Step 1, on its own: the two shapes (chips for a guest, cards for a known
 * parent), what a tap says to the machine, and the fixed sizes that keep a
 * login or a new child from moving anything sideways.
 */

const DAY = '2026-09-02';

describe('WhoStep', () => {
  it('gives a guest four chips, each the whole answer', () => {
    const onChoose = vi.fn();
    render(
      <WhoStep people={[]} family={null} dayKey={DAY} onChoose={onChoose} onAddChild={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('radio', { name: '2 barn' }));
    expect(onChoose).toHaveBeenCalledWith([{ key: 'guest:1' }, { key: 'guest:2' }], true);

    fireEvent.click(screen.getByRole('radio', { name: 'Voksen' }));
    expect(onChoose).toHaveBeenLastCalledWith([{ key: 'adult', adult: true }], true);
    // Every chip the same height, so the row does not reflow as one is pressed.
    for (const chip of ['1 barn', '2 barn', '3 barn', 'Voksen']) {
      expect(screen.getByRole('radio', { name: chip })).toHaveClass('h-12');
    }
  });

  it('shows the pressed chip for the party already chosen', () => {
    render(
      <WhoStep
        people={[{ key: 'guest:1' }, { key: 'guest:2' }, { key: 'guest:3' }]}
        family={null}
        dayKey={DAY}
        onChoose={vi.fn()}
        onAddChild={vi.fn()}
      />
    );

    expect(
      screen.getByRole('radiogroup', { name: 'Hvor mange skal klippes?' })
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '3 barn' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '1 barn' })).toHaveAttribute('aria-checked', 'false');
    // Roving focus: the chosen chip is the group's one tab stop.
    expect(screen.getByRole('radio', { name: '3 barn' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: '1 barn' })).toHaveAttribute('tabindex', '-1');
  });

  it('ticks and unticks a known parent’s children without moving on', () => {
    const onChoose = vi.fn();
    const theo = { name: 'Theo', birthYear: 2019, personId: 'p-theo' };
    const { rerender } = render(
      <WhoStep people={[]} family={[theo]} dayKey={DAY} onChoose={onChoose} onAddChild={vi.fn()} />
    );

    const card = screen.getByRole('checkbox', { name: /Theo/ });
    // One fixed height for every card, whatever line it carries.
    expect(card.closest('label')).toHaveClass('h-[4.5rem]');
    expect(screen.getByRole('group', { name: 'Velg opptil tre' })).toContainElement(card);
    fireEvent.click(card);
    expect(onChoose).toHaveBeenCalledWith([personForChild(theo, 0)], false);

    rerender(
      <WhoStep
        people={[personForChild(theo, 0)]}
        family={[theo]}
        dayKey={DAY}
        onChoose={onChoose}
        onAddChild={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Theo/ }));
    expect(onChoose).toHaveBeenLastCalledWith([], false);
  });

  it('says the age on the day — exact with a month, a range without', () => {
    expect(childLine({ name: 'Emma', birthYear: 2021, birthMonth: 4 }, DAY)).toBe('5 år');
    expect(childLine({ name: 'Emma', birthYear: 2021, birthMonth: 10 }, DAY)).toBe('4 år');
    expect(childLine({ name: 'Theo', birthYear: 2019 }, DAY)).toBe('6–7 år');
  });

  it('seats a saved child by id', () => {
    expect(
      personForChild({ name: 'Theo', birthYear: 2019, personId: 'p-theo', birthMonth: 3 }, 4)
    ).toEqual({
      key: 'p:p-theo',
      personId: 'p-theo',
      name: 'Theo',
      birthYear: 2019,
      birthMonth: 3,
    });
  });

  it('moves focus between the chips with the arrows, without choosing', async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(
      <WhoStep people={[]} family={null} dayKey={DAY} onChoose={onChoose} onAddChild={vi.fn()} />
    );

    screen.getByRole('radio', { name: '1 barn' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '2 barn' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Voksen' })).toHaveFocus();
    expect(onChoose).not.toHaveBeenCalled();
  });

  describe('at the limit of three', () => {
    const FAMILY = [
      { name: 'Theo', birthYear: 2019, personId: 'p-theo' },
      { name: 'Emma', birthYear: 2021, personId: 'p-emma' },
      { name: 'Ella', birthYear: 2017, personId: 'p-ella' },
      { name: 'Nora', birthYear: 2016, personId: 'p-nora' },
    ];
    const THREE = FAMILY.slice(0, 3).map(personForChild);

    it('keeps the fourth card focusable but inert, and says why', () => {
      const onChoose = vi.fn();
      render(
        <WhoStep
          people={THREE}
          family={FAMILY}
          dayKey={DAY}
          onChoose={onChoose}
          onAddChild={vi.fn()}
        />
      );

      const nora = screen.getByRole('checkbox', { name: /Nora/ });
      expect(nora).toHaveAttribute('aria-disabled', 'true');
      expect(nora).not.toBeDisabled();
      expect(nora).toHaveAccessibleDescription(LIMIT_SENTENCE);
      expect(screen.getByRole('checkbox', { name: 'Meg selv (voksen)' })).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      fireEvent.click(nora);
      expect(onChoose).not.toHaveBeenCalled();

      // Announced in a region that is always mounted.
      expect(screen.getByText(LIMIT_SENTENCE)).toHaveAttribute('aria-live', 'polite');
      // No fourth child from the sheet either.
      expect(screen.getByRole('button', { name: /Legg til barn/ })).toBeDisabled();

      // A ticked card still unticks.
      fireEvent.click(screen.getByRole('checkbox', { name: /Theo/ }));
      expect(onChoose).toHaveBeenCalledWith(THREE.slice(1), false);
    });

    it('counts only the seats it draws — a stray guest seat is neither counted nor kept', () => {
      const onChoose = vi.fn();
      render(
        <WhoStep
          people={[{ key: 'guest:1' }, { key: 'guest:2' }, THREE[0]]}
          family={FAMILY}
          dayKey={DAY}
          onChoose={onChoose}
          onAddChild={vi.fn()}
        />
      );

      expect(screen.queryByText(LIMIT_SENTENCE)).toBeNull();
      fireEvent.click(screen.getByRole('checkbox', { name: /Emma/ }));
      expect(onChoose).toHaveBeenCalledWith([THREE[0], THREE[1]], false);
    });
  });

  it('adds a child from the sheet with what the parent typed', async () => {
    const onAddChild = vi.fn(async () => ({ ok: true as const }));
    const user = userEvent.setup();
    render(
      <WhoStep people={[]} family={[]} dayKey={DAY} onChoose={vi.fn()} onAddChild={onAddChild} />
    );

    await user.click(screen.getByRole('button', { name: /Legg til barn/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Navn'), 'Theo');
    await user.selectOptions(within(dialog).getByLabelText('Fødselsår'), '2019');
    await user.selectOptions(within(dialog).getByLabelText('Fødselsmåned (valgfritt)'), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Legg til' }));

    await waitFor(() =>
      expect(onAddChild).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Theo', birthYear: 2019, birthMonth: 3 })
      )
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('seats two children with the same name and year and no ids as two people', () => {
    const onChoose = vi.fn();
    const twins = [
      { name: 'Emma', birthYear: 2018 },
      { name: 'Emma', birthYear: 2018 },
    ];
    const { rerender } = render(
      <WhoStep people={[]} family={twins} dayKey={DAY} onChoose={onChoose} onAddChild={vi.fn()} />
    );

    const [first, second] = screen.getAllByRole('checkbox', { name: /Emma/ });
    fireEvent.click(first);
    const seated = onChoose.mock.calls[0][0];
    expect(seated).toHaveLength(1);
    rerender(
      <WhoStep
        people={seated}
        family={twins}
        dayKey={DAY}
        onChoose={onChoose}
        onAddChild={vi.fn()}
      />
    );

    // Ticking one ticks one: the other Emma is still her own card.
    const [firstAgain, secondAgain] = screen.getAllByRole('checkbox', { name: /Emma/ });
    expect(firstAgain).toBeChecked();
    expect(secondAgain).not.toBeChecked();
    fireEvent.click(secondAgain);
    const both = onChoose.mock.calls[1][0];
    expect(both).toHaveLength(2);
    expect(new Set(both.map((person: { key: string }) => person.key)).size).toBe(2);
    expect(second).toBeDefined();
  });

  it('keys a child by id when Medal has one, else by place in the list', () => {
    expect(personForChild({ name: 'Emma', birthYear: 2018, personId: 'p-emma' }, 3).key).toBe(
      'p:p-emma'
    );
    expect(personForChild({ name: 'Emma', birthYear: 2018 }, 0).key).not.toBe(
      personForChild({ name: 'Emma', birthYear: 2018 }, 1).key
    );
  });
});
