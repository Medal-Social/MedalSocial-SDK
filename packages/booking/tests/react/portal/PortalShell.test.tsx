import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PortalSections } from '../../../src/react/portal/sections';
import type { PortalTab } from '../../../src/react/portal/tabs';
import { Kit } from './harness';

/** The source's shell props, by its section names, onto the package's sections. */
function PortalShell(props: {
  initialTab?: PortalTab;
  header: ReactNode;
  account: ReactNode;
  logout: ReactNode;
  oversikt: ReactNode;
  barn: ReactNode;
  historikk: ReactNode;
  profil: ReactNode;
}) {
  return (
    <Kit>
      {(booking) => (
        <PortalSections
          booking={booking}
          initialTab={props.initialTab}
          header={props.header}
          account={props.account}
          logout={props.logout}
          overview={props.oversikt}
          family={props.barn}
          history={props.historikk}
          profile={props.profil}
        />
      )}
    </Kit>
  );
}

/**
 * Min side's chrome — the rail on a desktop, the tab bar on a phone, and the
 * one piece of state both of them read.
 *
 * The behaviour worth pinning is not «a tab switches». It is that every section
 * is MOUNTED the whole time and merely hidden, because the sections are forms:
 * a half-edited child, a half-typed «SLETT» and a half-corrected name would all
 * be thrown away by a stray tap on «Historikk» if a tab unmounted its section,
 * and given back as «nothing happened».
 */

function renderShell() {
  return render(
    <PortalShell
      header={<h1>Hei Kari!</h1>}
      account={<p>Kari Nordmann</p>}
      logout={<button type="button">Logg ut</button>}
      oversikt={<p>Kommende timer</p>}
      barn={<input aria-label="Navn" defaultValue="" />}
      historikk={<p>Historikk-innhold</p>}
      profil={<p>Om deg</p>}
    />
  );
}

/** The section wrapper a given piece of content sits in. */
function sectionOf(text: string): HTMLElement {
  const node = screen.getByText(text).closest('section');
  if (node === null) throw new Error(`no section around ${text}`);
  return node;
}

/** Tap a destination in the desktop rail, which is the first of the two. */
function rail(label: string) {
  renderShell();
  fireEvent.click(screen.getAllByRole('button', { name: label })[0]);
}

describe('PortalShell', () => {
  it('opens on Oversikt, with the other three sections hidden', () => {
    renderShell();

    expect(sectionOf('Kommende timer')).not.toHaveAttribute('hidden');
    expect(sectionOf('Historikk-innhold')).toHaveAttribute('hidden');
    expect(sectionOf('Om deg')).toHaveAttribute('hidden');
  });

  it('offers all four destinations in both navigations', () => {
    renderShell();

    // Two navigations, one set of destinations. The bar has less room than the
    // rail, so the first one is «Hjem» down there and «Oversikt» up here — the
    // design labels them so.
    for (const label of ['Mine barn', 'Historikk', 'Profil']) {
      expect(screen.getAllByRole('button', { name: label })).toHaveLength(2);
    }
    expect(screen.getAllByRole('button', { name: 'Oversikt' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Hjem' })).toHaveLength(1);
  });

  it('switches sections from the rail', () => {
    rail('Historikk');

    expect(sectionOf('Historikk-innhold')).not.toHaveAttribute('hidden');
    expect(sectionOf('Kommende timer')).toHaveAttribute('hidden');
  });

  it('switches sections from the phone tab bar, and says which one is current', () => {
    renderShell();

    fireEvent.click(screen.getAllByRole('button', { name: 'Profil' })[1]);

    expect(sectionOf('Om deg')).not.toHaveAttribute('hidden');
    // Both navigations follow the one piece of state, so a tablet that rotates
    // mid-visit does not change where the parent is.
    for (const button of screen.getAllByRole('button', { name: 'Profil' })) {
      expect(button).toHaveAttribute('aria-current', 'page');
    }
    expect(screen.getByRole('button', { name: 'Oversikt' })).not.toHaveAttribute('aria-current');
  });

  /** The reason the sections are hidden rather than unmounted. */
  it('keeps what a parent has typed when they look at another section', () => {
    renderShell();
    fireEvent.change(screen.getByLabelText('Navn'), { target: { value: 'Theo' } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Historikk' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Mine barn' })[0]);

    expect(screen.getByLabelText('Navn')).toHaveValue('Theo');
  });

  /**
   * `hidden` and not a class, so a section nobody is looking at is out of the
   * accessibility tree and out of the tab order: a screen reader on «Oversikt»
   * must not walk into the delete-my-account form behind it. Role queries
   * respect that, which is what this measures.
   */
  it('keeps the hidden sections out of reach', () => {
    renderShell();

    // Only the rail's «Logg ut» is reachable; the copy at the foot of «Profil»
    // is inside a hidden section.
    expect(screen.getAllByRole('button', { name: 'Logg ut' })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Profil' })[0]);

    expect(screen.getAllByRole('button', { name: 'Logg ut' })).toHaveLength(2);
  });
});

/**
 * `?fane=` — the open section rides in the URL so a reload, or a link from an
 * e-mail, opens where the parent was. Written with `history.replaceState`, not
 * `router.replace`: the dashboard is `force-dynamic`, and a router navigation
 * would re-render it on the server — three upstream reads — for what is a
 * `hidden` attribute moving. Replace, not push: a tab is not a page, and Back
 * should leave Min side rather than walk back through every tab tapped.
 */
describe('PortalShell ?fane=', () => {
  function renderAt(url: string, initialTab?: PortalTab) {
    window.history.replaceState(null, '', url);
    return render(
      <PortalShell
        initialTab={initialTab}
        header={<h1>Hei Kari!</h1>}
        account={<p>Kari Nordmann</p>}
        logout={<button type="button">Logg ut</button>}
        oversikt={<p>Kommende timer</p>}
        barn={<p>Barn-innhold</p>}
        historikk={<p>Historikk-innhold</p>}
        profil={<p>Om deg</p>}
      />
    );
  }

  it('opens on the section the server read', () => {
    renderAt('/min-side?fane=historikk', 'history');
    expect(sectionOf('Historikk-innhold')).not.toHaveAttribute('hidden');
    expect(sectionOf('Kommende timer')).toHaveAttribute('hidden');
  });

  it('writes the section into the URL, replacing rather than pushing', () => {
    renderAt('/min-side');
    const before = window.history.length;

    fireEvent.click(screen.getAllByRole('button', { name: 'Mine barn' })[0]);
    expect(window.location.search).toBe('?fane=barn');
    fireEvent.click(screen.getAllByRole('button', { name: 'Profil' })[1]);
    expect(window.location.search).toBe('?fane=profil');

    expect(window.history.length).toBe(before);
    expect(sectionOf('Om deg')).not.toHaveAttribute('hidden');
  });

  it('drops the parameter for the overview, and keeps any other', () => {
    renderAt('/min-side?fra=epost&fane=profil', 'profile');

    fireEvent.click(screen.getAllByRole('button', { name: 'Oversikt' })[0]);

    expect(window.location.pathname).toBe('/min-side');
    expect(window.location.search).toBe('?fra=epost');
  });
});
