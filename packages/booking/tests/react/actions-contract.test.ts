/**
 * The two halves of Decision 8 agree: what `/next` hands an app as its portal
 * actions is what `/react`'s components take as props, so the app's
 * `'use server'` wrappers pass them straight through.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { PortalActions as ServerActions } from '../../src/next/portal';
import type { PortalActions } from '../../src/react/actions';

describe('the portal action contract', () => {
  it('takes /next’s portal actions as /react’s', () => {
    expectTypeOf<ServerActions>().toExtend<PortalActions>();
  });
});
