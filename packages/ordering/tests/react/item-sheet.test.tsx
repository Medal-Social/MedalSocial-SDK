import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { OrderingMenuItem, OrderingModifierGroup } from '../../src/core';
import { createDraftStore } from '../../src/core/draft-store';
import { createMoney } from '../../src/core/money';
import { ItemSheet, type ItemSheetProps } from '../../src/react/ItemSheet';
import { axeViolations } from '../support/axe';
import { BURGER, EXTRAS, FRIES, SAUCE, SOUP, WATER } from '../support/menu';

/** Prices keep a no-break space before «kr». */
const NBSP = ' ';

function sheet(props: Partial<ItemSheetProps> = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <ItemSheet item={BURGER} open onClose={onClose} onAdd={onAdd} locale="nb" {...props} />
  );
  return { onAdd, onClose, ...view };
}

/** An opener button and the sheet it controls, as a page would wire them. */
function Opener({ item = BURGER }: { item?: OrderingMenuItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <ItemSheet item={item} open={open} onClose={() => setOpen(false)} onAdd={() => {}} />
    </>
  );
}

describe('ItemSheet', () => {
  it('required group blocks add', async () => {
    const user = userEvent.setup();
    const { onAdd } = sheet();
    const add = screen.getByRole('button', { name: /Legg til/ });
    expect(add).toHaveAttribute('aria-disabled', 'true');

    await user.click(add);
    expect(onAdd).not.toHaveBeenCalled();
    const size = screen.getByRole('radiogroup', { name: /Size/ });
    expect(within(size).getByText('Du må velge 1.')).toBeInTheDocument();
    expect(size).toHaveFocus();

    await user.click(screen.getByRole('radio', { name: /large/ }));
    expect(within(size).queryByText('Du må velge 1.')).not.toBeInTheDocument();
    expect(add).not.toHaveAttribute('aria-disabled');
    await user.click(add);
    expect(onAdd).toHaveBeenCalledWith({
      itemId: 'burger',
      quantity: 1,
      selections: { size: ['large'], extras: [] },
    });
  });

  it('max 1 renders radios', () => {
    sheet();
    const size = screen.getByRole('radiogroup', { name: 'Size' });
    expect(within(size).getAllByRole('radio')).toHaveLength(2);
    expect(within(size).getByText('Velg 1')).toBeInTheDocument();
    const extras = screen.getByRole('group', { name: /Extras/ });
    expect(within(extras).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(extras).queryAllByRole('radio')).toHaveLength(0);
    expect(within(extras).getByText('Velg opptil 3')).toBeInTheDocument();
  });

  it('offers «Ingen» in an optional single group, and marks sold-out options', async () => {
    const user = userEvent.setup();
    const { onAdd } = sheet({ item: FRIES });
    const dip = screen.getByRole('radiogroup', { name: /Dip/ });
    expect(within(dip).getByText('Valgfritt')).toBeInTheDocument();
    const none = within(dip).getByRole('radio', { name: 'Ingen' });
    expect(none).toBeChecked();
    const chili = within(dip).getByRole('radio', { name: /chili/ });
    expect(chili).toBeDisabled();
    expect(chili.closest('label')).toHaveTextContent('Utsolgt');
    expect(
      within(dip)
        .getByRole('radio', { name: /garlic/ })
        .closest('label')?.textContent
    ).toBe(`garlic+${NBSP}10${NBSP}kr`);

    await user.click(within(dip).getByRole('radio', { name: /garlic/ }));
    await user.click(none);
    await user.click(screen.getByRole('button', { name: /Legg til/ }));
    expect(onAdd).toHaveBeenCalledWith({ itemId: 'fries', quantity: 1, selections: { dip: [] } });
  });

  it('disables the unchecked boxes once a multi group is full', async () => {
    const user = userEvent.setup();
    sheet({ item: { ...BURGER, modifier_groups: [SAUCE] } });
    const sauce = screen.getByRole('group', { name: /Sauce/ });
    expect(within(sauce).getByText('Velg 1 til 2')).toBeInTheDocument();
    await user.click(within(sauce).getByRole('checkbox', { name: /^a/ }));
    await user.click(within(sauce).getByRole('checkbox', { name: /^c/ }));
    expect(within(sauce).getByRole('checkbox', { name: /^b/ })).toBeDisabled();
    await user.click(within(sauce).getByRole('checkbox', { name: /^c/ }));
    expect(within(sauce).getByRole('checkbox', { name: /^b/ })).toBeEnabled();
    expect(within(sauce).getByRole('checkbox', { name: /^x/ })).toBeDisabled();
  });

  it('prices the line: the unit price with the choices, times the quantity', async () => {
    const user = userEvent.setup();
    const { onAdd } = sheet();
    await user.click(screen.getByRole('radio', { name: /large/ }));
    await user.click(screen.getByRole('checkbox', { name: /no-onion/ }));
    expect(screen.getByRole('checkbox', { name: /no-onion/ }).closest('label')?.textContent).toBe(
      `no-onion−${NBSP}5${NBSP}kr`
    );
    const more = screen.getByRole('button', { name: 'Én til' });
    const fewer = screen.getByRole('button', { name: 'Én færre' });
    expect(fewer).toHaveAttribute('aria-disabled', 'true');
    await user.click(more);
    expect(screen.getByRole('button', { name: /Legg til/ }).textContent).toBe(
      `Legg til · 349${NBSP}kr`
    );
    await user.click(fewer);
    await user.click(more);
    await user.type(screen.getByLabelText(/Beskjed til kjøkkenet/), '  no salt  ');
    await user.click(screen.getByRole('button', { name: /Legg til/ }));
    expect(onAdd).toHaveBeenCalledWith({
      itemId: 'burger',
      quantity: 2,
      selections: { size: ['large'], extras: ['no-onion'] },
      note: 'no salt',
    });
  });

  it('hands over an explicit empty note when the note of an edited line is cleared', async () => {
    const user = userEvent.setup();
    const { onAdd } = sheet({
      item: WATER,
      initial: { quantity: 1, selections: {}, note: 'uten løk' },
    });
    await user.clear(screen.getByLabelText(/Beskjed til kjøkkenet/));
    await user.click(screen.getByRole('button', { name: /Oppdater/ }));
    const line = onAdd.mock.calls[0]?.[0];
    expect('note' in line).toBe(true);
    expect(line.note).toBeUndefined();
  });

  it('clears the note in the cart when an edited line is saved without one', async () => {
    const user = userEvent.setup();
    const drafts = createDraftStore({ site: 'demo' });
    const added = drafts.addLine({
      itemId: WATER.id,
      quantity: 1,
      selections: {},
      note: 'uten løk',
    });
    const lineId = added.lines[0]?.lineId ?? '';
    expect(added.lines[0]?.note).toBe('uten løk');
    const { onAdd } = sheet({
      item: WATER,
      initial: { quantity: 1, selections: {}, note: 'uten løk' },
    });
    await user.clear(screen.getByLabelText(/Beskjed til kjøkkenet/));
    await user.click(screen.getByRole('button', { name: /Oppdater/ }));
    const updated = drafts.updateLine(lineId, onAdd.mock.calls[0]?.[0]);
    expect(updated.lines[0]).not.toHaveProperty('note');
  });

  it('stops the quantity at 99 and the note at 200 characters', () => {
    sheet({ item: WATER, initial: { quantity: 99, selections: {}, note: '' } });
    const more = screen.getByRole('button', { name: 'Én til' });
    expect(more).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(more);
    expect(screen.getByText('99')).toBeInTheDocument();
    expect(screen.getByLabelText(/Beskjed til kjøkkenet/)).toHaveAttribute('maxlength', '200');
    expect(screen.getByRole('button', { name: /Oppdater/ })).toBeInTheDocument();
  });

  it('starts from a line being edited, dropping choices the dish no longer has', async () => {
    const user = userEvent.setup();
    const { onAdd } = sheet({
      initial: {
        quantity: 3,
        selections: { size: ['regular'], gone: ['x'] },
        note: 'well done',
      },
    });
    expect(screen.getByRole('radio', { name: /regular/ })).toBeChecked();
    expect(screen.getByLabelText(/Beskjed til kjøkkenet/)).toHaveValue('well done');
    await user.click(screen.getByRole('button', { name: /Oppdater/ }));
    expect(onAdd).toHaveBeenCalledWith({
      itemId: 'burger',
      quantity: 3,
      selections: { size: ['regular'], extras: [] },
      note: 'well done',
    });
  });

  it('names a choice that is no longer possible', async () => {
    const user = userEvent.setup();
    const { onAdd } = sheet({
      item: { ...BURGER, modifier_groups: [SAUCE] },
      initial: { quantity: 1, selections: { sauce: ['a', 'x'] } },
    });
    await user.click(screen.getByRole('button', { name: /Oppdater/ }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText('Ett av valgene her er ikke mulig lenger.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /^x/ }));
    expect(screen.queryByText('Ett av valgene her er ikke mulig lenger.')).not.toBeInTheDocument();
  });

  it('cannot add a sold-out dish', async () => {
    const user = userEvent.setup();
    const { onAdd } = sheet({ item: SOUP });
    const add = screen.getByRole('button', { name: /Legg til/ });
    expect(add).toBeDisabled();
    expect(screen.getByText('Denne retten er utsolgt.')).toBeInTheDocument();
    await user.click(add);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('is a labelled modal dialog that closes on Escape, the close button and the backdrop', async () => {
    const user = userEvent.setup();
    const { onClose } = sheet({ item: FRIES });
    const dialog = screen.getByRole('dialog', { name: 'Fries' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Crisp and salted.');
    expect(dialog).toHaveFocus();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Lukk' }));
    fireEvent.click(screen.getByTestId('ordering-sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    sheet({ item: WATER });
    const close = screen.getByRole('button', { name: 'Lukk' });
    const add = screen.getByRole('button', { name: /Legg til/ });
    add.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(add).toHaveFocus();
    // From the dialog itself, Shift+Tab wraps to the last control too.
    screen.getByRole('dialog').focus();
    await user.tab({ shift: true });
    expect(add).toHaveFocus();
    // Other keys and a Tab in the middle are left alone.
    close.focus();
    await user.tab();
    expect(close).not.toHaveFocus();
    await user.keyboard('a');
  });

  it('returns focus to the opener and locks the page scroll while open', async () => {
    const user = userEvent.setup();
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'open' });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('keeps focus in the dialog when a stepper reaches its end', async () => {
    const user = userEvent.setup();
    const { onClose } = sheet({ item: WATER, initial: { quantity: 2, selections: {} } });
    const dialog = screen.getByRole('dialog');
    const fewer = screen.getByRole('button', { name: 'Én færre' });
    fewer.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(fewer).toHaveAttribute('aria-disabled', 'true');
    expect(fewer).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Enter}');
    expect(screen.getByText('1')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drops options the dish no longer has from a line being edited, so none gets stuck', async () => {
    const user = userEvent.setup();
    const { onAdd } = sheet({
      initial: {
        quantity: 1,
        selections: { size: ['regular'], extras: ['cheese', 'gone', 'bacon'] },
      },
    });
    expect(screen.getByRole('checkbox', { name: /no-onion/ })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Oppdater/ }));
    expect(onAdd).toHaveBeenCalledWith({
      itemId: 'burger',
      quantity: 1,
      selections: { size: ['regular'], extras: ['cheese', 'bacon'] },
    });
  });

  it.each([
    [150.7, '99'],
    [0, '1'],
    [2.9, '2'],
    [Number.NaN, '1'],
  ])('clamps an edited line’s quantity %s to %s', (quantity, shown) => {
    sheet({ item: WATER, initial: { quantity, selections: {} } });
    expect(screen.getByRole('group', { name: 'Antall' })).toHaveTextContent(shown);
  });

  it('keeps the page from shifting when the scrollbar goes away', () => {
    const root = document.documentElement;
    const width = vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(window.innerWidth - 15);
    const { unmount } = sheet({ item: WATER });
    expect(root.style.paddingRight).toBe('15px');
    unmount();
    expect(root.style.paddingRight).toBe('');
    // No scrollbar to make up for: no padding.
    width.mockReturnValue(window.innerWidth);
    sheet({ item: WATER });
    expect(root.style.paddingRight).toBe('');
    width.mockRestore();
  });

  it('renders nothing while closed or without a dish', () => {
    const { container, rerender } = render(
      <ItemSheet item={BURGER} open={false} onClose={() => {}} onAdd={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<ItemSheet item={null} open onClose={() => {}} onAdd={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('writes English, with a site’s own money and words', () => {
    sheet({
      locale: 'en',
      money: createMoney({ locale: 'en-GB', currency: 'GBP' }),
      labels: { close: 'Shut' },
    });
    expect(screen.getByRole('button', { name: 'Shut' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add/ })).toHaveTextContent('Add · £149.50');
    expect(screen.getByText('Choose 1')).toBeInTheDocument();
  });

  it('survives a menu refetch that adds a group to the open dish', async () => {
    const user = userEvent.setup();
    const props = { open: true, onClose: () => {}, locale: 'nb' };
    const onAdd = vi.fn();
    const { rerender } = render(<ItemSheet item={BURGER} onAdd={onAdd} {...props} />);
    await user.click(screen.getByRole('radio', { name: /large/ }));
    const refetched = { ...BURGER, modifier_groups: [...BURGER.modifier_groups, SAUCE] };
    rerender(<ItemSheet item={refetched} onAdd={onAdd} {...props} />);
    const sauce = screen.getByRole('group', { name: /Sauce/ });
    expect(within(sauce).queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    expect(screen.getByRole('radio', { name: /large/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Legg til/ }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(within(sauce).getByText('Du må velge minst 1.')).toBeInTheDocument();
    await user.click(within(sauce).getByRole('checkbox', { name: /^a/ }));
    await user.click(screen.getByRole('button', { name: /Legg til/ }));
    expect(onAdd).toHaveBeenCalledWith({
      itemId: 'burger',
      quantity: 1,
      selections: { size: ['large'], extras: [], sauce: ['a'] },
    });
  });

  it('drops a chosen option the refetched dish no longer has, so it cannot get stuck', async () => {
    const user = userEvent.setup();
    const props = { open: true, onClose: () => {}, locale: 'nb' };
    const onAdd = vi.fn();
    const { rerender } = render(<ItemSheet item={BURGER} onAdd={onAdd} {...props} />);
    await user.click(screen.getByRole('radio', { name: /regular/ }));
    for (const name of [/cheese/, /bacon/, /no-onion/]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    const [size, extras] = BURGER.modifier_groups as [OrderingModifierGroup, OrderingModifierGroup];
    const withoutBacon = {
      ...extras,
      options: extras.options.filter((option) => option.id !== 'bacon'),
    };
    rerender(
      <ItemSheet
        item={{ ...BURGER, modifier_groups: [size, withoutBacon] }}
        onAdd={onAdd}
        {...props}
      />
    );
    expect(screen.queryByRole('checkbox', { name: /bacon/ })).not.toBeInTheDocument();
    // Two of three chosen now: the group is no longer full, and the price drops the bacon.
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2);
    await user.click(screen.getByRole('checkbox', { name: /cheese/ }));
    await user.click(screen.getByRole('button', { name: /Legg til/ }));
    expect(onAdd).toHaveBeenCalledWith({
      itemId: 'burger',
      quantity: 1,
      selections: { size: ['regular'], extras: ['no-onion'] },
    });
  });

  it('names each option’s allergens in words, even one the dish itself does not list', () => {
    const { unmount } = sheet();
    // Burger lists gluten only; the cheese option brings milk.
    const cheese = screen.getByRole('checkbox', { name: /cheese/ });
    expect(cheese).toHaveAccessibleName(/Allergener: Melk/);
    expect(screen.getByRole('checkbox', { name: /bacon/ })).not.toHaveAccessibleName(/Allergener/);
    unmount();
    sheet({ locale: 'en' });
    expect(screen.getByRole('checkbox', { name: /cheese/ })).toHaveAccessibleName(
      /Allergens: Milk/
    );
  });

  it('has no axe violations, with an error showing too', async () => {
    const user = userEvent.setup();
    sheet({ item: { ...FRIES, modifier_groups: [...FRIES.modifier_groups, SAUCE, EXTRAS] } });
    expect(await axeViolations(document.body)).toEqual([]);
    await user.click(screen.getByRole('button', { name: /Legg til/ }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
