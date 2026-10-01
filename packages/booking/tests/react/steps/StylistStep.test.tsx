import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookingResourceDto } from '../../../src/core/types';
import { StylistStep } from '../../support/legacy-steps';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

// «Neste ledige» is the salon's next opening, not the visitor's local reading
// of it — and this suite normally runs in Oslo, where the two agree.
pinAForeignViewerClock();

const SARA: BookingResourceDto = {
  id: 'res-sara',
  name: 'Sara Johansen',
  photoUrl: null,
  bio: 'Barneklipp og krøller',
  serviceIds: ['svc-gutteklipp', 'svc-jenteklipp'],
  sortOrder: 1,
};

/** The report's J1 step 2, in fixture form: Lina does not cut Gutteklipp. */
const LINA: BookingResourceDto = {
  id: 'res-lina',
  name: 'Lina Pettersen',
  photoUrl: null,
  bio: 'Farge og styling',
  serviceIds: ['svc-farge'],
  sortOrder: 2,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StylistStep', () => {
  it('asks the question the report asks', () => {
    render(<StylistStep serviceIds={['svc-gutteklipp']} resources={[SARA]} onPick={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
  });

  it('does not offer a stylist who cannot perform the chosen service', () => {
    render(
      <StylistStep serviceIds={['svc-gutteklipp']} resources={[SARA, LINA]} onPick={vi.fn()} />
    );
    expect(screen.getByText('Sara Johansen')).toBeTruthy();
    expect(screen.queryByText('Lina Pettersen')).toBeNull();
  });

  /**
   * Step 2 asks one question for the whole visit, so a named stylist has to
   * cover the whole basket. Half a party is not an answer: offering Sara for
   * two children when she only cuts one of them is a refusal the engine issues
   * three steps later, dressed up here as a choice.
   */
  it('drops a stylist who covers only part of a family booking', () => {
    render(
      <StylistStep
        serviceIds={['svc-gutteklipp', 'svc-farge']}
        resources={[SARA, LINA]}
        onPick={vi.fn()}
      />
    );

    expect(screen.queryByText('Sara Johansen')).toBeNull();
    expect(screen.queryByText('Lina Pettersen')).toBeNull();
    // Never a dead end: «Første ledige» survives every filter, and the engine
    // resolves it against whoever can actually do the work.
    expect(screen.getByRole('radio', { name: /Første ledige/ })).toBeInTheDocument();
  });

  it('pre-selects «Første ledige» and puts it first', () => {
    render(
      <StylistStep serviceIds={['svc-gutteklipp']} resources={[SARA, LINA]} onPick={vi.fn()} />
    );

    const options = screen.getAllByRole('radio');
    expect(options[0]).toHaveAccessibleName(/Første ledige/);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Vi finner den første ledige tiden')).toBeInTheDocument();
  });

  it('reports the choice as the machine spells it — null is an answer', () => {
    const onPick = vi.fn();
    render(
      <StylistStep
        serviceIds={['svc-gutteklipp']}
        resources={[SARA]}
        selectedResourceId="res-sara"
        onPick={onPick}
      />
    );

    // The preference is rendered, not remembered locally: coming back to step 2
    // has to show the stylist the visitor already chose.
    expect(screen.getByRole('radio', { name: /Sara Johansen/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('radio', { name: /Første ledige/ })).toHaveAttribute(
      'aria-checked',
      'false'
    );

    fireEvent.click(screen.getByRole('radio', { name: /Første ledige/ }));
    expect(onPick).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('radio', { name: /Sara Johansen/ }));
    expect(onPick).toHaveBeenLastCalledWith('res-sara');
  });

  it('shows the next opening on the salon clock, and says nothing when it has none', () => {
    // 13:00Z is 15:00 in Oslo, and the day is fixed so «i dag» cannot drift
    // with the calendar the suite happens to run on.
    const thursday = Date.UTC(2026, 8, 3, 13);
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 3, 7));

    render(
      <StylistStep
        serviceIds={['svc-gutteklipp']}
        resources={[SARA, { ...LINA, serviceIds: ['svc-gutteklipp'] }]}
        nextAvailableTs={{ 'res-sara': thursday }}
        onPick={vi.fn()}
      />
    );

    expect(screen.getByRole('radio', { name: /Sara Johansen/ })).toHaveAccessibleName(
      'Sara Johansen Neste ledige: i dag 15:00'
    );
    // Lina is bookable but nothing came back for her. Inventing a time, or
    // printing an empty «Neste ledige:», both promise more than we know.
    expect(screen.getByRole('radio', { name: /Lina Pettersen/ })).not.toHaveAccessibleName(
      /Neste ledige/
    );
  });

  it('falls back to initials for a stylist nobody has photographed', () => {
    render(<StylistStep serviceIds={['svc-gutteklipp']} resources={[SARA]} onPick={vi.fn()} />);

    expect(screen.getByText('SJ')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the salon’s admin labels as names, with initials from letters only', () => {
    render(
      <StylistStep
        serviceIds={['svc-gutteklipp']}
        resources={[
          { ...SARA, id: 'res-tor', name: 'tor' },
          { ...SARA, id: 'res-bjorn', name: 'Bjørn (Salong Demo)', sortOrder: 2 },
        ]}
        onPick={vi.fn()}
      />
    );

    expect(screen.getByRole('radio', { name: 'Tor' })).toHaveAccessibleDescription(
      'Barneklipp og krøller'
    );
    expect(screen.getByRole('radio', { name: 'Bjørn' })).toBeInTheDocument();
    expect(screen.queryByText(/Salong Demo/)).toBeNull();
    // The initials circle: letters only, so never «B(».
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('B(')).toBeNull();
  });

  /**
   * Layout stability: the cards and the time grid under them must not move
   * when the stylist list or its «Neste ledige» lines land a second later.
   */
  it('holds card-height placeholders while the stylist list is loading', () => {
    const { container } = render(
      <StylistStep serviceIds={['svc-gutteklipp']} resources={[]} loading onPick={vi.fn()} />
    );

    const skeletons = container.querySelectorAll('[data-testid="stylist-skeleton"]');
    expect(skeletons).toHaveLength(5);
    for (const skeleton of skeletons) expect(skeleton).toHaveClass('h-32', 'md:h-24');
    // «Første ledige» is an answer that needs no list, so it is never a skeleton.
    expect(screen.getByRole('radio', { name: /Første ledige/ })).toHaveClass('h-32', 'md:h-24');
    expect(screen.getByRole('status')).toHaveTextContent('Henter frisører');
  });

  it('holds as many placeholders as it was told to expect', () => {
    const { container } = render(
      <StylistStep
        serviceIds={['svc-gutteklipp']}
        resources={[]}
        loading
        skeletonCount={3}
        onPick={vi.fn()}
      />
    );
    expect(container.querySelectorAll('[data-testid="stylist-skeleton"]')).toHaveLength(3);
  });

  it('reserves the «Neste ledige» row on every card, filled or not', () => {
    const { container } = render(
      <StylistStep
        serviceIds={['svc-gutteklipp']}
        resources={[SARA, { ...LINA, serviceIds: ['svc-gutteklipp'] }]}
        nextAvailableTs={{}}
        nextAvailableLoading
        onPick={vi.fn()}
      />
    );

    const rows = container.querySelectorAll('[data-testid="next-available-row"]');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toHaveClass('h-8', 'md:h-5');
    // Every card is one fixed height, so a row filling in cannot grow it.
    expect(screen.getByRole('radio', { name: /Sara Johansen/ })).toHaveClass('h-32', 'md:h-24');
  });
});

