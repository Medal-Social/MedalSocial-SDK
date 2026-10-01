import { beforeEach, describe, expect, it } from 'vitest';
import { createRebookStore } from '../../src/core/rebook-store';
import { PARITY_CONFIG } from '../support/parity-config';

const { stashRebookWho, takeRebookWho } = createRebookStore(PARITY_CONFIG.storageNamespace);

describe('rebook-store', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('hands a stashed name over exactly once', () => {
    stashRebookWho('Jonas Ø');

    expect(takeRebookWho()).toBe('Jonas Ø');
    expect(takeRebookWho()).toBeNull();
  });

  it('answers null when nothing was stashed, or only whitespace was', () => {
    expect(takeRebookWho()).toBeNull();
    stashRebookWho('   ');
    expect(takeRebookWho()).toBeNull();
  });

  it('replaces an earlier stash on every tap, and clears it for a booking that named nobody', () => {
    stashRebookWho('Jonas');
    stashRebookWho('Emma');
    expect(takeRebookWho()).toBe('Emma');

    stashRebookWho('Jonas');
    stashRebookWho(null);
    expect(takeRebookWho()).toBeNull();
  });

  it('keeps the name out of every other storage key', () => {
    stashRebookWho('Jonas');

    expect(Object.keys(window.sessionStorage)).toEqual(['demo:booking:rebook-who']);
  });
});
