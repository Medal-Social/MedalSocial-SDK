/**
 * `/core` runs in a browser, Node or a Worker, so it may import nothing that
 * ties it to one: no React, no Next, no `server-only`, no meda. The only
 * packages it reads are zod (a peer) and the SDK's TYPES, which are erased.
 *
 * Two checks: every import specifier under src/core is relative or on the
 * allowlist, and the whole entry imports in this Node project — no DOM, no
 * `window` — with every export defined. (`verify:paths` repeats the second
 * against the built `dist/core` in a bare `node` process.)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = join(__dirname, '../../src/core');
const ALLOWED_PACKAGES = new Set(['zod', '@medalsocial/sdk']);
const TYPE_ONLY_PACKAGES = new Set(['@medalsocial/sdk']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : []
  );
}

/** Every `import … from '…'`, `export … from '…'` and bare `import '…'`, with whether it is type-only. */
function importsOf(source: string): Array<{ specifier: string; typeOnly: boolean }> {
  const found: Array<{ specifier: string; typeOnly: boolean }> = [];
  const statement = /^(import|export)(\s+type)?[\s\S]*?from\s+'([^']+)';|^import\s+'([^']+)';/gm;
  for (const match of source.matchAll(statement)) {
    found.push({ specifier: match[3] ?? match[4], typeOnly: match[2] !== undefined });
  }
  return found;
}

describe('the /core boundary', () => {
  const files = sources(CORE);

  it('finds the sources it is guarding', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((file) => [relative(CORE, file), file]))(
    '%s imports only relative modules, zod and SDK types',
    (_, file) => {
      for (const { specifier, typeOnly } of importsOf(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.')) continue;
        expect(ALLOWED_PACKAGES, `${specifier} is not allowed in /core`).toContain(specifier);
        if (TYPE_ONLY_PACKAGES.has(specifier)) {
          expect(typeOnly, `${specifier} must be an \`import type\` in /core`).toBe(true);
        }
      }
    }
  );

  it('catches what it is meant to catch', () => {
    expect(importsOf("import { useState } from 'react';\nimport 'server-only';")).toEqual([
      { specifier: 'react', typeOnly: false },
      { specifier: 'server-only', typeOnly: false },
    ]);
    expect(importsOf("import type {\n  A,\n} from '@medalsocial/sdk';")).toEqual([
      { specifier: '@medalsocial/sdk', typeOnly: true },
    ]);
  });

  it('imports without a DOM, and every export is defined', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    const core = await import('../../src/core/index');
    const exported = Object.entries(core);
    expect(exported.length).toBeGreaterThan(50);
    for (const [name, value] of exported) expect(value, name).toBeDefined();
    expect(typeof core.resolveBookingConfig).toBe('function');
    expect(typeof core.createWizard).toBe('function');
  });
});
