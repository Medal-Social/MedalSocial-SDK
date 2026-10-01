import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { defineConfig } from 'tsdown';

/**
 * ESM only, one output module per source module (`unbundle`), so a consumer's
 * bundler keeps only the modules a page reaches and `sideEffects: false`
 * lets it drop the rest.
 *
 * `/react`, `/react/wizard` and `/react/link` are client entries. After the build every
 * module under dist/react/ starts with the `'use client'` directive, except
 * the server-safe graph of `/react/shared` (the label packs and the portal's
 * parsers, which a Server Component calls). A banner in the shared config
 * would also land on `/core` and `/next`, so the directive is prepended
 * afterwards, with its source map shifted by the one line. `/next` imports
 * `server-only` itself, so a client component that reaches for it fails the
 * consumer's build instead of shipping server code.
 *
 * Entry keys pin the paths under dist/ that package.json's `exports` name;
 * `verify:paths` checks every one of them exists after a build, and that the
 * directive sits on exactly the modules described above.
 */
const SERVER_SAFE_ENTRY = 'react/shared.mjs';

/** Every relative `import`/`export … from` specifier in a built module. */
function relativeSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:^|[;\s])(?:import|export)\s*(?:[^'"]*?from\s*)?["'](\.[^"']+)["']/g),
  ].map((match) => match[1] as string);
}

/** The built modules `entry` reaches through relative imports, itself included. */
async function graphOf(entry: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    for (const specifier of relativeSpecifiers(source))
      queue.push(resolve(dirname(file), specifier));
  }
  return seen;
}

async function markClientModules(outDir: string) {
  const reactDir = join(outDir, 'react');
  const serverSafe = await graphOf(join(outDir, SERVER_SAFE_ENTRY));
  const modules = (await readdir(reactDir, { recursive: true }))
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => join(reactDir, file))
    .filter((file) => !serverSafe.has(file));
  await Promise.all(
    modules.map(async (path) => {
      const source = await readFile(path, 'utf8');
      if (source.startsWith("'use client'")) return;
      await writeFile(path, `'use client';\n${source}`);
      // A pure re-export barrel has no map to shift.
      const mapPath = `${path}.map`;
      if (!existsSync(mapPath)) return;
      const map = JSON.parse(await readFile(mapPath, 'utf8')) as { mappings: string };
      map.mappings = `;${map.mappings}`;
      await writeFile(mapPath, JSON.stringify(map));
    })
  );
  console.log(
    `[tsdown] 'use client' on ${modules.length} modules under ${relative(outDir, reactDir)}/`
  );
}

export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'react/index': 'src/react/index.ts',
    // The booking page's own client entry: the wizard without manage or portal.
    'react/wizard/index': 'src/react/wizard/index.ts',
    // What a root layout mounts (booking links, the pending host): no wizard.
    'react/link/index': 'src/react/link/index.ts',
    // Server-safe (no 'use client'): the label packs and the portal's parsers.
    'react/shared': 'src/react/shared.ts',
    'next/index': 'src/next/index.ts',
    'next/cache/workers': 'src/next/cache/workers.ts',
    'next/cache/memory': 'src/next/cache/memory.ts',
    'next/cache/next-data': 'src/next/cache/next-data.ts',
    'next/cache/noop': 'src/next/cache/noop.ts',
  },
  unbundle: true,
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
    'build:done': ({ options }) => markClientModules(options.outDir),
  },
});
