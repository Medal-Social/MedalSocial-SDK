import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'tsdown';

/**
 * ESM only. `/react` is a client entry, so its output starts with the
 * `'use client'` directive (prepended after the build: a banner in a shared
 * config would also land on `/core` and `/next`). `/next` imports
 * `server-only` itself, so a client component that reaches for it fails the
 * consumer's build instead of shipping server code.
 *
 * Entry keys pin the paths under dist/ that package.json's `exports` name;
 * `verify:paths` checks every one of them exists after a build.
 */
const CLIENT_ENTRIES = ['react/index.mjs'];

async function markClientEntries(outDir: string) {
  await Promise.all(
    CLIENT_ENTRIES.map(async (file) => {
      const path = join(outDir, file);
      const source = await readFile(path, 'utf8');
      if (!source.startsWith("'use client'")) await writeFile(path, `'use client';\n${source}`);
    })
  );
}

export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'react/index': 'src/react/index.ts',
    'next/index': 'src/next/index.ts',
    'next/cache/workers': 'src/next/cache/workers.ts',
    'next/cache/memory': 'src/next/cache/memory.ts',
    'next/cache/next-data': 'src/next/cache/next-data.ts',
    'next/cache/noop': 'src/next/cache/noop.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: { tsconfig: 'tsconfig.build.json', sourcemap: false },
  sourcemap: true,
  outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
  exports: false,
  // Peers and dependencies stay imports; the size budget measures our code only.
  deps: { neverBundle: [/^@medalsocial\//, 'zod', 'server-only', /^react/, /^next/] },
  hooks: {
    'build:done': ({ options }) => markClientEntries(options.outDir),
  },
});
