import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, reduce, SummaryBar, type WizardService } from '../../support/legacy-steps';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * The bar now quotes a day as well as an hour, and this suite usually runs in
 * Oslo — where a bar that asked `Date` what time it was would print exactly the
 * right string and no assertion here would notice until a parent booked from
 * Spain.
 */
pinAForeignViewerClock();

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

/** The stylists step 2 rendered, as the lookup the bar is handed. */
const stylistName = (resourceId: string) => (resourceId === 'res-sara' ? 'Sara' : null);

/** The bar renders exactly `summaryLine`, so the assertions read it exactly.
 * See the first of them for what the default normalizer would let through. */
const exactly = (text: string) => text;

/** 15:00 Oslo on Thursday 3 September 2026. */
const THURSDAY_15 = Date.UTC(2026, 8, 3, 13);

/**
 * «i dag» is a claim about when the bar is being read, and the bar reads the
 * clock itself — so the clock is the thing to pin. Only `Date` is faked: the
 * component renders synchronously and nothing here waits on a timer, and faking
 * those as well would leave React's own scheduling to a clock nobody advances.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 8, 3, 8));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SummaryBar', () => {
  /**
   * Layout stability: a bar that appeared on the first tap pushed the page's
   * end down under the parent's thumb. It is there from step 1, at one fixed
   * height, and says what is next.
   */
  it('is there, at its fixed height, before anything is chosen', () => {
    const { container } = render(
      <SummaryBar state={initialState()} resolveStylistName={stylistName} onNext={vi.fn()} />
    );
    const bar = container.firstElementChild;
    expect(bar).toHaveClass('h-16');
    // Step 1 is «Hvem skal klippes?», and the bar says what comes first.
    expect(screen.getByText('Velg hvem som skal klippes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();
  });

  it('asks for a service once step 1 is answered but nothing is chosen', () => {
    render(
      <SummaryBar
        state={{ ...initialState(), step: 'service' }}
        resolveStylistName={stylistName}
        onNext={vi.fn()}
      />
    );
    expect(screen.getByText('Velg en tjeneste')).toBeInTheDocument();
  });

  it('names a stylist the way step 2 does, not by the salon’s admin label', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-sara' });
    render(
      <SummaryBar state={state} resolveStylistName={() => 'sara (Salong Demo)'} onNext={vi.fn()} />
    );
    expect(
      screen.getByText('Gutteklipp · Sara · Velg tid · 490 kr', { normalizer: exactly })
    ).toBeInTheDocument();
  });

  it('says exactly what the machine says, placeholders and all', () => {
    const state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    render(<SummaryBar state={state} resolveStylistName={stylistName} onNext={vi.fn()} />);

    // The dashes are the promise of what is left. A bar that assembled its own
    // sentence would drop them and read as a receipt for a booking nobody made.
    //
    // `normalizer` off, in both of these: Testing Library's default collapses
    // whitespace, and `\s` in JavaScript includes the non-breaking space — so
    // the default would quietly accept a bar that let «490 kr» wrap in half at
    // the bottom of a narrow phone.
    expect(
      screen.getByText('Gutteklipp · Første ledige · Velg tid · 490 kr', { normalizer: exactly })
    ).toBeInTheDocument();
  });

  /**
   * The whole point of the bar: it accretes. The report's own example is
   * «Gutteklipp · Sara · i dag 15:00 · 490 kr», and every part of it comes from
   * somewhere the bar does not own — the name from the resolver it was passed,
   * the day and hour from the salon's clock, the price from the same
   * `totalPriceOre` step 4's button quotes.
   */
  it('fills the dashes in as the visitor answers, down to the stylist’s name', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-sara' });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-sara' });
    // Back onto `when`, because `pickSlot` lands on `login` and step 4 hides
    // the bar — and `when` is where a visitor changing their hour would see it.
    state = reduce(state, { type: 'goToStep', step: 'when' });

    render(<SummaryBar state={state} resolveStylistName={stylistName} onNext={vi.fn()} />);

    expect(
      screen.getByText('Gutteklipp · Sara · i dag 15:00 · 490 kr', { normalizer: exactly })
    ).toBeInTheDocument();
  });

  it('gets out of the way on the step that has its own button', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: null });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: null });

    const { container } = render(
      <SummaryBar
        state={reduce(state, { type: 'goToStep', step: 'details' })}
        resolveStylistName={stylistName}
        onNext={vi.fn()}
      />
    );

    // Step 4's «Bekreft time – 490 kr betales i salongen» carries the price and
    // the commitment. A «Neste» stuck to the bottom of the same screen would be
    // a second submit with different words.
    // `pickSlot` stops on the login now, so the last step is reached the way a
    // parent who declines both logins reaches it.
    const details = reduce(state, { type: 'goToStep', step: 'details' });
    expect(details.step).toBe('details');
    expect(container).toBeEmptyDOMElement();
  });

  it('takes Neste straight from the machine, in both directions', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: null });
    // On the when step with no slot chosen, the machine refuses to advance.
    render(<SummaryBar state={state} resolveStylistName={stylistName} onNext={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();

    const withSlot = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: null });
    const onNext = vi.fn();
    render(
      <SummaryBar
        state={reduce(withSlot, { type: 'goToStep', step: 'when' })}
        resolveStylistName={stylistName}
        onNext={onNext}
      />
    );

    const enabled = screen.getAllByRole('button', { name: 'Neste' })[1];
    expect(enabled).toBeEnabled();
    fireEvent.click(enabled);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
