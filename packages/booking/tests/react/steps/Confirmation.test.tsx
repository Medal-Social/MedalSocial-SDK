import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WizardItem, WizardService } from '../../support/legacy-steps';
import { BASE_URL, Confirmation, type ConfirmationLine } from '../../support/legacy-steps';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * Everything on this screen is a clock face — «i dag kl. 15:00» and the two
 * start times in the family card — and this suite normally runs in Oslo, where
 * a component reading the viewer's clock would render the identical string.
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

/** Thursday 3 September 2026, 15:00 Oslo — 13:00 UTC, inside CEST. */
const THURSDAY_15 = Date.parse('2026-09-03T15:00:00+02:00');

/** The same hour two days later: a salon Saturday, which is what the surcharge
 * hangs on. */
const SATURDAY_15 = Date.parse('2026-09-05T15:00:00+02:00');

/**
 * Off, for the price assertions below.
 *
 * `formatPrice` joins with U+00A0 so «1 078 kr» cannot wrap mid-value, and
 * Testing Library's default normalizer collapses whitespace — `\s` in
 * JavaScript includes the non-breaking space — so it would accept a card that
 * had let the amount break away from its unit, and would equally accept an
 * assertion written with an ordinary space against correct code.
 */
const exactly = (text: string) => text;

/**
 * Every «539 kr» in a piece of the card, as a number to be added up.
 *
 * The thousands separator is a non-breaking space too, so «1 078 kr» has to be
 * unpicked before it is arithmetic rather than text.
 */
function kroner(text: string): number[] {
  return [...text.matchAll(/(\d[\d\u00A0]*)\u00A0kr/g)].map((match) =>
    Number(match[1].replace(/\u00A0/g, ''))
  );
}

/**
 * What this site calls itself, read from the same accessor the sitemap and the
 * JSON-LD are built from rather than restated here — a second opinion in the
 * test is how the card and the sitemap end up naming two different sites.
 *
 * `https://test.example.com` under this suite, which is deliberately not
 * jsdom's own `location.origin`: a component that reached for the tab it is in
 * would not produce this string.
 */
const SITE = BASE_URL;

const JONAS: WizardItem = { service: GUTTEKLIPP, bookedForName: 'Jonas' };
const EMMA: WizardItem = { service: JENTEKLIPP, bookedForName: 'Emma' };

/** One card line, with the three answers the machine cannot supply on its own —
 * which booking this child's appointment is, who is taking it, and where it is
 * managed. */
function line(
  item: WizardItem,
  {
    bookingId = 'bk_1',
    stylistName = 'Sara',
    manageHref = null,
  }: Partial<Omit<ConfirmationLine, 'item'>> = {}
): ConfirmationLine {
  return { item, bookingId, stylistName, manageHref };
}

/** «i dag» beats «torsdag», and which one the card says depends on when the
 * suite runs rather than on anything the component decides. */
