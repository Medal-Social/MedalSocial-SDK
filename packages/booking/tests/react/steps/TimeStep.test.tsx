import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PartySlot } from '../../../src/core/party-slots';
import type { BookingDayDto, BookingSlotDto } from '../../../src/core/types';
import type { WizardItem, WizardService } from '../../support/legacy-steps';
import { TakenToast, TimeStep, TimeStepSkeleton } from '../../support/legacy-steps';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

// Dayparts and chip labels are the salon's, and this suite normally runs in
// Oslo — where a component reading the viewer's clock would look identical.
pinAForeignViewerClock();

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A slot at an Oslo wall-clock time. The offset is spelled out rather than
 * computed — 2026-09-03 is inside CEST, so Oslo is UTC+02:00 — because that is
 * the one construction the runner's own zone cannot move. Thursday the 3rd by
 * default; the 5th is the Saturday.
 */
function at(hour: number, minute = 0, day = 3): BookingSlotDto {
  return {
    startTs: Date.parse(`2026-09-${pad(day)}T${pad(hour)}:${pad(minute)}:00+02:00`),
    resourceId: 'res-sara',
  };
}

/**
 * Freezes "today". The date strip says «I dag» / «I morgen» before it says a
 * weekday, so a chip's label depends on when the suite runs — and a test that
 * asserts `lør. 5.` quietly starts failing the week the fixture becomes
 * tomorrow.
 */
function pinToday(ts: number) {
  vi.spyOn(Date, 'now').mockReturnValue(ts);
}

const A_FRIDAY_IN_AUGUST = Date.parse('2026-08-28T09:00:00+02:00');

/** Prices are read exactly, non-breaking spaces and all — see `SummaryBar.test.tsx`
 * for what the default normalizer would let through. */
const exactly = (text: string) => text;

