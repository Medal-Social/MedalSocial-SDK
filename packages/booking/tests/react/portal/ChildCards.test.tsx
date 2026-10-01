import type { ChildSummary } from '@medalsocial/meda/booking';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { PortalChildCards } from '../../../src/react/portal/wired';
import { TEST_LABELS } from '../../support/labels';
import { Kit } from './harness';

const NO_CHILDREN = TEST_LABELS['childCards.empty'] as string;

function ChildCards(props: Omit<ComponentProps<typeof PortalChildCards>, 'booking'>) {
  return <Kit>{(booking) => <PortalChildCards booking={booking} {...props} />}</Kit>;
}

const JONAS: ChildSummary = {
  personId: 'p-jonas',
  name: 'Jonas',
  birthYear: 2018,
  birthMonth: null,
  ageRange: { min: 7, max: 8 },
  age: 8,
  lastVisitTs: null,
  serviceId: null,
  serviceName: null,
  resourceId: null,
  preferredResourceId: null,
  nextVisitTs: null,
};

/**
 * The empty case only: a new parent's overview keeps its «Mine barn» section
 * with a sentence rather than losing it, and the tab that has an editor right
 * below can opt out of saying it twice.
 */
describe('ChildCards with no children', () => {
  it('says so instead of rendering nothing', () => {
    render(<ChildCards kids={[]} variant="compact" />);
    expect(screen.getByText(NO_CHILDREN)).toBeInTheDocument();
    expect(NO_CHILDREN).toBe('Ingen barn lagt til ennå.');
  });

  it('draws what the caller passes as `empty`, including nothing', () => {
    const { container } = render(<ChildCards kids={[]} empty={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws the cards, not the sentence, when there are children', () => {
    render(<ChildCards kids={[JONAS]} bookingHref="/bestill" />);
    expect(screen.queryByText(NO_CHILDREN)).not.toBeInTheDocument();
    expect(screen.getByText('Jonas')).toBeInTheDocument();
  });
});

describe('ChildCards (SP10)', () => {
  it('says the age range, the last cut, the fast stylist and the next time', () => {
    render(
      <ChildCards
        kids={[
          {
            ...JONAS,
            lastVisitTs: Date.parse('2026-08-12T10:00:00+02:00'),
            serviceId: 'svc-gutt',
            serviceName: 'Gutteklipp',
            resourceId: 'res-ola',
            preferredResourceId: 'res-bjarne',
            nextVisitTs: Date.parse('2026-10-08T15:00:00+02:00'),
          },
        ]}
        stylistNames={{ 'res-bjarne': 'Bjarne' }}
      />
    );

    expect(screen.getByText(/7–8 år · sist: Gutteklipp, /)).toBeInTheDocument();
    expect(screen.getByText('Bjarne')).toBeInTheDocument();
    expect(screen.getByText(/8\. okt\. kl\. 15:00/)).toBeInTheDocument();
    // «Bestill» books the last cut with the child's FAST stylist, not the one
    // they happened to get last time.
    expect(screen.getByRole('link', { name: /Bestill for Jonas/ })).toHaveAttribute(
      'href',
      '/bestill?service=svc-gutt&stylist=res-bjarne'
    );
  });

  it('keeps both detail lines, as dashes, for a child with nothing to say', () => {
    render(<ChildCards kids={[JONAS]} />);

    expect(screen.getByText('Fast frisør')).toBeInTheDocument();
    expect(screen.getByText('Neste time')).toBeInTheDocument();
    expect(screen.getAllByText('–')).toHaveLength(2);
  });
});
