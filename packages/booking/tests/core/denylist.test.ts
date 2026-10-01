/**
 * This package is public, and it was extracted from one customer's site. No
 * customer name, staff name or place may survive into it — not in code, not
 * in a fixture, not in a comment.
 *
 * The denylist is stored as SHA-256 prefixes so that this file does not name
 * what it forbids. Every word of every file in the package, and every pair of
 * adjacent words, is hashed and checked. To add a term, append the first 16 hex
 * digits of `sha256(term.toLowerCase())`.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const SCANNED = ['src', 'tests', 'scripts', 'README.md', 'package.json'];
const DENIED = new Set([
  '810e0956ad06365b',
  '674a81f4b2d31361',
  '7381436f21db688d',
  'ef94d492bb48fd31',
  'af789dbe48fb5f21',
  'ff06535ac1029cca',
  'e96e02d8e47f2a7c',
  '64899b6de659c5a6',
  '16f711663ad1d7b2',
]);

const hash = (term: string) => createHash('sha256').update(term).digest('hex').slice(0, 16);

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

function deniedTermsIn(text: string, denied: ReadonlySet<string> = DENIED): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const terms = [...words, ...words.slice(1).map((word, index) => `${words[index]} ${word}`)];
  return terms.filter((term) => denied.has(hash(term)));
}

describe('the public-repo denylist', () => {
  it('catches a denied term on its own and as a pair, in any case', () => {
    const probe = new Set([hash('demo'), hash('salong demo')]);
    expect(deniedTermsIn('Booking at SALONG Demo today', probe)).toEqual(['demo', 'salong demo']);
    expect(deniedTermsIn('Booking at Salongen today', probe)).toEqual([]);
  });

  const scanned = SCANNED.flatMap((entry) => files(join(ROOT, entry)));

  it.each(scanned.map((file) => [relative(ROOT, file), file]))(
    '%s names no customer',
    (_, file) => {
      expect(deniedTermsIn(readFileSync(file, 'utf8'))).toEqual([]);
    }
  );
});
