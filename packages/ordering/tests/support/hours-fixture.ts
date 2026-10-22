import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One call to the hours engine and what the Medal API's own engine answered. */
export interface HoursFixtureCase {
  name: string;
  fn: string;
  args: unknown[];
  result: unknown;
}

interface HoursFixture {
  defaultTimeZone: string;
  inputs: unknown[];
  cases: HoursFixtureCase[];
}

/** `{ "$number": "NaN" }` back to NaN (JSON has no NaN or ±Infinity). */
function revive(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '$number' in value) {
    return Number((value as { $number: string }).$number);
  }
  return value;
}

/**
 * tests/fixtures/hours.json (written by scripts/export-hours-fixtures.mjs),
 * with each case's shared inputs put back in place and `null` back to
 * `undefined`.
 */
export function loadHoursFixture(): { defaultTimeZone: string; cases: HoursFixtureCase[] } {
  const raw: HoursFixture = JSON.parse(
    readFileSync(join(__dirname, '../fixtures/hours.json'), 'utf8'),
    revive
  );
  const cases = raw.cases.map((c) => ({
    ...c,
    args: c.args.map((arg) => {
      if (arg === null) return undefined;
      if (typeof arg === 'object' && '$input' in arg) {
        return structuredClone(raw.inputs[(arg as { $input: number }).$input]);
      }
      return arg;
    }),
  }));
  return { defaultTimeZone: raw.defaultTimeZone, cases };
}
