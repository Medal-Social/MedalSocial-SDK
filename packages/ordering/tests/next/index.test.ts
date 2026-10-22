import { describe, expect, it } from 'vitest';

/** The reserved `/next` entry: it imports, exports nothing yet, and is server-only. */
describe('reserved entries', () => {
  it('/next imports server-only and exports nothing yet', async () => {
    const next = await import('../../src/next/index');
    expect(Object.keys(next)).toEqual([]);
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(`${__dirname}/../../src/next/index.ts`, 'utf8');
    expect(source).toContain("import 'server-only';");
  });
});
