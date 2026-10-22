import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { OrderingMenuItem } from '../../src/core';
import { createMoney } from '../../src/core/money';
import { ItemSheet, type ItemSheetProps } from '../../src/react/ItemSheet';
import { axeViolations } from '../support/axe';
import { BURGER, FRIES, SAUCE, SOUP, WATER } from '../support/menu';

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
    const size = screen.getByRole('radiogroup', { name: /Size/ });
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
    expect(fewer).toBeDisabled();
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

  it('stops the quantity at 99 and the note at 200 characters', () => {
    sheet({ item: WATER, initial: { quantity: 99, selections: {}, note: '' } });
    expect(screen.getByRole('button', { name: 'Én til' })).toBeDisabled();
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

  it('has no axe violations, with an error showing too', async () => {
    const user = userEvent.setup();
    sheet({ item: { ...FRIES, modifier_groups: [...FRIES.modifier_groups, SAUCE] } });
    expect(await axeViolations(document.body)).toEqual([]);
    await user.click(screen.getByRole('button', { name: /Legg til/ }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
