import { describe, expect, it } from 'vitest';
import { resolveBookingConfig } from '../../src/core/config';
import { createPaths } from '../../src/core/paths';
import { PARITY_CONFIG } from '../support/parity-config';

const { managePath, isManagePath, isPortalPath } = createPaths(PARITY_CONFIG);

describe('paths', () => {
  it('encodes the manage token into the one URL that spends it', () => {
    expect(managePath('manage-token-abc')).toBe('/bestill/administrer/manage-token-abc');
    expect(managePath('a/b c')).toBe('/bestill/administrer/a%2Fb%20c');
  });

  it('recognises the manage page with or without a locale segment', () => {
    expect(isManagePath('/bestill/administrer/tok')).toBe(true);
    expect(isManagePath('/bestill/administrer')).toBe(true);
    expect(isManagePath('/en/bestill/administrer/tok')).toBe(true);
    expect(isManagePath('/nb-NO/bestill/administrer/tok')).toBe(true);
    expect(isManagePath('/bestill')).toBe(false);
    expect(isManagePath('/bestill/administrerx')).toBe(false);
    expect(isManagePath(null)).toBe(false);
    expect(isManagePath(undefined)).toBe(false);
  });

  it('recognises the portal and everything below it', () => {
    expect(isPortalPath('/min-side')).toBe(true);
    expect(isPortalPath('/min-side/logg-inn')).toBe(true);
    expect(isPortalPath('/en/min-side')).toBe(true);
    expect(isPortalPath('/min-sideways')).toBe(false);
    expect(isPortalPath(null)).toBe(false);
  });

  it('has no portal to recognise when the site has none', () => {
    const none = createPaths(resolveBookingConfig({ timeZone: 'UTC', paths: { portal: null } }));
    expect(none.isPortalPath('/min-side')).toBe(true);
    const off = createPaths({ paths: { ...PARITY_CONFIG.paths, portal: null } });
    expect(off.isPortalPath('/min-side')).toBe(false);
  });

  it('treats a dot in a configured path as a dot', () => {
    const dotted = createPaths({ paths: { ...PARITY_CONFIG.paths, manage: '/b.c' } });
    expect(dotted.isManagePath('/b.c/x')).toBe(true);
    expect(dotted.isManagePath('/bxc/x')).toBe(false);
  });
});
