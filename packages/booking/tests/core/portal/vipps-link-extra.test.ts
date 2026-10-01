import { describe, expect, it } from 'vitest';
import { vippsLinkVerifyPath } from '../../../src/core/portal/vipps-link';
import { PARITY_CONFIG } from '../../support/parity-config';
import { SECOND_CONFIG } from '../../support/second-config';

describe('vippsLinkVerifyPath', () => {
  it('scopes the link cookie under this site’s portal API', () => {
    expect(vippsLinkVerifyPath(PARITY_CONFIG)).toBe('/api/portal/vipps/link/verify');
    expect(vippsLinkVerifyPath(SECOND_CONFIG)).toBe('/api/account/vipps/link/verify');
  });
});
