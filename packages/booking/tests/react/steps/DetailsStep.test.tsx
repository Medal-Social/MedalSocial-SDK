import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DetailsStep,
  initialState,
  type WizardService,
  type WizardState,
} from '../../support/legacy-steps';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * The button quotes a price that depends on whether the chosen slot falls on a
 * *salon* weekend, and this suite usually runs in Oslo — where a component
 * asking `Date` which day it is would agree with a correct one on every case.
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

const JENTEKLIPP: WizardService = { ...GUTTEKLIPP, id: 'svc-jenteklipp', name: 'Jenteklipp' };

/** Thursday 3 September 2026, 15:00 Oslo. The 5th is the Saturday. */
const THURSDAY_15 = Date.parse('2026-09-03T15:00:00+02:00');
const SATURDAY_15 = Date.parse('2026-09-05T15:00:00+02:00');

/** Everything the previous three steps answered, with a phone that is a phone. */
function readyState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...initialState(),
    step: 'details',
    items: [{ service: GUTTEKLIPP }],
    startTs: THURSDAY_15,
    resolvedResourceId: 'res-sara',
    contact: { phone: '40000000', name: '', email: '' },
    consentTerms: true,
    ...overrides,
  };
}

/** Seven digits — the exact mistake the report's sentence is written for. */
function badPhoneState(): WizardState {
  return readyState({ contact: { phone: '4000000', name: '', email: '' } });
}

