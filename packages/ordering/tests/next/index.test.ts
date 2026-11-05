import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('/next entry', () => {
  it('exports the route factories and is server-only', async () => {
    const next = await import('../../src/next/index');
    expect(Object.keys(next).sort()).toEqual([
      'DEFAULT_REVALIDATE_SECONDS',
      'createAddressResolveRoute',
      'createAddressSuggestRoute',
      'createDeliveryQuoteRoute',
      'createLocationsRoute',
      'createMenuRoute',
      'createOrderRoute',
      'createOrderStatusRoute',
      'createPlaceOrderRoute',
      'createSlotsRoute',
      'createTableRoute',
      'createVippsReturnRoute',
    ]);
    expect(next.DEFAULT_REVALIDATE_SECONDS).toBe(60);
    const source = readFileSync(`${__dirname}/../../src/next/index.ts`, 'utf8');
    expect(source).toContain("import 'server-only';");
  });

  it('imports nothing from Next at runtime', () => {
    const files = readdirSync(`${__dirname}/../../src/next`);
    expect(files).toEqual(expect.arrayContaining(['index.ts', 'menu-route.ts', 'shared.ts']));
    for (const file of files) {
      const source = readFileSync(`${__dirname}/../../src/next/${file}`, 'utf8');
      expect(source).not.toMatch(/from ['"]next(\/|['"])/);
    }
  });
});
