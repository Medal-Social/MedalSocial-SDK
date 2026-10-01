import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRestoreGate,
  RESTORE_FALLBACK_MS,
  restorePendingInStorage,
} from '../../src/core/restore-gate';
import { PARITY_CONFIG } from '../support/parity-config';

const { restoreGateScript } = createRestoreGate(PARITY_CONFIG.storageNamespace);

/**
 * The check is shipped as SOURCE (`toString()`) inside the server's HTML, so it
 * must work with no module scope at all. Rebuilt from its own text here — the
 * way the browser gets it — and asked both ways: a copy that leaned on an
 * import would throw, or answer wrongly, on at least one side.
 */
const detached = new Function(`return (${restorePendingInStorage.toString()})`)() as (
  ...args: Parameters<typeof restorePendingInStorage>
) => boolean;

const ATTEMPT = 'test:attempt';
const DRAFT = 'test:draft';
const TTL = 60_000;
const MAX_AGE = 30_000;
const NOW = 1_000_000;

function ask(prefilled = false, resuming = false) {
  return detached(ATTEMPT, TTL, DRAFT, MAX_AGE, prefilled, resuming);
}

beforeEach(() => {
  window.sessionStorage.clear();
  Date.now = () => NOW;
});

const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

describe('restorePendingInStorage, detached from its module', () => {
  it('says no for an empty tab', () => {
    expect(ask()).toBe(false);
    expect(ask(false, true)).toBe(false);
  });

  it('says yes for a stored confirmation, unless a rebook link outranks it', () => {
    window.sessionStorage.setItem(ATTEMPT, JSON.stringify({ nonce: 'n', at: NOW, confirmed: {} }));
    expect(ask()).toBe(true);
    expect(ask(true)).toBe(false);
  });

  it('looks past a confirmation a link outranks, to a Vipps draft behind it', () => {
    window.sessionStorage.setItem(ATTEMPT, JSON.stringify({ nonce: 'n', at: NOW, confirmed: {} }));
    window.sessionStorage.setItem(DRAFT, JSON.stringify({ savedAt: NOW - 1000, items: [{}] }));
    expect(ask(true, true)).toBe(true);
    expect(ask(true, false)).toBe(false);
  });

  it('says yes for a pending attempt, rebook link or not', () => {
    window.sessionStorage.setItem(ATTEMPT, JSON.stringify({ nonce: 'n', at: NOW, pending: {} }));
    expect(ask(true)).toBe(true);
  });

  it('ignores an attempt past its TTL, or one without a nonce', () => {
    window.sessionStorage.setItem(
      ATTEMPT,
      JSON.stringify({ nonce: 'n', at: NOW - TTL - 1, confirmed: {} })
    );
    expect(ask()).toBe(false);
    window.sessionStorage.setItem(ATTEMPT, JSON.stringify({ at: NOW, confirmed: {} }));
    expect(ask()).toBe(false);
  });

  it('says yes for a fresh draft only behind ?resume=1', () => {
    window.sessionStorage.setItem(DRAFT, JSON.stringify({ savedAt: NOW - 1000, items: [{}] }));
    expect(ask(false, true)).toBe(true);
    expect(ask(false, false)).toBe(false);
  });

  it('refuses a stale, future-stamped or empty draft', () => {
    window.sessionStorage.setItem(
      DRAFT,
      JSON.stringify({ savedAt: NOW - MAX_AGE - 1, items: [{}] })
    );
    expect(ask(false, true)).toBe(false);
    window.sessionStorage.setItem(DRAFT, JSON.stringify({ savedAt: NOW + 1, items: [{}] }));
    expect(ask(false, true)).toBe(false);
    window.sessionStorage.setItem(DRAFT, JSON.stringify({ savedAt: NOW, items: [] }));
    expect(ask(false, true)).toBe(false);
  });

  it('reads garbage in storage as nothing to restore', () => {
    window.sessionStorage.setItem(ATTEMPT, '{not json');
    window.sessionStorage.setItem(DRAFT, '"a string"');
    expect(ask(false, true)).toBe(false);
  });
});

describe('restoreGateScript', () => {
  it('evaluates to the check’s answer and marks the root only when it is yes', () => {
    const root = document.createElement('div');
    root.id = 'gate-root';
    document.body.append(root);
    const run = () => new Function(`return ${restoreGateScript('gate-root', false, false)}`)();

    expect(run()).toBe(false);
    expect(root).not.toHaveAttribute('data-restoring');

    window.sessionStorage.setItem(
      'demo:booking:attempt',
      JSON.stringify({ nonce: 'n', at: NOW, confirmed: {} })
    );
    expect(run()).toBe(true);
    expect(root).toHaveAttribute('data-restoring');
    root.remove();
  });
});

describe('restoreGateScript fallback', () => {
  function markedRoot() {
    window.sessionStorage.setItem(
      'demo:booking:attempt',
      JSON.stringify({ nonce: 'n', at: NOW, confirmed: {} })
    );
    const root = document.createElement('div');
    root.id = 'gate-root';
    document.body.append(root);
    new Function(restoreGateScript('gate-root', false, false))();
    expect(root).toHaveAttribute('data-restoring');
    return root;
  }

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById('gate-root')?.remove();
  });

  it('shows step 1 again if React never takes the root over', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const root = markedRoot();

    vi.advanceTimersByTime(RESTORE_FALLBACK_MS - 1);
    expect(root).toHaveAttribute('data-restoring');
    vi.advanceTimersByTime(1);
    expect(root).not.toHaveAttribute('data-restoring');
  });

  it('stands down once React has hydrated the root', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const root = markedRoot();
    // React's gate is still up (a replay in flight): the mark is React's now.
    root.setAttribute('data-hydrated', '');

    vi.advanceTimersByTime(RESTORE_FALLBACK_MS);
    expect(root).toHaveAttribute('data-restoring');
  });
});
