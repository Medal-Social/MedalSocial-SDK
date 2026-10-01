import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BookingServiceDto } from '../../../src/core/types';
import { ageDividerLabel, ServiceStep } from '../../support/legacy-steps';

/**
 * The salon's real catalogue, not a convenient one. `Hull i ørene` sits in
 * `annet` because that is where the seed files it — the same fixture the route
 * test uses — and it is not bookable online. Moving it into `barn` to make a
 * card easier to find would quietly delete the case this file exists to prove:
 * the visitor lands on a kids' salon with `Barn` to the front, and the ear
 * piercing they came to ask about is still on the page.
 */
const GUTTEKLIPP: BookingServiceDto = {
  id: 'svc-gutteklipp',
  name: 'Gutteklipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 10,
  bookableOnline: true,
};

const HULL_I_ORENE: BookingServiceDto = {
  id: 'svc-hull',
  name: 'Hull i ørene',
  category: 'annet',
  durationMinutes: 15,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 30_000,
  maxPerBooking: 1,
  weekendSurchargePct: 10,
  bookableOnline: false,
};

/** Emma's half of the report's J2, and the reason the second-child picker
 * cannot simply repeat the first child's service. */
const JENTEKLIPP: BookingServiceDto = { ...GUTTEKLIPP, id: 'svc-jente', name: 'Jenteklipp' };

const DAMEKLIPP: BookingServiceDto = {
  ...GUTTEKLIPP,
  id: 'svc-dame',
  name: 'Dameklipp',
  category: 'dame',
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 79_000,
  maxPerBooking: 1,
};

