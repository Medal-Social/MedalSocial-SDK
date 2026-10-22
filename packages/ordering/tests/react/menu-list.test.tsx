import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMoney } from '../../src/core/money';
import { MenuList, type MenuListProps } from '../../src/react/MenuList';
import { axeViolations } from '../support/axe';
import { BURGER, FRIES, MENU } from '../support/menu';

const NBSP = ' ';
const NOW = new Date('2026-10-22T07:30:00Z');

function menuList(props: Partial<MenuListProps> = {}) {
  const onSelectItem = vi.fn();
  const view = render(<MenuList menu={MENU} onSelectItem={onSelectItem} {...props} />);
  return { onSelectItem, ...view };
}

describe('MenuList', () => {
  it('links each category with dishes from a sticky list, to its section', () => {
    menuList();
    const nav = screen.getByRole('navigation', { name: 'Kategorier' });
    expect(nav.className).toContain('sticky');
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Mains', 'Sides']);
    const sides = screen.getByRole('region', { name: 'Sides' });
    expect(sides).toHaveAttribute('id', 'ordering-category-sides');
    expect(links[1]).toHaveAttribute('href', '#ordering-category-sides');
    expect(screen.queryByRole('heading', { name: 'Nothing here' })).not.toBeInTheDocument();
  });

  it('shows a dish: photo, name, description, price, allergens and dietary marks', () => {
    menuList();
    const fries = screen.getByRole('article', { name: 'Fries' });
    // Decorative: the name is already the heading and the button.
    const photo = fries.querySelector('img') as HTMLImageElement;
    expect(photo).toHaveAttribute('alt', '');
    expect(photo).toHaveAttribute('loading', 'lazy');
    expect(photo).toHaveAttribute('src', FRIES.image_url);
    expect(fries).toHaveTextContent('Crisp and salted.');
    expect(fries).toHaveTextContent(`49${NBSP}kr`);
    const allergens = within(fries).getByRole('list', { name: 'Allergener' });
    expect(
      within(allergens)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Selleri', 'Sennep']);
    const marks = within(fries).getByRole('list', { name: 'Om retten' });
    expect(marks).toHaveTextContent('Vegansk');
    expect(marks).toHaveTextContent('Glutenfri');

    const burger = screen.getByRole('article', { name: 'Burger' });
    expect(within(burger).queryByRole('img')).not.toBeInTheDocument();
    expect(within(burger).queryByRole('list', { name: 'Om retten' })).not.toBeInTheDocument();
    const water = screen.getByRole('article', { name: 'Water' });
    expect(within(water).queryByRole('list', { name: 'Allergener' })).not.toBeInTheDocument();
  });

  it('builds section anchors from category ids, made safe for a fragment', () => {
    render(
      <MenuList
        menu={{ ...MENU, categories: [{ id: 'Hot dishes!', name: 'Hot', items: [BURGER] }] }}
        onSelectItem={() => {}}
      />
    );
    expect(screen.getByRole('link', { name: 'Hot' }).getAttribute('href')).toMatch(
      /^#ordering-category-Hot-dishes--[0-9a-z]+$/
    );
  });

  it('gives ids that sanitise alike their own anchors, the same on every render', () => {
    const menu = {
      ...MENU,
      categories: [
        { id: 'a.b', name: 'Dotted', items: [BURGER] },
        { id: 'a-b', name: 'Dashed', items: [FRIES] },
      ],
    };
    const { unmount } = render(<MenuList menu={menu} onSelectItem={() => {}} />);
    const anchors = ['Dotted', 'Dashed'].map((name) => {
      const href = screen.getByRole('link', { name }).getAttribute('href') as string;
      const section = screen.getByRole('region', { name });
      // The tab, the section and its heading agree.
      expect(href).toBe(`#${section.id}`);
      expect(section).toHaveAttribute('aria-labelledby', `${section.id}-title`);
      expect(screen.getByRole('heading', { name })).toHaveAttribute('id', `${section.id}-title`);
      return section.id;
    });
    expect(anchors[1]).toBe('ordering-category-a-b');
    expect(anchors[0]).toMatch(/^ordering-category-a-b-[0-9a-z]+$/);
    expect(new Set(anchors).size).toBe(2);
    unmount();
    // Stable: a later render, or the category alone, gives the same anchor.
    render(
      <MenuList menu={{ ...menu, categories: [menu.categories[0]] }} onSelectItem={() => {}} />
    );
    expect(screen.getByRole('region', { name: 'Dotted' }).id).toBe(anchors[0]);
  });

  it('hands the chosen dish to the page', async () => {
    const user = userEvent.setup();
    const { onSelectItem } = menuList();
    await user.click(screen.getByRole('button', { name: 'Burger' }));
    expect(onSelectItem).toHaveBeenCalledWith(BURGER);
  });

  it('marks a sold-out dish and does not let it be chosen', async () => {
    const user = userEvent.setup();
    const { onSelectItem } = menuList();
    const soup = screen.getByRole('button', { name: 'Soup' });
    expect(soup).toHaveAttribute('aria-disabled', 'true');
    expect(soup).toHaveAccessibleDescription(/^99\skr Utsolgt$/);
    await user.click(soup);
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it('shows the closed notice and lets nothing be ordered while closed', async () => {
    const user = userEvent.setup();
    const { onSelectItem } = menuList({
      closed: { nextOpenAt: '2026-10-23T09:00:00Z', timeZone: 'Europe/Oslo' },
      now: NOW,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Åpner i morgen kl. 11:00');
    const burger = screen.getByRole('button', { name: 'Burger' });
    expect(burger).toHaveAttribute('aria-disabled', 'true');
    expect(burger).toHaveAccessibleDescription(
      /^149,50\skr Restauranten tar ikke imot bestillinger nå\. Åpner i morgen kl\. 11:00$/
    );
    await user.click(burger);
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it('says so when the menu has no dishes', () => {
    render(
      <MenuList
        menu={{ ...MENU, categories: [{ id: 'empty', name: 'Empty', items: [] }] }}
        onSelectItem={() => {}}
        locale="en"
      />
    );
    expect(screen.getByText('There is nothing on the menu right now.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('writes English, with a site’s own money and words', () => {
    menuList({
      locale: 'en-GB',
      money: createMoney({ locale: 'en-GB', currency: 'GBP' }),
      labels: { categories: 'Sections' },
    });
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    const fries = screen.getByRole('article', { name: 'Fries' });
    expect(fries).toHaveTextContent('£49');
    expect(within(fries).getByRole('list', { name: 'Allergens' })).toHaveTextContent('Celery');
  });

  it('has no axe violations, open or closed', async () => {
    const { container, rerender } = menuList();
    expect(await axeViolations(container)).toEqual([]);
    rerender(<MenuList menu={MENU} onSelectItem={() => {}} closed={{}} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
