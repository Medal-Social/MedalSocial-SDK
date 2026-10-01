#!/usr/bin/env node
// The declaration build resolves `@medalsocial/sdk` through its BUILT types
// (tsconfig.build.json), so the emitted .d.mts keep importing it rather than
// copying it — and so tsc never writes declarations into packages/sdk/src.
// `pnpm -r build` builds the SDK first anyway (it is a dependency); this makes
// a lone `pnpm --filter @medalsocial/booking build` on a clean checkout work too.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '../../sdk');

if (!existsSync(join(sdk, 'dist/src/index.d.mts'))) {
  console.log('[ensure-sdk-types] building @medalsocial/sdk first (its types are missing)');
  execFileSync('pnpm', ['--filter', '@medalsocial/sdk', 'run', 'build'], { stdio: 'inherit' });
}
