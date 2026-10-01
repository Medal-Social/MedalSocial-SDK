import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * `scripts/guard-publish.mjs` — the `prepublishOnly` guard. npm is immutable,
 * so the package publishes from the release workflow on `prod` and nothing
 * else, and never as the unversioned `0.0.0` manifest.
 */

const SCRIPT = join(__dirname, '../../scripts/guard-publish.mjs');
const RELEASE = 'Medal-Social/MedalSocial-SDK/.github/workflows/release.yml@refs/heads/prod';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The guard against a copy of the package with `version`, under `env`. */
function guard(version: string, env: Record<string, string | undefined>) {
  const dir = mkdtempSync(join(tmpdir(), 'booking-guard-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'scripts'));
  cpSync(SCRIPT, join(dir, 'scripts/guard-publish.mjs'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@medalsocial/booking', version })
  );
  const { GITHUB_ACTIONS: _a, GITHUB_WORKFLOW_REF: _r, ...rest } = process.env;
  return spawnSync(process.execPath, [join(dir, 'scripts/guard-publish.mjs')], {
    env: { ...rest, ...env },
    encoding: 'utf8',
  });
}

describe('guard-publish', () => {
  it('lets the release workflow on prod publish a released version', () => {
    const run = guard('0.1.0', { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW_REF: RELEASE });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('@medalsocial/booking@0.1.0 from the release workflow');
  });

  it.each([
    ['a laptop', {}],
    [
      'another workflow',
      { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW_REF: RELEASE.replace('release', 'ci') },
    ],
    [
      'another branch',
      { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW_REF: RELEASE.replace('prod', 'dev') },
    ],
    [
      'a fork',
      { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW_REF: RELEASE.replace('Medal-Social', 'someone') },
    ],
    ['a workflow ref without GitHub Actions', { GITHUB_WORKFLOW_REF: RELEASE }],
  ])('refuses a publish from %s', (_label, env) => {
    const run = guard('0.1.0', env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('publishes only from');
  });

  it('refuses the unversioned 0.0.0 manifest, even from the release workflow', () => {
    const run = guard('0.0.0', { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW_REF: RELEASE });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('0.0.0 is the unversioned manifest');
  });

  it('is what the package runs before every publish, and asks npm for provenance', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    expect(pkg.scripts.prepublishOnly).toMatch(/^node scripts\/guard-publish\.mjs && /);
    expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
  });
});
