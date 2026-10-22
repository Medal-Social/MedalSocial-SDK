import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { defineConfig } from 'tsdown';

/**
 * ESM only, one output module per source module (`unbundle`), so a consumer's
 * bundler keeps only the modules a page reaches and `sideEffects: false`
 * lets it drop the rest.
 *
 * `/react` is a client entry: after the build every module under dist/react/
 * starts with the `'use client'` directive. A banner in the shared config
 * would also land on `/core` and `/next`, so the directive is prepended
 * afterwards, with its source map shifted by the one line. `/next` imports
 * `server-only` itself, so a client component that reaches for it fails the
 * consumer's build instead of shipping server code.
 *
 * Entry keys pin the paths under dist/ that package.json's `exports` name;
 * `verify:paths` checks every one of them exists after a build, and that the
 * directive sits on every `/react` module.
 */
async function markClientModules(outDir: string) {
  const reactDir = join(outDir, 'react');
  const modules = (await readdir(reactDir, { recursive: true }))
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => join(reactDir, file));
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
    'next/index': 'src/next/index.ts',
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
  deps: { neverBundle: [/^@medalsocial\//, 'server-only', /^react/, /^next/] },
  hooks: {
    'build:done': ({ options }) => markClientModules(options.outDir),
  },
});
