import { describe, expect, it } from 'vitest';
import { createReturnPath } from '../../../src/core/portal/return-path';
import { PARITY_CONFIG } from '../../support/parity-config';

const safeReturnPath = createReturnPath(PARITY_CONFIG);

/**
 * The one function standing between a query parameter and a `redirect()`.
 *
 * Two pages now accept «send me back here» from a visitor-writable place —
 * `/min-side/logg-inn?return=` and the Vipps start action's `next` field — and
 * every value either of them ever redirects to has come through here. So the
 * interesting cases are not the happy ones: they are the strings that LOOK
 * root-relative to a `startsWith('/')` check and are not.
 */

const FLOW = '/barnehage/lille-eik';

describe('safeReturnPath', () => {
  it('accepts a path under an allowed prefix', () => {
    expect(safeReturnPath(FLOW)).toBe(FLOW);
  });

  it('keeps the query, because the resume marker lives in it', () => {
    expect(safeReturnPath(`${FLOW}?fortsett=1`)).toBe(`${FLOW}?fortsett=1`);
  });

  it('drops a fragment, which no redirect target needs', () => {
    expect(safeReturnPath(`${FLOW}#betal`)).toBe(FLOW);
  });

  /**
   * The whole point. Every one of these starts with `/` or reads as a path at
   * a glance, and every one of them navigates off this site — or to a page the
   * login has no business delivering a parent to.
   */
  it.each([
    ['a protocol-relative URL', '//evil.example/barnehage/x'],
    ['a protocol-relative URL with a backslash', '/\\evil.example/barnehage/x'],
    ['a backslash-only host', '\\\\evil.example/barnehage/x'],
    ['an absolute https URL with an allowed path', 'https://evil.example/barnehage/x'],
    ['an absolute http URL', 'http://evil.example/barnehage/x'],
    ['a scheme-only value', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<script>alert(1)</script>'],
    ['a bare host', 'evil.example/barnehage/x'],
    ['a relative path', 'barnehage/lille-eik'],
    ['a path outside the allowed prefixes', '/api/portal/session/expired'],
    ['the site root', '/'],
    ['an empty string', ''],
    ['a tab smuggled into the scheme', '/\tbarnehage/x'],
    ['a newline', '/barnehage/x\n'],
    ['a leading space', ' /barnehage/x'],
  ])('refuses %s', (_case, value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, ['/barnehage/x']]) {
      expect(safeReturnPath(value)).toBeNull();
    }
  });

  /** An array is what `searchParams` hands back for a repeated key, and it is
   * the shape a caller is most likely to forget about. */
  it('refuses a repeated query parameter', () => {
    expect(safeReturnPath(['/barnehage/a', '/barnehage/b'])).toBeNull();
  });

  it('refuses a value long enough to be a payload rather than a path', () => {
    expect(safeReturnPath(`/barnehage/${'a'.repeat(600)}`)).toBeNull();
  });
});