const GUTTEKLIPP: WizardService = {
  id: 'svc-gutteklipp',
  name: 'Gutteklipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 10,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TimeStep', () => {
  it('asks the question the report asks', () => {
    render(<TimeStep slots={[at(9)]} onPick={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Når passer det?' })).toBeInTheDocument();
  });

  it('groups slots into the three dayparts', () => {
    render(<TimeStep slots={[at(9), at(13), at(18)]} onPick={vi.fn()} />);
    expect(screen.getByText('Formiddag')).toBeTruthy();
    expect(screen.getByText('Ettermiddag')).toBeTruthy();
    expect(screen.getByText('Kveld')).toBeTruthy();
  });

  /**
   * The headings alone would also pass for a component that printed all three
   * and grouped nothing. Reading the chips *out of* each section is what makes
   * the boundaries mean something — and 11:59/12:00 and 16:59/17:00 are where
   * an off-by-one lands a parent an hour from the time they thought they took.
   */
  it('puts each slot under its own daypart, on the salon clock', () => {
    render(<TimeStep slots={[at(11, 59), at(12), at(16, 59), at(17)]} onPick={vi.fn()} />);

    const section = (name: string) =>
      within(screen.getByRole('heading', { name }).parentElement as HTMLElement);

    expect(section('Formiddag').getByRole('button', { name: /11:59/ })).toBeInTheDocument();
    expect(
      section('Ettermiddag')
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['12:00', '16:59']);
    expect(section('Kveld').getByRole('button', { name: /17:00/ })).toBeInTheDocument();
  });

  it('does not head a daypart the salon has nothing in', () => {
    // A bare «Kveld» over empty space reads as an evening that exists and is
    // simply full, which is a different thing from a salon that shuts at five.
    render(<TimeStep slots={[at(9)]} onPick={vi.fn()} />);

    expect(screen.getByText('Formiddag')).toBeInTheDocument();
    expect(screen.queryByText('Ettermiddag')).toBeNull();
    expect(screen.queryByText('Kveld')).toBeNull();
  });

  it('hands back the whole slot, so «Første ledige» keeps the stylist it resolved to', () => {
    const onPick = vi.fn();
    render(<TimeStep slots={[at(9)]} onPick={onPick} />);

    fireEvent.click(screen.getByRole('button', { name: /09:00/ }));

    // Not just the instant: `pickSlot` stores the resolved stylist separately
    // from the visitor's preference, and it is what gets submitted.
    expect(onPick).toHaveBeenCalledWith(at(9));
  });

  /**
   * Every other fixture in this file is one stylist deep, which is why this
   * shipped: Medal's availability list is per (start, resource), so «Første
   * ledige» — the DEFAULT — returns an 11:00 once per free stylist. On the live
   * salon that drew «11:00 11:00 11:15 11:15», two identical chips the visitor
   * has to guess between, plus duplicate React keys.
   *
   * Asserted as the exact chip list rather than a count, because a component
   * that collapsed the two by dropping BOTH would also pass a length check.
   */
  it('offers one chip per instant when several stylists are free for it', () => {
    render(
      <TimeStep
        slots={[
          { ...at(11), resourceId: 'res-sara' },
          { ...at(11), resourceId: 'res-marcus' },
          { ...at(11, 15), resourceId: 'res-sara' },
          { ...at(11, 15), resourceId: 'res-marcus' },
        ]}
        onPick={vi.fn()}
      />
    );

    expect(
      screen.getAllByRole('button', { name: /^\d\d:\d\d$/ }).map((b) => b.textContent)
    ).toEqual(['11:00', '11:15']);
  });

  it('submits the stylist the surviving chip resolved to, not a null one', () => {
    // Collapsing to a bare instant would be the tempting fix and the wrong one:
    // `resolvedResourceId` is what the POST carries, so a null here would let
    // the engine hand the chair to whoever it liked between tap and submit.
    const onPick = vi.fn();
    render(
      <TimeStep
        slots={[
          { ...at(11), resourceId: 'res-sara' },
          { ...at(11), resourceId: 'res-marcus' },
        ]}
        onPick={onPick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '11:00' }));

    expect(onPick).toHaveBeenCalledWith({ ...at(11), resourceId: 'res-sara' });
  });

  it('offers the nearest alternatives when the chosen slot was taken', () => {
    render(
      <TimeStep slots={[at(14, 45), at(15, 15)]} takenSlotTs={at(15).startTs} onPick={vi.fn()} />
    );
    // The message itself is the wizard's toast (below); the step marks the two.
    expect(screen.getAllByRole('button', { name: /nærmeste alternativ/ })).toHaveLength(2);
  });

  it('keeps the weekend-surcharge row on a weekday, empty, so a day tap cannot move the grid', () => {
    pinToday(A_FRIDAY_IN_AUGUST);
    const saturday = at(11, 0, 5);
    const thursday = at(11);

    const { container } = render(
      <TimeStep
        slots={[thursday, saturday]}
        days={[thursday.startTs, saturday.startTs]}
        service={GUTTEKLIPP}
        onPick={vi.fn()}
      />
    );

    const row = container.querySelector('[data-testid="surcharge-row"]');
    expect(row).toHaveClass('min-h-5');
    expect(row).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'lør. 5.' }));
    expect(container.querySelector('[data-testid="surcharge-row"]')).toHaveTextContent(
      /helgetillegg/
    );
  });

  it('reserves no surcharge row for a basket that never pays one', () => {
    const { container } = render(
      <TimeStep
        slots={[at(11)]}
        service={{ ...GUTTEKLIPP, weekendSurchargePct: 0 }}
        onPick={vi.fn()}
      />
    );
    expect(container.querySelector('[data-testid="surcharge-row"]')).toBeNull();
  });

  it('points at the two closest, not at the whole day', () => {
    render(
      <TimeStep
        slots={[at(9), at(14, 45), at(15, 15)]}
        takenSlotTs={at(15).startTs}
        onPick={vi.fn()}
      />
    );

    // The ring is for whoever can see it; the marker is for whoever cannot, and
    // «nærmeste alternativer» is a promise the morning slot does not keep.
    expect(screen.getByRole('button', { name: /14:45/ })).toHaveAccessibleName(/nærmeste/);
    expect(screen.getByRole('button', { name: /15:15/ })).toHaveAccessibleName(/nærmeste/);
    expect(screen.getByRole('button', { name: /09:00/ })).not.toHaveAccessibleName(/nærmeste/);
  });

  it('lands the visitor back on the day the slot was stolen from', () => {
    pinToday(A_FRIDAY_IN_AUGUST);
    const thursday = at(9);
    const friday = at(9, 0, 4);

    render(
      <TimeStep slots={[thursday, friday]} takenSlotTs={at(10, 0, 4).startTs} onPick={vi.fn()} />
    );

    // Not the first day in the strip: the visitor is standing on Friday, having
    // just lost 10:00 on it.
    expect(screen.getByRole('button', { name: 'fre. 4.' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /09:00/ })).toHaveAccessibleName(/nærmeste/);
  });

  it('says nothing about a stolen slot when none was', () => {
    // The alert is announced whether or not anyone is looking at it, so it must
    // not be standing by in the DOM on the ordinary path.
    render(<TimeStep slots={[at(14, 45)]} onPick={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never leaves a fully-booked day as a dead end', () => {
    render(<TimeStep slots={[]} phone="22334455" onPick={vi.fn()} />);
    expect(screen.getByText(/Ingenting ledig/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ring oss/ })).toHaveAttribute(
      'href',
      expect.stringContaining('tel:')
    );
  });

  it('still says it, unlinked, when the salon has no number yet', () => {
    render(<TimeStep slots={[]} phone={null} onPick={vi.fn()} />);

    expect(screen.getByText(/Ingenting ledig/)).toBeTruthy();
    // A `tel:` that dials nothing is worse than plain text at exactly this
    // moment: the visitor has just been told the day they wanted is gone.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('jumps to the next day that has anything, from a day that has nothing', () => {
    pinToday(A_FRIDAY_IN_AUGUST);
    const thursday = at(9).startTs;
    const friday = at(9, 0, 4);

    render(<TimeStep slots={[friday]} days={[thursday, friday.startTs]} onPick={vi.fn()} />);

    // Thursday is offered and empty — which only a `days` range can express,
    // since a fully-booked day contributes no slots to infer itself from.
    expect(screen.getByText(/Ingenting ledig/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Neste ledige time' }));

    expect(screen.getByRole('button', { name: /09:00/ })).toBeInTheDocument();
    expect(screen.queryByText(/Ingenting ledig/)).toBeNull();
  });

  it('warns about the weekend surcharge only on the weekend, with the real price', () => {
    pinToday(A_FRIDAY_IN_AUGUST);
    const saturday = at(11, 0, 5);
    const thursday = at(11);

    render(
      <TimeStep
        slots={[thursday, saturday]}
        days={[thursday.startTs, saturday.startTs]}
        service={GUTTEKLIPP}
        onPick={vi.fn()}
      />
    );

    expect(screen.queryByText(/helgetillegg/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'lør. 5.' }));
    // 490 kr plus the salon's 10 % — contextually on the day it applies to,
    // not as fine print under a price the visitor will not be charged.
    expect(screen.getByText('Lør/søn: +10 % helgetillegg (539 kr)')).toBeInTheDocument();
  });

  it('routes today’s short notice to the phone rather than pretending it is bookable', () => {
    // Whatever is left of today sits inside the salon's lead time, so the
    // engine never offers it. The phone is the only thing that can.
    pinToday(at(7).startTs);
    render(<TimeStep slots={[at(15)]} phone="22 33 44 55" onPick={vi.fn()} />);

    expect(
      screen.getByRole('link', { name: /Ring oss for time i dag på kort varsel/ })
    ).toHaveAttribute('href', 'tel:22334455');
  });

  it('keeps the short-notice line off a day that is not today', () => {
    pinToday(at(7, 0, 1).startTs);
    render(<TimeStep slots={[at(15)]} phone="22 33 44 55" onPick={vi.fn()} />);

    expect(screen.queryByText(/kort varsel/)).toBeNull();
  });
});