/**
 * J2 step 2 — the question that only exists once there is more than one child.
 */
describe('StylistStep — a family', () => {
  const partyProps = {
    serviceIds: ['svc-gutteklipp', 'svc-jenteklipp'],
    resources: [SARA, LINA],
  };

  /** Jonas and Emma, two 30-minute cuts: an hour back to back, half of one
   * side by side. */
  const twoChildren = {
    mode: 'sequential' as const,
    size: 2,
    minutes: { sequential: 60, parallel: 30 },
  };

  it('offers the two modes the report names, with «rett etter hverandre» chosen', () => {
    render(
      <StylistStep {...partyProps} party={{ ...twoChildren, onMode: vi.fn() }} onPick={vi.fn()} />
    );

    expect(
      screen.getByRole('button', { name: /Samme frisør, rett etter hverandre/ })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /To frisører samtidig/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  /**
   * «In and out in 30 min» is the report's own parenthesis, and it is a promise
   * about THIS basket rather than a slogan: two 30-minute cuts side by side are
   * half an hour, and the same two back to back are an hour.
   */
  it('says how long each way actually takes', () => {
    render(
      <StylistStep {...partyProps} party={{ ...twoChildren, onMode: vi.fn() }} onPick={vi.fn()} />
    );

    expect(screen.getByText('Til sammen 60 min')).toBeInTheDocument();
    expect(screen.getByText('Inn og ut på 30 min')).toBeInTheDocument();
  });

  it('reports the mode the parent tapped', () => {
    const onMode = vi.fn();
    render(<StylistStep {...partyProps} party={{ ...twoChildren, onMode }} onPick={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /To frisører samtidig/ }));
    expect(onMode).toHaveBeenCalledWith('parallel');
  });

  /**
   * Two children seen at once are seen by two different people, so «jeg vil til
   * Sara» and this mode cannot both be true — the machine drops the preference
   * when the mode is chosen, and a list left on screen would be showing a
   * stylist the search is quietly ignoring.
   */
  it('puts the stylist list away once the family asks for two of them', () => {
    render(
      <StylistStep
        {...partyProps}
        party={{ ...twoChildren, mode: 'parallel', onMode: vi.fn() }}
        onPick={vi.fn()}
      />
    );

    expect(screen.queryByRole('radio', { name: /Sara Johansen/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Første ledige/ })).toBeNull();
    expect(screen.getByText('Vi finner to frisører som er ledige samtidig.')).toBeInTheDocument();
  });

  /**
   * `maxPerBooking` for `barn` is 3, so the third child is reachable — and «To
   * frisører samtidig» in front of a family of three is a number the salon
   * would have to correct at the door.
   */
  it('counts the children rather than assuming there are two', () => {
    render(
      <StylistStep
        {...partyProps}
        party={{ ...twoChildren, size: 3, mode: 'parallel', onMode: vi.fn() }}
        onPick={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Tre frisører samtidig/ })).toBeInTheDocument();
    expect(screen.getByText('Vi finner tre frisører som er ledige samtidig.')).toBeInTheDocument();
  });

  it('asks nothing about modes for a single child', () => {
    render(<StylistStep serviceIds={['svc-gutteklipp']} resources={[SARA]} onPick={vi.fn()} />);

    // «Rett etter hverandre» is not a choice when there is nobody to be after.
    expect(screen.queryByText('Hvordan skal barna tas?')).toBeNull();
    expect(screen.getByRole('radio', { name: /Første ledige/ })).toBeInTheDocument();
  });
});

/**
 * The phone audit: five 96 px cards stacked above the time grid pushed every
 * time a parent could tap below the fold. Under `md` the SAME radios are a
 * fixed-height row of avatars that scrolls sideways; from `md` they are cards.
 * jsdom applies no media queries, so the breakpoints are read off the classes
 * both layouts are written in.
 */
describe('StylistStep — compact on phones', () => {
  const BJORN: BookingResourceDto = {
    ...SARA,
    id: 'res-bjorn',
    name: 'Bjørn Kvam (Salong Demo)',
    sortOrder: 2,
  };

  function renderRow(props: Partial<Parameters<typeof StylistStep>[0]> = {}) {
    const onPick = vi.fn();
    const view = render(
      <StylistStep
        serviceIds={['svc-gutteklipp']}
        resources={[SARA, BJORN]}
        onPick={onPick}
        {...props}
      />
    );
    return { ...view, onPick };
  }

  it('is one fixed-height, sideways-scrolling row with snap under md, a column from md', () => {
    renderRow();
    const group = screen.getByRole('radiogroup', { name: 'Hvem vil du gå til?' });
    expect(group).toHaveClass('flex', 'h-36', 'overflow-x-auto', 'snap-x', 'snap-mandatory');
    expect(group).toHaveClass('md:h-auto', 'md:flex-col', 'md:overflow-visible');
    for (const option of screen.getAllByRole('radio')) {
      expect(option).toHaveClass('w-24', 'shrink-0', 'snap-start', 'h-32');
      expect(option).toHaveClass('md:w-full', 'md:flex-row', 'md:h-24');
    }
  });

  it('keeps «Første ledige» first and selected by default', () => {
    renderRow();
    const [first, ...rest] = screen.getAllByRole('radio');
    expect(first).toHaveAccessibleName('Første ledige');
    expect(first).toHaveAttribute('aria-checked', 'true');
    for (const option of rest) expect(option).toHaveAttribute('aria-checked', 'false');
  });

  it('shows a 56 px avatar and the first name on a phone, the full name from md', () => {
    renderRow();
    const bjorn = screen.getByRole('radio', { name: 'Bjørn Kvam' });
    const avatar = bjorn.querySelector('[data-testid="stylist-avatar"]');
    expect(avatar).toHaveClass('size-14', 'rounded-full', 'md:size-12');
    const phoneName = screen.getByText('Bjørn');
    expect(phoneName).toHaveClass('md:hidden');
    expect(screen.getByText('Bjørn Kvam')).toHaveClass('hidden', 'md:block');
    // The bio is card furniture: a tile has no room for it.
    expect(bjorn).toHaveAccessibleDescription('Barneklipp og krøller');
  });

  it('rings the selected avatar in the brand teal', () => {
    renderRow({ selectedResourceId: 'res-bjorn' });
    const avatar = screen
      .getByRole('radio', { name: 'Bjørn Kvam' })
      .querySelector('[data-testid="stylist-avatar"]');
    expect(avatar).toHaveClass('ring-2', 'ring-primary');
    const unselected = screen
      .getByRole('radio', { name: 'Første ledige' })
      .querySelector('[data-testid="stylist-avatar"]');
    expect(unselected).not.toHaveClass('ring-primary');
  });

  it('puts «Neste ledige» on one short line under the name', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 3, 7));
    renderRow({ nextAvailableTs: { 'res-bjorn': Date.UTC(2026, 8, 3, 13) } });

    const row = screen
      .getByRole('radio', { name: /Bjørn Kvam/ })
      .querySelector('[data-testid="next-available-row"]');
    expect(row).toHaveTextContent('Neste ledige: i dag 15:00');
    expect(row).toHaveClass('h-8', 'md:h-5');
    // The prefix is for the screen reader on a phone, visible from md.
    expect(screen.getAllByText('Neste ledige:')[0]).toHaveClass('sr-only', 'md:not-sr-only');
  });

  it('holds a skeleton row of the same height while the stylists load', () => {
    const { container } = renderRow({ resources: [], loading: true, skeletonCount: 4 });
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveClass('h-36');
    const skeletons = container.querySelectorAll('[data-testid="stylist-skeleton"]');
    expect(skeletons).toHaveLength(4);
    for (const skeleton of skeletons) {
      expect(skeleton).toHaveClass('w-24', 'h-32', 'md:h-24');
      expect(group).toContainElement(skeleton as HTMLElement);
    }
    // Placeholders are not options.
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it('is one tab stop: the selected option', () => {
    renderRow({ selectedResourceId: 'res-sara' });
    const [first, sara, bjorn] = screen.getAllByRole('radio');
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(sara).toHaveAttribute('tabindex', '0');
    expect(bjorn).toHaveAttribute('tabindex', '-1');
  });

  it('falls back to the first option as the tab stop when the preference is not on the list', () => {
    renderRow({ selectedResourceId: 'res-lina' });
    expect(screen.getAllByRole('radio')[0]).toHaveAttribute('tabindex', '0');
  });

  it('moves and chooses with the arrow keys, wrapping at the ends', () => {
    const { onPick } = renderRow();
    const [first, sara, bjorn] = screen.getAllByRole('radio');
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(sara).toHaveFocus();
    expect(onPick).toHaveBeenLastCalledWith('res-sara');

    fireEvent.keyDown(sara, { key: 'ArrowDown' });
    expect(bjorn).toHaveFocus();
    expect(onPick).toHaveBeenLastCalledWith('res-bjorn');

    fireEvent.keyDown(bjorn, { key: 'ArrowRight' });
    expect(first).toHaveFocus();
    expect(onPick).toHaveBeenLastCalledWith(null);

    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(bjorn).toHaveFocus();
    expect(onPick).toHaveBeenLastCalledWith('res-bjorn');

    fireEvent.keyDown(bjorn, { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(bjorn).toHaveFocus();
  });

  it('ignores keys that are not navigation', () => {
    const { onPick } = renderRow();
    const [first] = screen.getAllByRole('radio');
    first.focus();
    fireEvent.keyDown(first, { key: 'a' });
    expect(first).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('keeps «Første ledige» whole on a phone tile', () => {
    renderRow();
    expect(screen.getAllByText('Første ledige')[0]).toHaveClass('md:hidden');
    expect(screen.queryByText('Første')).toBeNull();
  });

  it('holds a checked, tabbable stand-in for a named stylist restored before the list', () => {
    const { container } = renderRow({
      resources: [],
      loading: true,
      selectedResourceId: 'res-bjorn',
      pendingName: 'Bjørn Kvam',
    });
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-busy', 'true');
    const standIn = screen.getByRole('radio', { name: 'Bjørn Kvam' });
    expect(standIn).toHaveAttribute('aria-checked', 'true');
    expect(standIn).toHaveAttribute('tabindex', '0');
    expect(standIn).toHaveClass('h-32', 'md:h-24');
    expect(screen.getByText('BK')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Første ledige' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(container.querySelectorAll('[data-testid="stylist-skeleton"]')).toHaveLength(4);
  });

  it('names the stand-in «Valgt frisør» when nothing knows the name yet', () => {
    renderRow({ resources: [], loading: true, selectedResourceId: 'res-bjorn' });
    expect(screen.getByRole('radio', { name: 'Valgt frisør' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('holds no stand-in for «Første ledige», which needs no list', () => {
    const { container } = renderRow({ resources: [], loading: true });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="stylist-skeleton"]')).toHaveLength(5);
  });

  it('announces a notice politely once the list is here', async () => {
    renderRow({ notice: 'Frisøren du valgte er ikke ledig for denne bestillingen.' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Frisøren du valgte er ikke ledig for denne bestillingen.'
    );
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-busy', 'false');
  });

  it('chooses on tap', () => {
    const { onPick } = renderRow();
    fireEvent.click(screen.getByRole('radio', { name: 'Bjørn Kvam' }));
    expect(onPick).toHaveBeenCalledWith('res-bjorn');
  });
});
