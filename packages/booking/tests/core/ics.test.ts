import { describe, expect, it } from 'vitest';
import { createIcs, type IcsEvent } from '../../src/core/ics';
import { PARITY_CONFIG } from '../support/parity-config';
import { pinAForeignViewerClock } from '../support/viewer-clock';

const { buildIcs } = createIcs(PARITY_CONFIG);

/**
 * `DTSTART` is stamped in UTC, and an implementation that reached for `Date`'s
 * local getters would agree with a correct one on every machine in Oslo. The
 * viewer sits twelve hours away here, so the two answers differ.
 */
pinAForeignViewerClock();

/** 15:00 Oslo on Thursday 3 September 2026 — 13:00 UTC, inside CEST. */
const THURSDAY_15 = Date.parse('2026-09-03T15:00:00+02:00');
const THURSDAY_16 = Date.parse('2026-09-03T16:00:00+02:00');

/** A fixed `DTSTAMP`, so the assertions are about the format and not the hour
 * the suite happened to run. */
const STAMPED_AT = Date.parse('2026-08-29T09:30:00Z');

function anEvent(overrides: Partial<IcsEvent> = {}) {
  return buildIcs({
    uid: 'bk_1',
    startTs: THURSDAY_15,
    endTs: THURSDAY_16,
    summary: 'Gutteklipp',
    stampTs: STAMPED_AT,
    ...overrides,
  });
}

/** The lines as a calendar client would read them, folding undone. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('buildIcs', () => {
  it('emits METHOD:REQUEST on a reschedule so calendars update in place', () => {
    const ics = buildIcs({
      uid: 'b1',
      startTs: 0,
      endTs: 1,
      summary: 'Gutteklipp',
      method: 'REQUEST',
    });
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('UID:b1');
  });

  /**
   * The other half of that promise, and the half a calendar actually enforces.
   * A second REQUEST carrying the same UID and the same SEQUENCE is a replay,
   * not a revision — Outlook and Google both keep the appointment they already
   * have — so the reschedule has to say it is newer or the METHOD buys nothing.
   */
  it('carries a SEQUENCE, so a revision can outrank the invite it replaces', () => {
    expect(unfold(anEvent())).toContain('SEQUENCE:0');
    expect(unfold(anEvent({ method: 'REQUEST', sequence: 1 }))).toContain('SEQUENCE:1');
  });

  /**
   * PUBLISH is «here is an appointment, add it». REQUEST is «I am the organiser
   * and I am asking you to attend», which some clients answer with an
   * accept/decline prompt and a reply mail. The confirmation screen's «Legg til
   * i kalender» is the former, so the default has to be too.
   */
  it('defaults to PUBLISH rather than claiming to be an invitation', () => {
    expect(unfold(anEvent())).toContain('METHOD:PUBLISH');
  });

  it('stamps the times in UTC, whatever clock the visitor is reading on', () => {
    const lines = unfold(anEvent());
    // 15:00 in Oslo is 13:00 UTC in September. A component that formatted with
    // `getHours()` would write 03:00 here — the viewer's clock, in Kiritimati.
    expect(lines).toContain('DTSTART:20260903T130000Z');
    expect(lines).toContain('DTEND:20260903T140000Z');
    expect(lines).toContain('DTSTAMP:20260829T093000Z');
  });

  it('separates every line with CRLF, which is the only separator RFC 5545 has', () => {
    const ics = anEvent();
    // A bare LF anywhere: some clients treat the whole file as one unparseable
    // line and silently import nothing.
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('folds long lines at 75 octets without losing a character', () => {
    const summary =
      'Gutteklipp for Jonas og Emma hos Sara i Salong Demo barnefrisor på Torgallmenningen';
    const ics = anEvent({ summary });

    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // Folding is only legal if unfolding is lossless — a fold that dropped or
    // duplicated the boundary character would still satisfy the length check.
    expect(unfold(ics)).toContain(`SUMMARY:${summary}`);
  });

  /**
   * The trap in "75 octets": Norwegian is not ASCII. `ø` is two octets, so a
   * fold measured in characters overruns the limit, and a fold that cuts at
   * octet 75 regardless lands between the two halves of one letter and the
   * client decodes `�`.
   */
  it('never folds through the middle of a Norwegian letter', () => {
    const summary = `Fødselsdagsklipp ${'ø'.repeat(80)}`;
    const ics = anEvent({ summary });

    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).not.toContain('�');
    expect(unfold(ics)).toContain(`SUMMARY:${summary}`);
  });

  /**
   * `;` and `,` are the field separators of the format itself, so a note the
   * parent typed can end an ICS property early and put the rest of their
   * sentence where a parameter belongs.
   */
  it('escapes the characters that would otherwise end a property early', () => {
    const lines = unfold(
      anEvent({ description: 'Redd for saks; helst maskin, sier mamma\nTa det rolig' })
    );
    expect(lines).toContain(
      'DESCRIPTION:Redd for saks\\; helst maskin\\, sier mamma\\nTa det rolig'
    );
  });

  it('leaves out what it was not given, rather than writing an empty property', () => {
    const lines = unfold(anEvent());
    // `LOCATION:` with nothing after it renders as a blank address line in the
    // calendar entry, which reads as a salon that lost its address.
    expect(lines.some((line) => line.startsWith('LOCATION'))).toBe(false);
    expect(lines.some((line) => line.startsWith('DESCRIPTION'))).toBe(false);
  });

  /**
   * A family visit is several appointments, each of which is managed and moved
   * on its own — so the file has to carry one VEVENT per child rather than one
   * for the visit. See `Confirmation`.
   */
  it('writes several events into one calendar, each with its own identity', () => {
    const lines = unfold(
      buildIcs([
        { uid: 'bk_jonas', startTs: THURSDAY_15, endTs: THURSDAY_16, summary: 'Jonas' },
        { uid: 'bk_emma', startTs: THURSDAY_16, endTs: THURSDAY_16, summary: 'Emma' },
      ])
    );

    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(2);
    expect(lines).toContain('UID:bk_jonas');
    expect(lines).toContain('UID:bk_emma');
    // One calendar, so exactly one wrapper — a second BEGIN:VCALENDAR is a
    // second file glued to the end of the first, which strict parsers refuse.
    expect(lines.filter((line) => line === 'BEGIN:VCALENDAR')).toHaveLength(1);
    // METHOD belongs to the VCALENDAR rather than to an event, and there is one.
    expect(lines.filter((line) => line.startsWith('METHOD:'))).toEqual(['METHOD:PUBLISH']);
  });
});
