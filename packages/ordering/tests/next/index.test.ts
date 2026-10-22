import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('/next entry', () => {
  it('exports the menu route factory and is server-only', async () => {
    const next = await import('../../src/next/index');
    expect(Object.keys(next).sort()).toEqual(['DEFAULT_REVALIDATE_SECONDS', 'createMenuRoute']);
    expect(next.DEFAULT_REVALIDATE_SECONDS).toBe(60);
    const source = readFileSync(`${__dirname}/../../src/next/index.ts`, 'utf8');
    expect(source).toContain("import 'server-only';");
  });

  it('imports nothing from Next at runtime', () => {
    for (const file of ['index.ts', 'menu-route.ts', 'etag.ts']) {
      const source = readFileSync(`${__dirname}/../../src/next/${file}`, 'utf8');
      expect(source).not.toMatch(/from ['"]next(\/|['"])/);
    }
  });
});