/**
 * J2 step 3 — a family's slots, which are whole visits rather than single
 * openings, and the rescue when a day has none of them.
 */
/**
 * The salon's own hours, and what step 3 is allowed to say without them.
 *
 * `/availability` returns free slots and nothing else, so a closed Sunday, a
 * Thursday evening after closing and a genuinely booked-out Thursday all reach
 * this component as the same empty array. It used to answer all three with one
 * card, which is how a parent at 18:45 on a Saturday the salon shut at 17:00
 * was told it was «Fullt» and handed a telephone number nobody was there to
 * answer. `openDays` is what tells them apart.
 */
describe('TimeStep — open, shut, or done for the day', () => {
  const A_THURSDAY_MORNING = Date.parse('2026-09-03T11:00:00+02:00');
  const A_THURSDAY_EVENING = Date.parse('2026-09-03T18:45:00+02:00');
  const A_SUNDAY_MIDDAY = Date.parse('2026-09-06T12:00:00+02:00');

  /**
   * One open date in the salon's September, hours as Oslo wall-clock hours.
   *
   * `lastStart` defaults to 16:30 against a 17:00 close, which is the gap the
   * whole distinction turns on: a 30-minute cut cannot start at 16:45, so the
   * day is over half an hour before the lights go out. `null` is the salon
   * posting hours for a date it is shut on anyway — a public holiday.
   */
  function openDay(
    day: number,
    {
      opens = 10,
      closes = 17,
      lastStart = [16, 30],
    }: { opens?: number; closes?: number; lastStart?: [number, number] | null } = {}
  ): BookingDayDto {
    const osloTs = (hour: number, minute: number) =>
      Date.parse(`2026-09-${pad(day)}T${pad(hour)}:${pad(minute)}:00+02:00`);
    return {
      dayKey: `2026-09-${pad(day)}`,
      opensTs: osloTs(opens, 0),
      closesTs: osloTs(closes, 0),
      lastStartTs: lastStart === null ? null : osloTs(lastStart[0], lastStart[1]),
    };
  }

  it('says the salon is shut on a day it keeps no hours on', () => {
    pinToday(A_SUNDAY_MIDDAY);
    // Sunday is absent from the schedule, which IS the answer — there is no
    // «closed» flag to read.
    render(
      <TimeStep
        slots={[]}
        days={[at(12, 0, 6).startTs]}
        openDays={[]}
        phone="22334455"
        onPick={vi.fn()}
      />
    );

    expect(screen.getByText(/Stengt i dag/)).toBeTruthy();
    expect(screen.queryByText(/Fullt/)).toBeNull();
  });

  it('offers no telephone on a day the salon is shut, because nobody is there', () => {
    pinToday(A_SUNDAY_MIDDAY);
    render(
      <TimeStep
        slots={[]}
        days={[at(12, 0, 6).startTs]}
        openDays={[]}
        phone="22334455"
        onPick={vi.fn()}
      />
    );

    // The point of the whole change: «ring oss» is an instruction, and an
    // instruction to telephone a closed salon is worse than saying nothing.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says the day is over, not that it is full, once the last start has passed', () => {
    // 18:45 on a day whose last bookable start was 16:30 — the observed bug.
    pinToday(A_THURSDAY_EVENING);
    render(
      <TimeStep
        slots={[]}
        days={[at(12).startTs]}
        openDays={[openDay(3)]}
        phone="22334455"
        onPick={vi.fn()}
      />
    );

    expect(screen.getByText(/For sent i dag/)).toBeTruthy();
    expect(screen.queryByText(/Fullt/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('still says «Fullt», with the telephone, when the day is open and taken', () => {
    // The one case where «fullt» is true and «ring oss» is worth doing: the
    // salon is open, there is time left in the day, and every chair is booked.
    pinToday(A_THURSDAY_MORNING);
    render(
      <TimeStep
        slots={[]}
        days={[at(12).startTs]}
        openDays={[openDay(3)]}
        phone="22334455"
        onPick={vi.fn()}
      />
    );

    expect(screen.getByText(/Fullt i dag/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ring oss/ })).toHaveAttribute(
      'href',
      expect.stringContaining('tel:')
    );
  });

  it('says shut, not full, on a holiday the salon posts hours for', () => {
    // A whole-day closure over a weekday the salon normally works. The hours
    // are still reported, and `lastStartTs: null` is what says it is shut.
    pinToday(A_THURSDAY_MORNING);
    render(
      <TimeStep
        slots={[]}
        days={[at(12).startTs]}
        openDays={[openDay(3, { lastStart: null })]}
        phone="22334455"
        onPick={vi.fn()}
      />
    );

    expect(screen.getByText(/Stengt i dag/)).toBeTruthy();
    expect(screen.queryByText(/Fullt/)).toBeNull();
  });

  it('will not claim a day is full when the visitor asked for one stylist', () => {
    // The schedule is fetched for the SALON, not for the stylist — so an open
    // day with no slots for Marcus may be a day Marcus does not work, and
    // «Fullt» would be a fresh false claim in place of the one just removed.
    // Naming him is true whichever it is.
    pinToday(A_THURSDAY_MORNING);
    render(
      <TimeStep
        slots={[]}
        days={[at(12).startTs]}
        openDays={[openDay(3)]}
        stylistName="Marcus"
        phone="22334455"
        onPick={vi.fn()}
      />
    );

    expect(screen.getByText(/Marcus har ingen ledige tider i dag/)).toBeTruthy();
    expect(screen.queryByText(/Fullt/)).toBeNull();
    expect(screen.getByRole('link', { name: /Ring oss/ })).toBeTruthy();
  });

  it('falls back to the copy that is true whatever the hours are, when they failed to load', () => {
    // `null` is «we could not read the salon's hours», and it must not become
    // «the salon keeps none» — that would answer «Stengt» for every day of the
    // week off a failure of ours.
    pinToday(A_THURSDAY_EVENING);
    render(
      <TimeStep
        slots={[]}
        days={[at(12).startTs]}
        openDays={null}
        phone="22334455"
        onPick={vi.fn()}
      />
    );

    expect(screen.getByText(/Ingenting ledig i dag/)).toBeTruthy();
    expect(screen.queryByText(/Stengt/)).toBeNull();
    expect(screen.queryByText(/Fullt/)).toBeNull();
  });

  it('never hides a day that has something bookable on it', () => {
    // The strip filter and the chips are computed from different sources — the
    // schedule and the availability search — and where they disagree the slots
    // win. A `lastStartTs` that is wrong in the early direction (a family visit
    // is longer than the service the schedule was asked about) must not be able
    // to take a day with free chairs off the strip.
    pinToday(A_THURSDAY_EVENING);
    render(
      <TimeStep
        slots={[at(19, 0, 3)]}
        days={[at(12, 0, 3).startTs, at(12, 0, 4).startTs]}
        openDays={[openDay(3), openDay(4)]}
        onPick={vi.fn()}
      />
    );

    // 18:45, and the day's last start was 16:30 — so the schedule calls today
    // over. There is a 19:00 chip regardless, so today stays.
    expect(screen.getByRole('button', { name: 'I dag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /19:00/ })).toBeInTheDocument();
  });

  it('keeps a shut day out of the date strip entirely', () => {
    pinToday(A_THURSDAY_MORNING);
    render(
      <TimeStep
        slots={[at(12, 0, 4)]}
        days={[at(12, 0, 3).startTs, at(12, 0, 4).startTs, at(12, 0, 6).startTs]}
        openDays={[openDay(3), openDay(4)]}
        onPick={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'I dag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I morgen' })).toBeInTheDocument();
    // Sunday keeps no hours, so it is not a day to offer at all.
    expect(screen.queryByRole('button', { name: /søn/ })).toBeNull();
  });

  it('drops today from the strip once the salon is done for the day', () => {
    pinToday(A_THURSDAY_EVENING);
    render(
      <TimeStep
        slots={[at(12, 0, 4)]}
        days={[at(12, 0, 3).startTs, at(12, 0, 4).startTs]}
        openDays={[openDay(3), openDay(4)]}
        onPick={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'I dag' })).toBeNull();
    // And the visitor lands on a day that has something on it, rather than on
    // a dead end they have to tap their way off.
    expect(screen.getByRole('button', { name: /12:00/ })).toBeInTheDocument();
  });

  it('keeps the day a slot was stolen from, even after that day is over', () => {
    // The visitor is standing on it. Filtering it out would move them off the
    // day they just lost without saying so.
    pinToday(A_THURSDAY_EVENING);
    render(
      <TimeStep
        slots={[at(12, 0, 4)]}
        days={[at(12, 0, 3).startTs, at(12, 0, 4).startTs]}
        openDays={[openDay(3), openDay(4)]}
        takenSlotTs={at(16, 0, 3).startTs}
        onPick={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'I dag' })).toBeInTheDocument();
  });
});

describe('TimeStep — a family', () => {
  const JENTEKLIPP: WizardService = { ...GUTTEKLIPP, id: 'svc-jenteklipp', name: 'Jenteklipp' };
  const ITEMS: WizardItem[] = [{ service: GUTTEKLIPP }, { service: JENTEKLIPP }];

  /** The catalogue step 2 rendered, as the chip is handed it. */
  const stylistName = (resourceId: string) =>
    ({ 'res-sara': 'Sara', 'res-marcus': 'Marcus' })[resourceId] ?? null;

  /** Monday 31 August 2026, so Thursday the 3rd is «torsdag» rather than «i
   * dag» — the report's own sentence names a weekday. */
  const A_MONDAY = Date.parse('2026-08-31T09:00:00+02:00');

  function sequentialAt(hour: number): PartySlot {
    const startTs = at(hour).startTs;
    return {
      startTs,
      mode: 'sequential',
      seats: [
        { startTs, resourceId: 'res-sara' },
        { startTs: startTs + 30 * 60_000, resourceId: 'res-sara' },
      ],
    };
  }

  function parallelAt(hour: number): PartySlot {
    const startTs = at(hour).startTs;
    return {
      startTs,
      mode: 'parallel',
      seats: [
        { startTs, resourceId: 'res-marcus' },
        { startTs, resourceId: 'res-sara' },
      ],
    };
  }

  /** The whole visit on one chip — «15:00 → 16:00» — because that is what the
   * parent is agreeing to, and the second child's half hour is the part they
   * would otherwise plan around wrongly. */
  it('shows a back-to-back visit as one chip that says when it ends', () => {
    pinToday(A_MONDAY);
    const onPickParty = vi.fn();
    const slot = sequentialAt(15);

    render(
      <TimeStep
        slots={[]}
        days={[slot.startTs]}
        onPick={vi.fn()}
        party={{
          items: ITEMS,
          mode: 'sequential',
          slots: [slot],
          resolveStylistName: stylistName,
          onPick: onPickParty,
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '15:00 → 16:00' }));
    // The whole slot, seating and all: the submission needs a stylist per line
    // and the confirmation card reads the same seats back.
    expect(onPickParty).toHaveBeenCalledWith(slot);
  });

  /**
   * The report's parallel chip. It names people because that is the offer —
   * two chairs at once — and there is no other screen on which «Marcus» and
   * «Sara» appear together before the confirmation.
   */
  it('names both stylists on a simultaneous chip', () => {
    pinToday(A_MONDAY);
    const slot = parallelAt(15);

    render(
      <TimeStep
        slots={[]}
        days={[slot.startTs]}
        onPick={vi.fn()}
        party={{
          items: ITEMS,
          mode: 'parallel',
          slots: [slot],
          resolveStylistName: stylistName,
          onPick: vi.fn(),
        }}
      />
    );

    // The services, not the children: step 4 is where the names are asked, and
    // at this moment the wizard genuinely does not know them.
    expect(
      screen.getByRole('button', { name: '15:00 (Gutteklipp hos Marcus · Jenteklipp hos Sara)' })
    ).toBeInTheDocument();
  });

  it('uses the children’s names once the parent has given them', () => {
    pinToday(A_MONDAY);
    const slot = parallelAt(15);

    render(
      <TimeStep
        slots={[]}
        days={[slot.startTs]}
        onPick={vi.fn()}
        party={{
          items: [
            { service: GUTTEKLIPP, bookedForName: 'Jonas' },
            { service: JENTEKLIPP, bookedForName: 'Emma' },
          ],
          mode: 'parallel',
          slots: [slot],
          resolveStylistName: stylistName,
          onPick: vi.fn(),
        }}
      />
    );

    // The report's chip, verbatim, for the visitor who steps back to change the
    // hour after filling in step 4.
    expect(
      screen.getByRole('button', { name: '15:00 (Jonas hos Marcus · Emma hos Sara)' })
    ).toBeInTheDocument();
  });

  /**
   * The report's rescue, word for word. A family whose Thursday has no
   * back-to-back opening is offered the simultaneous one instead of being shown
   * an empty day — and it is an offer they can take, not a consolation.
   */
  it('offers the simultaneous alternative rather than an empty day', () => {
    pinToday(A_MONDAY);
    const onPickParty = vi.fn();
    const alternative = parallelAt(15);

    render(
      <TimeStep
        slots={[]}
        days={[alternative.startTs]}
        phone="22334455"
        onPick={vi.fn()}
        party={{
          items: ITEMS,
          mode: 'sequential',
          slots: [],
          alternatives: [alternative],
          resolveStylistName: stylistName,
          onPick: onPickParty,
        }}
      />
    );

    expect(
      screen.getByText(
        'Ingen ledige timer rett etter hverandre torsdag – men begge kan tas samtidig kl. 15:00.'
      )
    ).toBeInTheDocument();
    // Not the empty-day card at all. The telephone is the answer when there is
    // nothing on the day, and there is something. No `openDays` here, so that
    // card would read «Ingenting ledig» — the fallback wording — if it rendered.
    expect(screen.queryByText(/Ingenting ledig/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ta 15:00 samtidig' }));
    // The parallel slot, whose own `mode` is what seats the submission side by
    // side — accepting here is the same gesture as having chosen «To frisører
    // samtidig» on step 2.
    expect(onPickParty).toHaveBeenCalledWith(alternative);
  });

  it('keeps the telephone for a day that has nothing either way', () => {
    pinToday(A_MONDAY);
    render(
      <TimeStep
        slots={[]}
        days={[at(15).startTs]}
        phone="22334455"
        onPick={vi.fn()}
        party={{
          items: ITEMS,
          mode: 'sequential',
          slots: [],
          alternatives: [],
          resolveStylistName: stylistName,
          onPick: vi.fn(),
        }}
      />
    );

    expect(screen.getByText(/Ingenting ledig/)).toBeInTheDocument();
    expect(screen.queryByText(/kan tas samtidig/)).toBeNull();
  });

  /** The offer is a rescue from an empty day, not a second opinion. Beside
   * slots that do exist it would answer a question nobody asked. */
  it('says nothing about simultaneity on a day that has back-to-back times', () => {
    pinToday(A_MONDAY);
    render(
      <TimeStep
        slots={[]}
        days={[at(15).startTs]}
        onPick={vi.fn()}
        party={{
          items: ITEMS,
          mode: 'sequential',
          slots: [sequentialAt(17)],
          alternatives: [parallelAt(15)],
          resolveStylistName: stylistName,
          onPick: vi.fn(),
        }}
      />
    );

    expect(screen.getByRole('button', { name: '17:00 → 18:00' })).toBeInTheDocument();
    expect(screen.queryByText(/kan tas samtidig/)).toBeNull();
  });

  /**
   * The surcharge is the family's, not one child's. Quoting 539 kr beside a
   * summary bar reading «980 kr» would be a third number on the same screen and
   * the smallest of the three.
   */
  it('quotes the weekend surcharge for the whole family', () => {
    pinToday(A_MONDAY);
    const saturday = at(11, 0, 5).startTs;

    render(
      <TimeStep
        slots={[]}
        days={[saturday]}
        onPick={vi.fn()}
        party={{
          items: ITEMS,
          mode: 'sequential',
          slots: [
            {
              startTs: saturday,
              mode: 'sequential',
              seats: [
                { startTs: saturday, resourceId: 'res-sara' },
                { startTs: saturday + 30 * 60_000, resourceId: 'res-sara' },
              ],
            },
          ],
          resolveStylistName: stylistName,
          onPick: vi.fn(),
        }}
      />
    );

    // 490 kr + 10 % each, twice over. Read exactly: Testing Library's default
    // normalizer collapses whitespace, and `\\s` in JavaScript includes the
    // non-breaking space — so it would quietly accept a note that let «1 078 kr»
    // wrap in half at the bottom of a narrow phone.
    expect(
      screen.getByText('Lør/søn: +10\u00a0% helgetillegg (1\u00a0078\u00a0kr)', {
        normalizer: exactly,
      })
    ).toBeInTheDocument();
  });

  /**
   * The percentage used to be the FIRST service's, on the strength of the salon
   * seeding all fourteen services with the same one. `totalPriceOre` has never
   * agreed to that shortcut — it applies each service's own rate per line —
   * so the day the salon prices one service differently the note would have
   * said «+10 %» beside a total that also carried a 15 % line.
   */
  describe('a family basket with two different weekend rates', () => {
    /** A dearer weekend than its sibling's, and the whole point of the two
     * tests below: 490 kr at 15 % is 563,50, not 539. */
    const DEARER: WizardService = { ...GUTTEKLIPP, id: 'svc-dearer', weekendSurchargePct: 15 };
    const NO_SURCHARGE: WizardService = { ...GUTTEKLIPP, id: 'svc-flat', weekendSurchargePct: 0 };

    function renderSaturdayNote(items: WizardItem[]) {
      const saturday = at(11, 0, 5).startTs;
      pinToday(A_MONDAY);
      render(
        <TimeStep
          slots={[]}
          days={[saturday]}
          onPick={vi.fn()}
          party={{
            items,
            mode: 'sequential',
            slots: [],
            resolveStylistName: stylistName,
            onPick: vi.fn(),
          }}
        />
      );
    }

    it('names no percentage when the basket carries more than one', () => {
      renderSaturdayNote([{ service: GUTTEKLIPP }, { service: DEARER }]);

      // 53 900 + 56 350 øre. The total is the honest part and stays; the single
      // percentage is the part that cannot be true of both lines, and goes.
      expect(
        screen.getByText('Lør/søn: med helgetillegg (1\u00a0103\u00a0kr)', {
          normalizer: exactly,
        })
      ).toBeInTheDocument();
    });

    it('still charges for the note when only the second child pays a surcharge', () => {
      // Reading the rate off `items[0]` also suppressed the note outright here,
      // and the parent met the surcharge for the first time on the total.
      renderSaturdayNote([{ service: NO_SURCHARGE }, { service: GUTTEKLIPP }]);

      expect(
        screen.getByText('Lør/søn: med helgetillegg (1\u00a0029\u00a0kr)', {
          normalizer: exactly,
        })
      ).toBeInTheDocument();
    });

    it('says nothing when no line pays one', () => {
      renderSaturdayNote([{ service: NO_SURCHARGE }, { service: NO_SURCHARGE }]);

      expect(screen.queryByText(/helgetillegg/)).toBeNull();
    });
  });
  /**
   * «Vis hele måneden» — frame «Booking 2b».
   *
   * The grid is a second way of reading the SAME seven days, and every one of
   * these is about that: it opens on the month the chosen day is in, it makes
   * the days the wizard actually asked about tappable and nothing else, and it
   * navigates without ever pretending to know about a date outside the window.
   */
  describe('the month view', () => {
    /** Thursday 3 September 2026, so «September 2026» is the opening month and
     * October is one tap to the right. */
    const A_THURSDAY = Date.parse('2026-09-03T09:00:00+02:00');

    function renderMonth(onPick = vi.fn()) {
      pinToday(A_THURSDAY);
      return render(
        <TimeStep
          monthView
          slots={[at(11), at(13, 0, 4)]}
          days={[A_THURSDAY, Date.parse('2026-09-04T09:00:00+02:00')]}
          onPick={onPick}
        />
      );
    }

    it('is collapsed until it is asked for', () => {
      renderMonth();

      expect(screen.getByRole('button', { name: /Vis hele måneden/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      expect(screen.queryByText('September 2026')).toBeNull();
    });

    it('opens on the month the chosen day is in, and closes again', () => {
      renderMonth();
      const toggle = screen.getByRole('button', { name: /Vis hele måneden/ });

      fireEvent.click(toggle);
      expect(screen.getByText('September 2026')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Skjul måneden/ }));
      expect(screen.queryByText('September 2026')).toBeNull();
    });

    it('steps a month at a time in both directions', () => {
      renderMonth();
      fireEvent.click(screen.getByRole('button', { name: /Vis hele måneden/ }));

      fireEvent.click(screen.getByRole('button', { name: 'Neste måned' }));
      expect(screen.getByText('Oktober 2026')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Forrige måned' }));
      expect(screen.getByText('September 2026')).toBeInTheDocument();

      // Backwards past the turn of the year, which is where a month counter
      // that forgot to carry would put «Desember 2026».
      for (const month of ['August 2026', 'Juli 2026']) {
        fireEvent.click(screen.getByRole('button', { name: 'Forrige måned' }));
        expect(screen.getByText(month)).toBeInTheDocument();
      }
    });

    /**
     * The whole honesty of the grid. Availability was asked for seven days, so
     * a cell outside them is neither free nor full — it is a day nobody has
     * looked at, and a button there would invite a tap that could only ever
     * answer «Fullt».
     */
    it('offers only the days the wizard actually asked about', () => {
      renderMonth();
      fireEvent.click(screen.getByRole('button', { name: /Vis hele måneden/ }));

      const grid = screen.getByText('September 2026').closest('div') as HTMLElement;
      const dates = within(grid.parentElement as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.textContent)
        .filter((text) => /^\d+$/.test(text ?? ''));

      expect(dates).toEqual(['3', '4']);
      expect(screen.getByText('24')).not.toHaveAttribute('type');
    });

    it('changes the day the times are listed for', () => {
      renderMonth();
      expect(screen.getByRole('button', { name: '11:00' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Vis hele måneden/ }));
      fireEvent.click(screen.getByRole('button', { name: 'i morgen' }));

      expect(screen.getByRole('button', { name: '13:00' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '11:00' })).toBeNull();
    });

    it('says nothing about a month at all unless the caller asks for one', () => {
      pinToday(A_THURSDAY);
      render(<TimeStep slots={[at(11)]} onPick={vi.fn()} />);

      expect(screen.queryByRole('button', { name: /hele måneden/ })).toBeNull();
    });
  });
});

describe('TimeStepSkeleton', () => {
  it('holds the step’s shape — heading, a day strip and a grid of chips — while loading', () => {
    const { container } = render(<TimeStepSkeleton days={7} />);

    expect(screen.getByRole('heading', { name: 'Når passer det?' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Henter ledige tider');
    const chips = container.querySelectorAll('[data-testid="day-chip-skeleton"]');
    expect(chips).toHaveLength(7);
    // The real chips are `size="sm"` buttons: h-8.
    for (const chip of chips) expect(chip).toHaveClass('h-8');
    const slots = container.querySelectorAll('[data-testid="slot-skeleton"]');
    expect(slots.length).toBeGreaterThan(0);
    // The real time chips are `size="lg"`: auto height from 15 px padding.
    for (const slot of slots) expect(slot).toHaveClass('py-[15px]', 'min-w-20');
  });
});

describe('TimeStepSkeleton surcharge row', () => {
  it('reserves the weekend-surcharge row only when told the basket pays one', () => {
    const { container, rerender } = render(<TimeStepSkeleton surchargeRow />);
    expect(container.querySelector('[data-testid="surcharge-row-skeleton"]')).toHaveClass(
      'min-h-5'
    );
    rerender(<TimeStepSkeleton />);
    expect(container.querySelector('[data-testid="surcharge-row-skeleton"]')).toBeNull();
  });
});

describe('TakenToast', () => {
  it('is an empty live region until a slot is lost, then a fixed toast', () => {
    const { rerender } = render(<TakenToast takenSlotTs={null} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();

    rerender(<TakenToast takenSlotTs={at(15).startTs} />);
    // The same element, filled — not a new one arriving with its text.
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Oi, den ble nettopp tatt');
    expect(region).toHaveClass('fixed');
  });

  it('closes on «Lukk», and on its own after a while', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { rerender } = render(<TakenToast takenSlotTs={at(15).startTs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lukk' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    rerender(<TakenToast takenSlotTs={at(16).startTs} />);
    expect(screen.getByRole('status')).toHaveTextContent('Oi, den ble nettopp tatt');
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    vi.useRealTimers();
  });
});