function pinToday(ts: number) {
  vi.spyOn(Date, 'now').mockReturnValue(ts);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function renderConfirmation(props: Partial<Parameters<typeof Confirmation>[0]> = {}) {
  return render(<Confirmation lines={[line(JONAS)]} startTs={THURSDAY_15} {...props} />);
}

/** The calendar file behind «Legg til i kalender», as the browser would decode
 * it. Reading it back is the only way to know the link is not an empty promise. */
function calendarFile(): string {
  const href = screen.getByRole('link', { name: 'Legg til i kalender' }).getAttribute('href') ?? '';
  return decodeURIComponent(href.replace(/^data:text\/calendar;charset=utf-8,/, ''));
}

/**
 * The same file with RFC 5545's line folding undone, which is the first thing a
 * calendar client does before it reads a property.
 *
 * A DESCRIPTION carrying two manage links is well past 75 octets, so on the
 * wire it arrives broken across continuation lines — asserting against the
 * folded bytes would be asserting against the transport rather than against
 * what the parent ends up reading.
 */
function calendarText(): string {
  return calendarFile().replace(/\r\n /g, '');
}

/**
 * The VEVENTs in the file, each as its own list of content lines.
 *
 * A family's file holds one per child, and the whole point of the split is that
 * a property belongs to ONE of them: asserting `ics.toContain('UID:bk_emma')`
 * over the flat text would pass just as happily if both ids sat in the same
 * event.
 */
function calendarEvents(): string[][] {
  const events: string[][] = [];
  let current: string[] | null = null;
  for (const line of calendarText().split('\r\n')) {
    if (line === 'BEGIN:VEVENT') current = [];
    else if (line === 'END:VEVENT') {
      if (current !== null) events.push(current);
      current = null;
    } else current?.push(line);
  }
  return events;
}

describe('Confirmation', () => {
  it('says the thing the parent came to hear', () => {
    pinToday(THURSDAY_15);
    renderConfirmation();
    expect(screen.getByRole('heading', { name: 'Timen er bekreftet! 🎉' })).toBeInTheDocument();
  });

  it('reads the booking back on the salon’s clock, not the viewer’s', () => {
    pinToday(THURSDAY_15);
    renderConfirmation();
    // 15:00 in Oslo is 03:00 the next morning in Kiritimati, which is where
    // this suite's `Date` is standing.
    expect(
      screen.getByText('Gutteklipp for Jonas · Sara · i dag kl. 15:00 · 490 kr')
    ).toBeInTheDocument();
  });

  it('cleans a stylist name it was handed raw — a restored card carries the stored one', () => {
    pinToday(THURSDAY_15);
    renderConfirmation({
      lines: [
        line(JONAS, { stylistName: 'marcus (Salong Demo)' }),
        line(EMMA, { stylistName: 'tor' }),
      ],
      partyMode: 'parallel',
    });
    expect(screen.getByText('15:00 Jonas – Gutteklipp hos Marcus – 490 kr')).toBeInTheDocument();
    expect(screen.getByText('15:00 Emma – Jenteklipp hos Tor – 490 kr')).toBeInTheDocument();
  });

  it('leaves out the parts of the line it was not told', () => {
    pinToday(THURSDAY_15);
    // No stylist name and no child's name: «Første ledige», and a parent who
    // skipped the optional question. A card reading «· · » would say the salon
    // lost half the booking.
    renderConfirmation({ lines: [line({ service: GUTTEKLIPP }, { stylistName: null })] });
    expect(screen.getByText('Gutteklipp · i dag kl. 15:00 · 490 kr')).toBeInTheDocument();
  });

  /**
   * The report's J2 card. Two children, one trip, one price — and the second
   * line starts when the first finishes, because that is what «rett etter
   * hverandre» means and what the parent has to plan around.
   */
  it('lays a family out line by line, in the order they sit down', () => {
    pinToday(THURSDAY_15);
    renderConfirmation({ lines: [line(JONAS), line(EMMA)] });

    expect(screen.getByText('Familiebesøk · i dag')).toBeInTheDocument();
    expect(screen.getByText('15:00 Jonas – Gutteklipp hos Sara – 490 kr')).toBeInTheDocument();
    expect(screen.getByText('15:30 Emma – Jenteklipp hos Sara – 490 kr')).toBeInTheDocument();
    expect(screen.getByText('Totalt 980 kr · betales i salongen')).toBeInTheDocument();
  });

  /**
   * The same family on a Saturday, where the card has to add up.
   *
   * The total carries the weekend surcharge because `totalPriceOre` does, so a
   * line printing the catalogue's base price left the parent reading «490 kr +
   * 490 kr = 1 078 kr» on the last screen before they turn up and pay — and
   * misstating what each child's appointment costs, which is the part they will
   * check against the till.
   */
  it('charges the weekend on every line of a family card, not only on the total', () => {
    pinToday(SATURDAY_15);
    renderConfirmation({ lines: [line(JONAS), line(EMMA)], startTs: SATURDAY_15 });

    // 490 kr + 10 % = 539 kr, per child, on both lines.
    expect(
      screen.getByText('15:00 Jonas – Gutteklipp hos Sara – 539\u00A0kr', { normalizer: exactly })
    ).toBeInTheDocument();
    expect(
      screen.getByText('15:30 Emma – Jenteklipp hos Sara – 539\u00A0kr', { normalizer: exactly })
    ).toBeInTheDocument();

    const totalLine = screen.getByText('Totalt 1\u00A0078\u00A0kr · betales i salongen', {
      normalizer: exactly,
    });

    // And the arithmetic itself rather than three strings that happen to be
    // right today: what the lines come to is what the card asks for.
    const perLine = screen.getAllByRole('listitem').flatMap((row) => kroner(row.textContent ?? ''));
    expect(perLine).toEqual([539, 539]);
    expect(perLine.reduce((sum, amount) => sum + amount, 0)).toBe(
      kroner(totalLine.textContent ?? '')[0]
    );
  });

  /**
   * The parallel half of J2, and the one the single `stylistName` cannot say: a
   * family the salon split between two chairs has a different stylist per
   * child, by construction. Printing either of them against both lines would
   * send a parent looking for Emma at Marcus's chair.
   */
  it('names the right stylist on each line when the family was split in two', () => {
    pinToday(THURSDAY_15);
    renderConfirmation({
      lines: [line(JONAS, { stylistName: 'Marcus' }), line(EMMA, { stylistName: 'Sara' })],
      partyMode: 'parallel',
    });

    // Both at 15:00 — that is what «samtidig» means, and it is `itemStartTimes`
    // saying so rather than this card.
    expect(screen.getByText('15:00 Jonas – Gutteklipp hos Marcus – 490 kr')).toBeInTheDocument();
    expect(screen.getByText('15:00 Emma – Jenteklipp hos Sara – 490 kr')).toBeInTheDocument();
  });

  it('offers a calendar entry the calendar can actually open', () => {
    pinToday(THURSDAY_15);
    renderConfirmation();

    const link = screen.getByRole('link', { name: 'Legg til i kalender' });
    // Without `download`, Chrome and Firefox both refuse a top-level navigation
    // to a `data:` URL and the link does nothing at all.
    expect(link).toHaveAttribute('download', expect.stringContaining('.ics'));
    expect(link.getAttribute('href')).toMatch(/^data:text\/calendar;charset=utf-8,/);

    const ics = calendarFile();
    // The whole line, not a substring of it: the UID is what a reschedule reuses
    // to move this entry rather than add a second one, so a UID that merely
    // *starts* with the booking id is a different appointment.
    expect(ics.split('\r\n')).toContain('UID:bk_1');
    expect(calendarEvents()).toHaveLength(1);
    expect(ics).toContain('SUMMARY:Gutteklipp for Jonas hos Salong Demo');
    expect(ics).toContain('DTSTART:20260903T130000Z');
    expect(ics).toContain('DTEND:20260903T133000Z');
  });

  /**
   * A family gets one calendar entry per child, each keyed to that child's own
   * booking id.
   *
   * This used to be a single event spanning the whole visit, keyed to the FIRST
   * child's booking — and per-child management cannot survive that. The manage
   * page emits its calendar REQUEST under the id of the booking it manages, so
   * moving Emma produced a second entry alongside the family one, and moving
   * Jonas replaced the family entry with a single-child one. Per-child events
   * are also what the parent's calendar should say: «Bare Jonas» on the manage
   * page moves exactly one of them, and the others keep their times.
   *
   * Between them the two entries still cover 15:00–16:00, so nothing tells the
   * parent they are free while a child is in the chair.
   */
  it('gives each child in the family a calendar entry keyed to their own booking', () => {
    pinToday(THURSDAY_15);
    renderConfirmation({
      lines: [
        line(JONAS, { bookingId: 'bk_jonas' }),
        line(EMMA, { bookingId: 'bk_emma', stylistName: 'Marcus' }),
      ],
    });

    const [jonas, emma] = calendarEvents();
    expect(calendarEvents()).toHaveLength(2);

    expect(jonas).toContain('UID:bk_jonas');
    expect(jonas).toContain('SUMMARY:Gutteklipp for Jonas hos Salong Demo');
    expect(jonas).toContain('DTSTART:20260903T130000Z');
    expect(jonas).toContain('DTEND:20260903T133000Z');

    expect(emma).toContain('UID:bk_emma');
    expect(emma).toContain('SUMMARY:Jenteklipp for Emma hos Salong Demo');
    // 15:30, because «rett etter hverandre» is what the card just drew.
    expect(emma).toContain('DTSTART:20260903T133000Z');
    expect(emma).toContain('DTEND:20260903T140000Z');
  });

  it('puts the salon’s address in both places it belongs', () => {
    pinToday(THURSDAY_15);
    renderConfirmation({ address: 'Torget 1, 0001 Oslo' });

    expect(screen.getByText('Torget 1, 0001 Oslo')).toBeInTheDocument();
    // `,` is one of the format's own separators, so an unescaped address ends
    // the property early and the calendar entry has no location at all.
    expect(calendarFile()).toContain('LOCATION:Torget 1\\, 0001 Oslo');
  });

  it('does not draw an address it has not been given', () => {
    pinToday(THURSDAY_15);
    renderConfirmation({ address: null });
    expect(calendarFile()).not.toContain('LOCATION');
  });

  it('offers «Endre eller avbestill» only when there is somewhere to send them', () => {
    pinToday(THURSDAY_15);
    const { unmount } = renderConfirmation({
      lines: [line(JONAS, { manageHref: '/bestill/administrer/mt_test_1' })],
    });
    expect(screen.getByRole('link', { name: 'Endre eller avbestill' })).toHaveAttribute(
      'href',
      '/bestill/administrer/mt_test_1'
    );
    unmount();

    // A link to a page that 404s is worse than no link on the one screen that
    // has to feel finished.
    renderConfirmation();
    expect(screen.queryByRole('link', { name: 'Endre eller avbestill' })).toBeNull();
  });

  /**
   * Each child is its own booking with its own manage token, so each line needs
   * its own way in.
   *
   * One link for the visit could only ever reach the first child — and the
   * plaintext token is returned exactly once, so the second one would be gone
   * for good. E-mail is optional on step 4, which is what makes that permanent
   * rather than merely inconvenient: a parent who gave no address has no other
   * copy of it anywhere.
   */
  it('gives every child in the family its own way back into its own booking', () => {
    pinToday(THURSDAY_15);
    renderConfirmation({
      lines: [
        line(JONAS, { bookingId: 'bk_jonas', manageHref: '/bestill/administrer/mt_jonas' }),
        line(EMMA, { bookingId: 'bk_emma', manageHref: '/bestill/administrer/mt_emma' }),
      ],
    });

    // Named per child, because three identical «Endre eller avbestill» links
    // under a three-line card tell a screen reader nothing about which is which.
    expect(
      screen.getByRole('link', { name: 'Endre eller avbestill Jonas kl. 15:00' })
    ).toHaveAttribute('href', '/bestill/administrer/mt_jonas');
    expect(
      screen.getByRole('link', { name: 'Endre eller avbestill Emma kl. 15:30' })
    ).toHaveAttribute('href', '/bestill/administrer/mt_emma');

    // And all of them in the calendar file too: it is the only durable copy of
    // the credential when no e-mail was given — and each one sits in its OWN
    // event, so the entry a parent opens in six weeks carries the link that
    // moves the child it is about.
    // Read exactly: `formatPrice` joins the amount to «kr» with U+00A0 so it
    // cannot wrap, and a plain space here would pass against a card that let it.
    const [jonas, emma] = calendarEvents();
    expect(jonas).toContain(
      `DESCRIPTION:490\u00A0kr · betales i salongen\\nEndre eller avbestill: ${SITE}/bestill/administrer/mt_jonas`
    );
    expect(emma).toContain(
      `DESCRIPTION:490\u00A0kr · betales i salongen\\nEndre eller avbestill: ${SITE}/bestill/administrer/mt_emma`
    );
  });

  /**
   * The .ics is opened weeks later by an application that has no page to
   * resolve a root-relative path against, so a bare `/bestill/administrer/…` in
   * the DESCRIPTION is a dead link — in exactly the place someone looks when
   * they finally need to move the appointment.
   *
   * The on-screen `<a>` stays relative, which is what an anchor on this page
   * should be. Only the file leaves the browser.
   */
  it('writes a link the calendar can follow, and leaves the one on screen relative', () => {
    pinToday(THURSDAY_15);
    renderConfirmation({ lines: [line(JONAS, { manageHref: '/bestill/administrer/mt_test_1' })] });

    expect(screen.getByRole('link', { name: 'Endre eller avbestill' })).toHaveAttribute(
      'href',
      '/bestill/administrer/mt_test_1'
    );

    const written = calendarText().match(/Endre eller avbestill: (\S+)/)?.[1] ?? '';
    expect(written).toBe(`${SITE}/bestill/administrer/mt_test_1`);
    // The single-argument `URL` constructor is what a calendar application has:
    // no page, no base, nothing to resolve a bare path against. It throws on
    // the relative form, which is the bug stated as an assertion.
    expect(new URL(written).pathname).toBe('/bestill/administrer/mt_test_1');
  });

  it('does not lend one child’s manage link to a sibling the response had none for', () => {
    pinToday(THURSDAY_15);
    // The shape a short upstream answer produces. A line that fell back to the
    // first child's href would hand a parent a live credential for the wrong
    // appointment — «Endre» on Emma's line would cancel Jonas's haircut.
    renderConfirmation({
      lines: [line(JONAS, { manageHref: '/bestill/administrer/mt_jonas' }), line(EMMA)],
    });

    expect(screen.getAllByRole('link', { name: /Endre eller avbestill/ })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Endre eller avbestill Emma kl. 15:30' })).toBeNull();
  });

  /**
   * Min side lists every booking under the parent's own login, so it is ONE
   * link for the visit — not one per child like the manage links — and it is
   * drawn whether or not the response carried a manage token, because the
   * portal is reached by logging in, not by holding a credential from here.
   */
  it('offers one link to Min side, root-relative, for a single child and for a family', () => {
    pinToday(THURSDAY_15);
    const { unmount } = renderConfirmation({
      lines: [line(JONAS, { manageHref: '/bestill/administrer/mt_test_1' })],
    });
    expect(screen.getByRole('link', { name: 'Se alle timene dine på Min side' })).toHaveAttribute(
      'href',
      '/min-side'
    );
    unmount();

    const family = renderConfirmation({
      lines: [
        line(JONAS, { bookingId: 'bk_jonas', manageHref: '/bestill/administrer/mt_jonas' }),
        line(EMMA, { bookingId: 'bk_emma', manageHref: '/bestill/administrer/mt_emma' }),
      ],
    });
    const links = screen.getAllByRole('link', { name: 'Se alle timene dine på Min side' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/min-side');
    family.unmount();

    // No manage token at all is still a booking the parent can find on Min side.
    renderConfirmation();
    expect(screen.getByRole('link', { name: 'Se alle timene dine på Min side' })).toHaveAttribute(
      'href',
      '/min-side'
    );
  });
});
