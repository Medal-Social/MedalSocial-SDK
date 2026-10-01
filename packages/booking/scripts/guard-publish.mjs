#!/usr/bin/env node
// `prepublishOnly` guard: @medalsocial/booking is published by the release
// workflow and nothing else.
//
// npm is immutable — a version that goes out cannot be taken back — so a
// publish from a laptop, from a fork's CI, from another workflow or branch, or
// of the unversioned `0.0.0` manifest (a changeset dropped instead of
// released) fails here, before anything reaches the registry. The release
// workflow (`.github/workflows/release.yml`, run on `prod`) is the one place
// that has the npm environment, provenance (OIDC) and the version PR behind
// it; `publishConfig.provenance` makes a publish without OIDC fail on npm's
// side too.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compared exactly: a branch name is case-sensitive, and `PROD` is not `prod`.
const RELEASE_WORKFLOW =
  'Medal-Social/MedalSocial-SDK/.github/workflows/release.yml@refs/heads/prod';

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const { name, version } = JSON.parse(readFileSync(pkgPath, 'utf8'));

/** @type {string[]} */
const problems = [];

if (version === '0.0.0') {
  problems.push(
    `${name}@0.0.0 is the unversioned manifest; publish only a version the release PR set.`
  );
}
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_WORKFLOW_REF !== RELEASE_WORKFLOW) {
  problems.push(
    `${name} publishes only from ${RELEASE_WORKFLOW} (got ${process.env.GITHUB_WORKFLOW_REF ?? 'no workflow'}).`
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`guard-publish: ${problem}`);
  process.exit(1);
}
console.log(`guard-publish: ${name}@${version} from the release workflow`);
