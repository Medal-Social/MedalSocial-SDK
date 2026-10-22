/**
 * The package's hours engine answers exactly as the Medal API's own engine.
 *
 * tests/fixtures/hours.json holds a table of calls and the API engine's
 * answers, written by `scripts/export-hours-fixtures.mjs --engine <the API's
 * hours.ts>`. Every case runs here against `src/core/hours.ts`.
 */
import { describe, expect, it } from 'vitest';
import * as engine from '../../src/core/hours';
import { loadHoursFixture } from '../support/hours-fixture';

const fixture = loadHoursFixture();
const functions = engine as unknown as Record<string, (...args: unknown[]) => unknown>;

describe('hours engine parity with the Medal API', () => {
  it('has the same default time zone', () => {
    expect(engine.DEFAULT_TIME_ZONE).toBe(fixture.defaultTimeZone);
  });

  it('covers every function the engine exports', () => {
    const exported = Object.entries(engine)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect([...new Set(fixture.cases.map((c) => c.fn))].sort()).toEqual(exported);
  });

  it.each(fixture.cases.map((c, i) => [`${i} ${c.fn}: ${c.name}`, c] as const))(
    '%s',
    (_label, c) => {
      expect(functions[c.fn](...c.args)).toStrictEqual(c.result);
    }
  );
});
