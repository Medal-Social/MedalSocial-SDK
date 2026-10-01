import type { RebookSuggestion } from '@medalsocial/meda/booking';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRebookStore } from '../../../src/core/rebook-store';
import { bookAgainHref } from '../../../src/react/portal/book-again';
import { PortalRebookCards } from '../../../src/react/portal/wired';
import { PARITY_CONFIG } from '../../support/parity-config';
import { Kit } from './harness';

const { takeRebookWho } = createRebookStore(PARITY_CONFIG.storageNamespace);
const rebookHref = (suggestion: RebookSuggestion) =>
  bookAgainHref(PARITY_CONFIG, PARITY_CONFIG.paths.booking, suggestion);

function RebookCards({ suggestions }: { suggestions: RebookSuggestion[] }) {
  return (
    <Kit>{(booking) => <PortalRebookCards booking={booking} suggestions={suggestions} />}</Kit>
  );
}

/**
 * The contract has two halves: `BookingWizard` reads `service` and `stylist`
 * off the query string (a missing key is «no choice»), and the child's name
 * from the tab's session store — never from the URL, which is history, access
 * log and analytics. Dedupe and ordering are `rebookSuggestions`'s and tested
 * there.
 */

const FULL: RebookSuggestion = {
  serviceId: 'svc-gutt',
  serviceName: 'Gutteklipp',
  resourceId: 'res-bjarne',
  resourceName: 'Bjarne',
  bookedForName: 'Jonas Ø',
};

describe('RebookCards', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("builds the prefill href from catalogue ids only — never the child's name", () => {
    expect(rebookHref(FULL)).toBe('/bestill?service=svc-gutt&stylist=res-bjarne');
    expect(rebookHref(FULL)).not.toContain('Jonas');
  });

  it('omits stylist when none was chosen', () => {
    expect(rebookHref({ ...FULL, resourceId: null, resourceName: null })).toBe(
      '/bestill?service=svc-gutt'
    );
  });

  it("stashes the child's name for the wizard on the tap, in this tab only", () => {
    render(<RebookCards suggestions={[FULL]} />);

    fireEvent.click(screen.getByRole('link', { name: 'Bestill samme' }));

    expect(takeRebookWho()).toBe('Jonas Ø');
  });

  it('clears a name an earlier tap left behind when the booking named no child', () => {
    // Cmd-click on a named card opens its wizard in ANOTHER tab, so this tab's
    // stash is never taken; the next tap here must not hand that name on.
    render(
      <RebookCards suggestions={[FULL, { ...FULL, resourceId: null, bookedForName: null }]} />
    );
    const [named, unnamed] = screen.getAllByRole('link', { name: 'Bestill samme' });

    fireEvent.click(named);
    fireEvent.click(unnamed);

    expect(takeRebookWho()).toBeNull();
  });

  it('renders a card per suggestion linking to that href', () => {
    render(
      <RebookCards
        suggestions={[FULL, { ...FULL, resourceId: null, resourceName: null, bookedForName: null }]}
      />
    );

    expect(screen.getByRole('heading', { name: 'Bestill igjen' })).toBeInTheDocument();
    expect(screen.getByText('Gutteklipp · Jonas Ø · Bjarne')).toBeInTheDocument();
    expect(screen.getByText('Gutteklipp · Første ledige')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Bestill samme' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/bestill?service=svc-gutt&stylist=res-bjarne',
      '/bestill?service=svc-gutt',
    ]);
  });

  /** The section keeps its place on the overview — and its heading — with a
   * sentence rather than vanishing, so the page does not change shape
   * between a new parent and a returning one (or against `loading.tsx`). */
  it('keeps its heading and says so when there is nothing to offer', () => {
    render(<RebookCards suggestions={[]} />);

    expect(screen.getByRole('heading', { name: 'Bestill igjen' })).toBeInTheDocument();
    expect(
      screen.getByText('Når dere har vært hos oss, kan du bestille det samme igjen herfra.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Bestill samme' })).not.toBeInTheDocument();
  });
});