describe('ServiceStep', () => {
  it('asks the question the report asks', () => {
    render(<ServiceStep services={[GUTTEKLIPP]} onPick={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
  });

  it('shows a phone-only service instead of hiding it', () => {
    render(<ServiceStep services={[GUTTEKLIPP, HULL_I_ORENE]} phone="22334455" onPick={vi.fn()} />);
    expect(screen.getByText('Hull i ørene')).toBeTruthy();
    expect(screen.getByText(/Ring oss for denne/)).toBeTruthy();
  });

  // The card is not bookable, so it must not be a button: a tap target that
  // accepts the tap and does nothing is the dead end the phone number replaces.
  it('offers the number to call instead of a price, and no button to press', () => {
    render(<ServiceStep services={[HULL_I_ORENE]} phone="22 33 44 55" onPick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Hull i ørene/ })).toBeNull();
    // Spaces are typography, not part of the number a phone can dial.
    expect(screen.getByRole('link', { name: /Ring oss for denne/ })).toHaveAttribute(
      'href',
      'tel:22334455'
    );
  });

  it('says the same sentence without a link when the salon has no number yet', () => {
    render(<ServiceStep services={[HULL_I_ORENE]} phone={null} onPick={vi.fn()} />);

    expect(screen.getByText(/Ring oss for denne/)).toBeTruthy();
    // A `tel:` that dials nothing looks like an offer and fails in the hand of
    // someone who has just been told they cannot book what they came for.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('books on the first tap, with the whole card as the target', () => {
    const onPick = vi.fn();
    render(<ServiceStep services={[GUTTEKLIPP]} onPick={onPick} />);

    const card = screen.getByRole('button', { name: /Gutteklipp/ });
    // Name, duration and price are one target: at arm's length on a phone,
    // anything smaller than the card is a missed tap.
    expect(card).toHaveAccessibleName(/Gutteklipp.*30 min.*490/s);
    fireEvent.click(card);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(GUTTEKLIPP);
  });

  /**
   * The pills mark where you are in the list; they do not shorten it. A pill
   * that filtered would hide four fifths of the catalogue behind a default
   * nobody chose — and `Hull i ørene`, the one service the report insists stays
   * visible, is in the group furthest from `Barn`.
   */
  it('keeps every service on the page with Barn to the front', () => {
    render(<ServiceStep services={[DAMEKLIPP, HULL_I_ORENE, GUTTEKLIPP]} onPick={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Barn' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dame' })).toHaveAttribute('aria-pressed', 'false');

    for (const name of ['Gutteklipp', 'Dameklipp', 'Hull i ørene']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // Barn first for this salon, whatever order the API returned.
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Barn', 'Dame', 'Annet']);
  });

  it('moves the marker to the pill you tap, and still shortens nothing', () => {
    render(<ServiceStep services={[DAMEKLIPP, GUTTEKLIPP, HULL_I_ORENE]} onPick={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dame' }));

    expect(screen.getByRole('button', { name: 'Dame' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Barn' })).toHaveAttribute('aria-pressed', 'false');
    // The tap is a jump. Every card the visitor could see a moment ago is still
    // on the page — which is the difference between a marker and a filter.
    expect(screen.getByText('Gutteklipp')).toBeInTheDocument();
    expect(screen.getByText('Hull i ørene')).toBeInTheDocument();
  });

  it('files a service from a category nobody planned for under Annet', () => {
    // `category` is a free string on the wire. Grouping strictly by the five
    // known keys would drop a service the salon added last week off the page
    // entirely — invisible until a customer asks why they cannot book it.
    render(<ServiceStep services={[{ ...GUTTEKLIPP, category: 'vipper' }]} onPick={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Annet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gutteklipp/ })).toBeInTheDocument();
  });

  it('has no sibling picker any more — who comes is step 1’s question', () => {
    render(<ServiceStep services={[GUTTEKLIPP, JENTEKLIPP]} onPick={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Legg til barn til/ })).toBeNull();
  });

  /**
   * A family (SP10): one list per person, each answered on its own, and only
   * what the whole party can have — the kids' menu the salon takes online,
   * nothing whose `maxPerBooking` is below the party's size.
   */
  describe('for a family', () => {
    const PEOPLE = [
      { key: 'p:theo', label: 'Theo · 7 år', adult: false },
      { key: 'guest:2', label: 'Barn 2', adult: false },
    ];

    it('asks each child on their own, from the kids’ menu the party can have', () => {
      const onPickFor = vi.fn();
      render(
        <ServiceStep
          services={[
            GUTTEKLIPP,
            JENTEKLIPP,
            DAMEKLIPP,
            HULL_I_ORENE,
            { ...JENTEKLIPP, id: 'off', name: 'Stengt', bookableOnline: false },
          ]}
          onPick={vi.fn()}
          party={{ people: PEOPLE, choices: [null, null], onPickFor }}
        />
      );

      expect(screen.getByRole('heading', { level: 3, name: 'Theo · 7 år' })).toBeInTheDocument();
      const theo = within(screen.getByRole('list', { name: 'Tjenester for Theo · 7 år' }));
      expect(theo.getAllByRole('button').map((option) => option.textContent)).toEqual([
        'Gutteklipp30 min490\u00A0kr',
        'Jenteklipp30 min490\u00A0kr',
      ]);

      fireEvent.click(
        within(screen.getByRole('list', { name: 'Tjenester for Barn 2' })).getByRole('button', {
          name: /Jenteklipp/,
        })
      );
      expect(onPickFor).toHaveBeenCalledWith(1, JENTEKLIPP);
    });

    it('marks each child’s current answer', () => {
      render(
        <ServiceStep
          services={[GUTTEKLIPP, JENTEKLIPP]}
          onPick={vi.fn()}
          party={{ people: PEOPLE, choices: [GUTTEKLIPP, null], onPickFor: vi.fn() }}
        />
      );

      const theo = within(screen.getByRole('list', { name: 'Tjenester for Theo · 7 år' }));
      expect(theo.getByRole('button', { name: /Gutteklipp/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(theo.getByRole('button', { name: /Jenteklipp/ })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('says in one line when nothing can ride along, and offers to take that person out', () => {
      const onRemove = vi.fn();
      render(
        <ServiceStep
          // An adult cut is 1 per booking: it cannot join a party of two.
          services={[GUTTEKLIPP, DAMEKLIPP]}
          onPick={vi.fn()}
          party={{
            people: [PEOPLE[0], { key: 'self', label: 'Meg selv', adult: true }],
            choices: [null, null],
            onPickFor: vi.fn(),
            onRemove,
          }}
        />
      );

      expect(
        screen.getByText('Meg selv kan ikke bookes sammen med barna – voksenklipp er en egen time.')
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ta bort Meg selv fra denne timen' }));
      expect(onRemove).toHaveBeenCalledWith(1);
    });

    it('says so for a child too, without calling them a grown-up', () => {
      render(
        <ServiceStep
          services={[DAMEKLIPP]}
          onPick={vi.fn()}
          party={{
            people: [PEOPLE[0], PEOPLE[1]],
            choices: [null, null],
            onPickFor: vi.fn(),
          }}
        />
      );

      expect(screen.getAllByText(/Ingen av tjenestene kan bookes for/)).toHaveLength(2);
      expect(screen.queryByText(/voksenklipp/)).toBeNull();
    });
  });

  describe('«Samme som sist»', () => {
    it('offers a party of one their last haircut first, and keeps the whole catalogue below', () => {
      const onPick = vi.fn();
      render(
        <ServiceStep
          services={[GUTTEKLIPP, JENTEKLIPP, DAMEKLIPP]}
          onPick={onPick}
          suggestion={{ service: JENTEKLIPP }}
          chosenId={JENTEKLIPP.id}
        />
      );

      const same = screen.getByRole('button', { name: /Samme som sist/ });
      expect(same).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Velg noe annet')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Dameklipp/ })).toBeInTheDocument();

      fireEvent.click(same);
      expect(onPick).toHaveBeenCalledWith(JENTEKLIPP);
    });

    it('says why, in one line, when the suggestion was swapped', () => {
      render(
        <ServiceStep
          services={[GUTTEKLIPP]}
          onPick={vi.fn()}
          suggestion={{ service: GUTTEKLIPP, note: 'Sist: Barnehageklipp – nå er det Gutteklipp.' }}
        />
      );

      expect(screen.getByText('Sist: Barnehageklipp – nå er det Gutteklipp.')).toBeInTheDocument();
    });
  });
});

/**
 * «Suggest, never refuse»: a service a child's age usually rules out stays on
 * the page, one tap away, below a divider that says why.
 */
describe('ServiceStep and a child’s age', () => {
  const BARNEHAGEKLIPP: BookingServiceDto = {
    ...GUTTEKLIPP,
    id: 'svc-bhg',
    name: 'Barnehageklipp',
    ageMaxYears: 6,
  };
  const NINE = { min: 9, max: 9 };

  it('writes the Norwegian genitive', () => {
    expect(ageDividerLabel('Theo')).toBe('Passer vanligvis ikke for Theos alder');
    expect(ageDividerLabel('Jonas')).toBe("Passer vanligvis ikke for Jonas' alder");
    expect(ageDividerLabel(null)).toBe('Passer vanligvis ikke for barnets alder');
  });

  it('keeps an unlikely service for one child below the divider, and pickable', () => {
    const onPick = vi.fn();
    render(
      <ServiceStep
        services={[GUTTEKLIPP, BARNEHAGEKLIPP]}
        onPick={onPick}
        age={NINE}
        childName="Theo"
      />
    );

    const below = screen.getByRole('list', { name: 'Passer vanligvis ikke for Theos alder' });
    expect(within(below).queryByRole('button', { name: /Gutteklipp/ })).toBeNull();
    fireEvent.click(within(below).getByRole('button', { name: /Barnehageklipp/ }));
    expect(onPick).toHaveBeenCalledWith(BARNEHAGEKLIPP);
  });

  it('draws no divider when everything fits, or the age is unknown', () => {
    render(<ServiceStep services={[GUTTEKLIPP, BARNEHAGEKLIPP]} onPick={vi.fn()} age={null} />);
    expect(screen.queryByText(/Passer vanligvis ikke/)).toBeNull();
  });

  it('does the same per child in a family', () => {
    const onPickFor = vi.fn();
    render(
      <ServiceStep
        services={[GUTTEKLIPP, BARNEHAGEKLIPP]}
        onPick={vi.fn()}
        party={{
          people: [
            { key: 'p:theo', label: 'Theo · 9 år', name: 'Theo', adult: false, age: NINE },
            {
              key: 'p:mia',
              label: 'Mia · 4 år',
              name: 'Mia',
              adult: false,
              age: { min: 4, max: 4 },
            },
          ],
          choices: [null, null],
          onPickFor,
        }}
      />
    );

    const below = screen.getByRole('list', { name: 'Passer vanligvis ikke for Theos alder' });
    fireEvent.click(within(below).getByRole('button', { name: /Barnehageklipp/ }));
    expect(onPickFor).toHaveBeenCalledWith(0, BARNEHAGEKLIPP);
    // Mia is four: Barnehageklipp is on her ordinary list.
    expect(screen.queryByText('Passer vanligvis ikke for Mias alder')).toBeNull();
    expect(
      within(screen.getByRole('list', { name: 'Tjenester for Mia · 4 år' })).getByRole('button', {
        name: /Barnehageklipp/,
      })
    ).toBeInTheDocument();
  });
});