const submitButton = () => screen.getByRole('button', { name: /Bekreft time/ });

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('DetailsStep', () => {
  it('asks the last question the wizard has', () => {
    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Nesten ferdig!' })).toBeInTheDocument();
  });

  /**
   * The order is the product: phone first because it is the identity key in
   * Norway, the child's name next to the year that qualifies it, and the two
   * consents last — the required one in plain language rather than linked away.
   * Reading the labels off the DOM in document order is what makes this an
   * assertion about the form rather than about a list of strings.
   */
  it('asks for what it needs in the order the report sets, in its words', () => {
    const { container } = render(
      <DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={vi.fn()} />
    );

    expect([...container.querySelectorAll('label')].map((label) => label.textContent)).toEqual([
      'Mobilnummer',
      'Ditt navn',
      'Hvem skal klippes?',
      'Fødselsår',
      'E-post',
      'Noe vi bør vite?',
      // Deliberately no figure: the 24 was a policy value the salon sets in the
      // dashboard, separately for cancelling and for moving, and a checkbox
      // naming a constant promises what the manage page then refuses.
      'Jeg forstår at timen kan endres eller avbestilles gratis frem til fristen salongen har satt.',
      'Minn meg på når det er på tide med ny klipp, og send meg tilbud fra Salong Demo.',
    ]);
    expect(screen.getByText('for bekreftelse og kalenderinvitasjon')).toBeInTheDocument();
  });

  it('leaves the marketing consent unchecked — it is the reactivation opt-in', () => {
    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /Minn meg på/ })).not.toBeChecked();
  });

  it('keeps submit enabled and shows the error inline, so nothing looks broken', () => {
    render(<DetailsStep state={badPhoneState()} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Bekreft time/ })).toBeEnabled();
    expect(screen.getByText(/Sjekk mobilnummeret/)).toBeTruthy();
  });

  /**
   * The other half of "on blur": a form that starts correcting you at the first
   * digit is the one that feels broken. The error is suppressed while the field
   * has focus and returns the moment the thumb leaves it.
   */
  it('holds its tongue while the visitor is still typing the number', () => {
    render(<DetailsStep state={badPhoneState()} onChange={vi.fn()} onSubmit={vi.fn()} />);
    const field = screen.getByLabelText('Mobilnummer');

    fireEvent.focus(field);
    expect(screen.queryByText(/Sjekk mobilnummeret/)).toBeNull();

    fireEvent.blur(field);
    expect(screen.getByText(/Sjekk mobilnummeret/)).toBeInTheDocument();
  });

  it('says nothing about a phone number nobody has typed yet', () => {
    // The pristine form is the one place an error is unambiguously wrong: the
    // field is empty because the visitor has not reached it.
    render(
      <DetailsStep
        state={readyState({ contact: { phone: '', name: '', email: '' } })}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByText(/Sjekk mobilnummeret/)).toBeNull();
  });

  it('sends the optional birth year on the line item, not on the contact', () => {
    const onSubmit = vi.fn();
    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Fødselsår'), { target: { value: '2017' } });
    fireEvent.click(screen.getByRole('button', { name: /Bekreft time/ }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ items: [expect.objectContaining({ bookedForBirthYear: 2017 })] })
    );
  });

  /**
   * `Number.parseInt` takes whatever numeric PREFIX it finds and stops, so
   * `201x` came back 201 and `20a7` came back 20 — a wrong year filed against a
   * child, silently, and nothing on screen to say so.
   *
   * `inputMode="numeric"` does not stop any of these: it asks a phone for a
   * numeric keypad and has no opinion about a paste or a hardware keyboard.
   * `2200` is the engine's own ceiling and `1900` its floor, so agreeing with
   * them here is what makes a slipped digit a field the parent left empty
   * rather than a 422 after they press «Bekreft time».
   */
  it.each([
    ['201x', 'a slipped key at the end'],
    ['20a7', 'a letter in the middle'],
    ['20 17', 'a space in the middle'],
    ['201', 'three digits — nobody was born in the year 201'],
    ['2o17', 'the letter o for the digit zero'],
    ['12017', 'one digit too many'],
    ['1899', 'a year below the engine’s floor'],
    ['2201', 'a year above the engine’s ceiling'],
  ])('sends no birth year at all for %s (%s)', (typed) => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    render(<DetailsStep state={readyState()} onChange={onChange} onSubmit={onSubmit} />);

    fill('Fødselsår', typed);
    fireEvent.click(submitButton());

    // Absent, not `null` and not `''` — the engine's `z.number().optional()`
    // refuses both, so a coalesced-at-the-edge value would be a 400 rather than
    // the shrug an optional field deserves.
    expect(onSubmit.mock.calls[0][0].items[0]).not.toHaveProperty('bookedForBirthYear');
    // And the machine is told to drop it too, so the two cannot disagree about
    // which year the salon ends up holding.
    expect(onChange).toHaveBeenCalledWith({
      type: 'setItemField',
      index: 0,
      field: 'bookedForBirthYear',
      value: null,
    });
  });

  it('still takes a year at each end of what the salon can actually book', () => {
    const onSubmit = vi.fn();
    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={onSubmit} />);

    // Trimmed rather than refused: a trailing space is an autofill artefact, not
    // a typo, and the whole *trimmed* field is a year.
    fill('Fødselsår', ' 1900 ');
    fireEvent.click(submitButton());
    expect(onSubmit.mock.calls[0][0].items[0].bookedForBirthYear).toBe(1900);

    fill('Fødselsår', '2200');
    fireEvent.click(submitButton());
    expect(onSubmit.mock.calls[1][0].items[0].bookedForBirthYear).toBe(2200);
  });

  /**
   * The trap `medal-client.ts` documents: the engine takes `contact.name` and
   * `booked_for_name` as `.trim().min(1).optional()`, where `''` is a 400 and
   * not a shrug. The create route coalesces as a second line of defence, but a
   * component that sends `''` for every field a parent skipped is a component
   * that would break the moment anything else consumed the same payload.
   */
  it('omits every optional field the parent left blank, rather than sending an empty one', () => {
    const onSubmit = vi.fn();
    render(
      // «Første ledige», which is the default on step 2 and the common path.
      <DetailsStep
        state={readyState({ resolvedResourceId: null })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    // Typed, then cleared — which is how a number field ends up holding a value
    // that serialises to null rather than to nothing at all.
    fill('Fødselsår', '2017');
    fill('Fødselsår', '');
    fill('Hvem skal klippes?', '   ');
    fireEvent.click(submitButton());

    const submission = onSubmit.mock.calls[0][0];
    expect(Object.keys(submission.items[0]).sort()).toEqual(['serviceId', 'startTs']);
    expect('name' in submission.contact).toBe(false);
    expect('email' in submission.contact).toBe(false);
    expect('notes' in submission).toBe(false);
  });

  it('normalises the number so one parent is one contact', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({ contact: { phone: '+47 400 00 000', name: '', email: '' } })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    // The CRM dedupes contacts on the phone number, so «400 00 000» and
    // «+4740000000» from the same parent must not become two families.
    expect(onSubmit.mock.calls[0][0].contact.phone).toBe('40000000');
  });

  it('carries the resolved stylist, not the visitor’s preference', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({ resourceId: null, resolvedResourceId: 'res-sara' })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    // `resourceId` is «Første ledige», an answer about who the visitor would
    // accept. `resolvedResourceId` is who the slot turned out to be with, and
    // it is the one the engine can book.
    expect(onSubmit.mock.calls[0][0].items[0].resourceId).toBe('res-sara');
  });

  it('prices the button with what the salon will actually charge', () => {
    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={vi.fn()} />);
    // The space inside «490 kr» is the non-breaking one `formatPrice` writes,
    // and it is load-bearing: an ordinary space lets a narrow phone wrap the
    // amount away from its unit.
    expect(submitButton()).toHaveAccessibleName('Bekreft time – 490\u00A0kr betales i salongen');
  });

  it('carries the weekend surcharge into the button, on the salon’s calendar', () => {
    render(
      <DetailsStep
        state={readyState({ startTs: SATURDAY_15 })}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    // 490 kr plus the salon's 10 %. Quoting 490 on a Saturday and charging 539
    // at the chair is the one number the parent will remember.
    expect(submitButton()).toHaveAccessibleName('Bekreft time – 539\u00A0kr betales i salongen');
  });

  it('adds the party up, so two children are not priced as one', () => {
    render(
      <DetailsStep
        state={readyState({ items: [{ service: GUTTEKLIPP }, { service: JENTEKLIPP }] })}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(submitButton()).toHaveAccessibleName('Bekreft time – 980\u00A0kr betales i salongen');
  });

  it('asks each child by name when there is more than one', () => {
    render(
      <DetailsStep
        state={readyState({ items: [{ service: GUTTEKLIPP }, { service: JENTEKLIPP }] })}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    // Two identically-labelled fields with nothing to tell them apart is how the
    // second child's name ends up on the first child's booking.
    expect(screen.getByRole('group', { name: 'Gutteklipp' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Jenteklipp' })).toBeInTheDocument();
  });

  it('raises the contact fields as actions rather than answering them itself', () => {
    const onChange = vi.fn();
    render(<DetailsStep state={readyState()} onChange={onChange} onSubmit={vi.fn()} />);

    fill('Ditt navn', 'Kari');
    fill('Noe vi bør vite?', 'Redd for saks');
    fireEvent.click(screen.getByRole('checkbox', { name: /Minn meg på/ }));

    expect(onChange).toHaveBeenCalledWith({ type: 'setContact', field: 'name', value: 'Kari' });
    expect(onChange).toHaveBeenCalledWith({ type: 'setNotes', value: 'Redd for saks' });
    expect(onChange).toHaveBeenCalledWith({
      type: 'setConsent',
      which: 'marketing',
      accepted: true,
    });
  });

  /**
   * J2's all-or-nothing, as one submission: two children, two stylists, one
   * instant — and one `onSubmit`.
   *
   * `resolvedResourceId` is `null` for a parallel party by construction, so a
   * step that read it would send no stylist at all and let the engine seat both
   * children with whoever it found first — which for a simultaneous visit can
   * be the same person, and is the one booking the salon cannot honour.
   */
  it('submits a stylist per child for a family the salon split in two', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({
          items: [{ service: GUTTEKLIPP }, { service: JENTEKLIPP }],
          partyMode: 'parallel',
          resolvedResourceId: null,
          partyResourceIds: ['res-marcus', 'res-sara'],
        })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    const { items } = onSubmit.mock.calls[0][0];
    expect(items).toHaveLength(1 + 1);
    expect(items.map((item: { resourceId?: string }) => item.resourceId)).toEqual([
      'res-marcus',
      'res-sara',
    ]);
    // Both at the same instant — that is what «samtidig» means, and it is
    // `itemStartTimes` reading the mode rather than this step deciding.
    expect(items.map((item: { startTs: number }) => item.startTs)).toEqual([
      THURSDAY_15,
      THURSDAY_15,
    ]);
  });

  /** The sequential party, where one stylist takes both: same single answer,
   * repeated, and the second child half an hour after the first. */
  it('submits the one stylist twice for a family taken back to back', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({ items: [{ service: GUTTEKLIPP }, { service: JENTEKLIPP }] })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    expect(onSubmit.mock.calls[0][0].items).toEqual([
      { serviceId: 'svc-gutteklipp', resourceId: 'res-sara', startTs: THURSDAY_15 },
      {
        serviceId: 'svc-jenteklipp',
        resourceId: 'res-sara',
        startTs: THURSDAY_15 + 30 * 60_000,
      },
    ]);
  });

  it('carries the marketing opt-in on the submission, so the consent can be recorded', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({ consentMarketing: true })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    // The create body has nowhere to put it; the GDPR consent endpoint does.
    // Dropping it here would mean a box that is ticked and then forgotten.
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      consentTerms: true,
      consentMarketing: true,
    });
  });

  it('refuses to submit a number that cannot be a number, and says which field', () => {
    const onSubmit = vi.fn();
    render(<DetailsStep state={badPhoneState()} onChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(submitButton());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Mobilnummer')).toHaveAttribute('aria-invalid', 'true');
    // Focus is the half of «errors scroll into view» that also works for
    // whoever is not looking at the screen — and it puts the caret where the
    // fix has to be made rather than at the top of the form.
    expect(screen.getByLabelText('Mobilnummer')).toHaveFocus();
  });

  it('refuses to submit an address that cannot receive anything', () => {
    // The field is optional and `type="email"` does nothing here: the input is
    // not inside a `<form>`, so the browser never runs constraint validation on
    // it, and the create route only trims. Without this the booking succeeds
    // and its confirmation and calendar invitation go nowhere — which the
    // parent discovers by not being reminded.
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({ contact: { phone: '40000000', name: '', email: 'kari@' } })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('E-post')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('E-post')).toHaveFocus();
  });

  it('still books for a parent who gave no address at all', () => {
    // The whole point of the field being optional. A validator that refused
    // blank would turn a nicety into a wall.
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({ contact: { phone: '40000000', name: '', email: '  ' } })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalled();
  });

  it('accepts an ordinary address', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({ contact: { phone: '40000000', name: '', email: 'kari@example.no' } })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalled();
  });

  it('refuses to submit an unaccepted terms box, and says which box', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({ consentTerms: false })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(submitButton());

    expect(onSubmit).not.toHaveBeenCalled();
    // The button is enabled and does nothing visible otherwise, which is the
    // exact shape of a form that looks broken.
    expect(screen.getByRole('checkbox', { name: /Jeg forstår/ })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('checkbox', { name: /Jeg forstår/ })).toHaveFocus();
  });

  it('renders a submit failure from the wizard’s error, not from one of its own', () => {
    render(
      <DetailsStep
        state={readyState({ error: 'unconfigured' })}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        phone="22 33 44 55"
      />
    );

    // Announced, because it arrives after the visitor pressed a button and
    // nothing else on the screen moved.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // And never a dead end: the one failure the salon cannot fix from here is
    // the one that most needs a telephone.
    expect(screen.getByRole('link', { name: /Ring oss/ })).toHaveAttribute('href', 'tel:22334455');
  });

  it('says the same thing unlinked when the salon has no number yet', () => {
    render(
      <DetailsStep
        state={readyState({ error: 'unconfigured' })}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        phone={null}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says nothing when nothing has failed', () => {
    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes one submission per press, not one per tap', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={onSubmit} submitting={true} />
    );

    // The courtesy half of the double-tap story: the nonce below is what stops
    // the second booking, and an inert button is what stops the second tap. A
    // button that swallowed presses silently is how a parent on a slow
    // connection ends up pressing it five times.
    expect(submitButton()).toBeDisabled();

    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /**
   * The guard half.
   *
   * The create route derives the `Idempotency-Key` by hashing this value
   * together with the body, so two presses that carry the same nonce derive the
   * same key and the second replays the first instead of booking again. Minting
   * it inside `handleSubmit` — which is where the equivalent bug lived in the
   * route — would be a fresh value per press and no guarantee at all.
   */
  it('carries one nonce for the whole submission, not one per press', () => {
    const onSubmit = vi.fn();
    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(submitButton());
    fireEvent.click(submitButton());

    const first = onSubmit.mock.calls[0][0].submissionNonce;
    expect(first).toEqual(expect.any(String));
    expect(first).not.toHaveLength(0);
    expect(onSubmit.mock.calls[1][0].submissionNonce).toBe(first);
  });

  it('mints a new nonce for a new visit to the step, not one for the module', () => {
    const onSubmit = vi.fn();
    const press = (nth: number) =>
      fireEvent.click(screen.getAllByRole('button', { name: /Bekreft time/ })[nth]);

    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={onSubmit} />);
    press(0);
    // A second arrival on step 4 is a second submission attempt, and a nonce
    // hoisted to module scope would make it share the first one's key — which,
    // with an unchanged body, is a booking the parent asked for and did not get.
    render(<DetailsStep state={readyState()} onChange={vi.fn()} onSubmit={onSubmit} />);
    press(1);

    expect(onSubmit.mock.calls[1][0].submissionNonce).not.toBe(
      onSubmit.mock.calls[0][0].submissionNonce
    );
  });

  /**
   * The 502 the create route can answer with.
   *
   * It had no slot in the machine's error union, which meant the one failure
   * that arrives *after* «Bekreft time» was pressed — the visitor waiting, the
   * booking not made — had nothing to say for itself.
   */
  it('tells a parent when the timebook did not answer at all', () => {
    render(
      <DetailsStep
        state={readyState({ error: 'upstreamError' })}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        phone="22 33 44 55"
      />
    );

    // AMBIGUOUS, because a 502 is: Medal may have committed the appointment
    // and lost the response on the way back. «Timen ble ikke satt opp» is a
    // claim we cannot support, and it is the one that costs — the parent books
    // another time and the child has two. «Prøv igjen» is sound advice here
    // now: the submission is held with its nonce, so pressing it again derives
    // the same key and returns the original booking.
    expect(screen.getByRole('alert')).toHaveTextContent('Vi vet ikke om timen ble satt opp');
    expect(screen.getByRole('alert')).not.toHaveTextContent('ble ikke satt opp –');
    expect(screen.getByRole('link', { name: /Ring oss/ })).toBeInTheDocument();
  });

  /**
   * The child's two fields were held in this component's own `useState` and
   * nowhere else, which left the confirmation card — whose `items` prop exists
   * to carry «Gutteklipp for Jonas» — unable to learn a name the parent had
   * just typed one screen earlier.
   */
  it('raises the child fields as actions, so the machine owns the answers too', () => {
    const onChange = vi.fn();
    render(
      <DetailsStep
        state={readyState({ items: [{ service: GUTTEKLIPP }, { service: JENTEKLIPP }] })}
        onChange={onChange}
        onSubmit={vi.fn()}
      />
    );

    // Two children means two of every child field, so each one has to be picked
    // out by position — which is the point of the test.
    const year = (nth: number) => screen.getAllByLabelText('Fødselsår')[nth];

    fireEvent.change(year(0), { target: { value: '2017' } });
    expect(onChange).toHaveBeenCalledWith({
      type: 'setItemField',
      index: 0,
      field: 'bookedForBirthYear',
      // A number, because that is what the engine takes and what `WizardItem`
      // declares. The text on the way to it stays in the field.
      value: 2017,
    });

    // An emptied year is a clear, not a silence: the machine has to be told to
    // drop the key it is already holding.
    fireEvent.change(year(0), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({
      type: 'setItemField',
      index: 0,
      field: 'bookedForBirthYear',
      value: null,
    });

    // The second child's name on the second child's line. Two children can share
    // a service, so an index that did not follow the field would put Emma's name
    // on her brother's booking.
    fireEvent.change(screen.getAllByLabelText('Hvem skal klippes?')[1], {
      target: { value: 'Emma' },
    });
    expect(onChange).toHaveBeenCalledWith({
      type: 'setItemField',
      index: 1,
      field: 'bookedForName',
      value: 'Emma',
    });
  });

  it('shows the answers the machine already holds, so stepping back loses nothing', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={readyState({
          items: [{ service: GUTTEKLIPP, bookedForName: 'Jonas', bookedForBirthYear: 2017 }],
        })}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    // A visitor who goes back to step 3 to change the hour and returns finds the
    // boxes as they left them, because this step reads them off the items rather
    // than starting empty.
    expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Jonas');
    expect(screen.getByLabelText('Fødselsår')).toHaveValue('2017');

    fireEvent.click(submitButton());
    expect(onSubmit.mock.calls[0][0].items[0]).toMatchObject({
      bookedForName: 'Jonas',
      bookedForBirthYear: 2017,
    });
  });
  /**
   * The children on a logged-in parent's Min side profile, offered as one tap
   * each. The fields stay exactly as editable as they are for everyone else —
   * a booking for a cousin is still typed in by hand.
   */
  describe('the profile suggestions', () => {
    const FAMILY = [
      { name: 'Jonas', birthYear: 2017 },
      { name: 'Emma', birthYear: 2020 },
    ];

    it('renders nothing at all when there is no profile', () => {
      render(<DetailsStep state={readyState({})} onChange={vi.fn()} onSubmit={vi.fn()} />);

      expect(screen.queryByRole('button', { name: 'Jonas' })).toBeNull();
    });

    it('fills both fields from one tap', () => {
      const onChange = vi.fn();
      render(
        <DetailsStep
          state={readyState({})}
          family={FAMILY}
          onChange={onChange}
          onSubmit={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Emma' }));

      expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Emma');
      expect(screen.getByLabelText('Fødselsår')).toHaveValue('2020');
      expect(onChange).toHaveBeenCalledWith({
        type: 'setItemField',
        index: 0,
        field: 'bookedForName',
        value: 'Emma',
      });
    });

    /**
     * The tap writes both fields, so both have to match for the chip to be
     * announced as chosen — otherwise a suggestion whose year has since been
     * corrected still tells a screen reader it is selected.
     */
    it('stops announcing itself as chosen once the year is corrected', () => {
      render(
        <DetailsStep state={readyState({})} family={FAMILY} onChange={vi.fn()} onSubmit={vi.fn()} />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Jonas' }));
      expect(screen.getByRole('button', { name: 'Jonas' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.change(screen.getByLabelText('Fødselsår'), { target: { value: '2018' } });

      expect(screen.getByRole('button', { name: 'Jonas' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });
  });
});

/**
 * SP10: a saved child ticked on step 1. «Bekreft» says who instead of asking,
 * and the child's id travels only under the parent's own number.
 */
describe('DetailsStep for a saved child', () => {
  function jonasState(phone = '40000000'): WizardState {
    return readyState({
      people: [{ key: 'p:p-jonas', personId: 'p-jonas', name: 'Jonas', birthYear: 2018 }],
      choices: [GUTTEKLIPP],
      items: [
        {
          service: GUTTEKLIPP,
          bookedForName: 'Jonas',
          bookedForBirthYear: 2018,
          bookedForPersonId: 'p-jonas',
        },
      ],
      contact: { phone, name: 'Kari', email: '' },
    });
  }

  it('names the child rather than asking, and sends the id under the parent’s own number', () => {
    const onSubmit = vi.fn();
    render(
      <DetailsStep
        state={jonasState()}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        guardianPhone="+47 400 00 000"
      />
    );

    expect(screen.queryByLabelText('Hvem skal klippes?')).toBeNull();
    expect(screen.getByRole('list', { name: 'Hvem som skal klippes' })).toHaveTextContent(
      'Gutteklipp for Jonas'
    );
    fireEvent.click(submitButton());

    expect(onSubmit.mock.calls[0][0].items[0]).toMatchObject({
      bookedForName: 'Jonas',
      bookedForBirthYear: 2018,
      bookedForPersonId: 'p-jonas',
    });
  });

  it('keeps the id back under another number, or with no parent to compare to', () => {
    const other = vi.fn();
    const { unmount } = render(
      <DetailsStep
        state={jonasState('99887766')}
        onChange={vi.fn()}
        onSubmit={other}
        guardianPhone="+47 400 00 000"
      />
    );
    fireEvent.click(submitButton());
    expect(other.mock.calls[0][0].items[0]).not.toHaveProperty('bookedForPersonId');
    expect(other.mock.calls[0][0].items[0]).toMatchObject({ bookedForName: 'Jonas' });
    unmount();

    const nobody = vi.fn();
    render(<DetailsStep state={jonasState()} onChange={vi.fn()} onSubmit={nobody} />);
    fireEvent.click(submitButton());
    expect(nobody.mock.calls[0][0].items[0]).not.toHaveProperty('bookedForPersonId');
  });

  it('attaches the saved child a family chip names on a guest line, and detaches on typing', () => {
    const onChange = vi.fn();
    render(
      <DetailsStep
        state={readyState()}
        onChange={onChange}
        onSubmit={vi.fn()}
        family={[{ name: 'Jonas', birthYear: 2018, personId: 'p-jonas' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Jonas' }));
    expect(onChange).toHaveBeenCalledWith({
      type: 'setItemField',
      index: 0,
      field: 'bookedForPersonId',
      value: 'p-jonas',
    });

    fill('Hvem skal klippes?', 'Jonas E');
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'setItemField',
      index: 0,
      field: 'bookedForPersonId',
      value: null,
    });
  });
});
