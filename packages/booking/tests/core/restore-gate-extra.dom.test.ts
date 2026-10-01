/**
 * `restorePendingInStorage` called as a module function. The parity suite
 * only runs it rebuilt from its own source — the way the browser gets it —
 * which proves it is self-contained but leaves the module copy unexercised.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { restorePendingInStorage } from '../../src/core/restore-gate';

const ATTEMPT = 'gate:attempt';
const DRAFT = 'gate:draft';
const TTL = 60_000;
const MAX_AGE = 30_000;

function ask(prefilled = false, resuming = false) {
  return restorePendingInStorage(ATTEMPT, TTL, DRAFT, MAX_AGE, prefilled, resuming);
}

function put(key: string, value: unknown) {
  window.sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('restorePendingInStorage', () => {
  it('is up for a live pending attempt, and for a confirmation unless a link outranks it', () => {
    put(ATTEMPT, { nonce: 'n', at: Date.now(), pending: {} });
    expect(ask()).toBe(true);
    put(ATTEMPT, { nonce: 'n', at: Date.now(), confirmed: {} });
    expect(ask()).toBe(true);
    expect(ask(true)).toBe(false);
  });

  it('is down for an attempt that has aged out or is not one', () => {
    put(ATTEMPT, { nonce: 'n', at: Date.now() - TTL - 1, pending: {} });
    expect(ask()).toBe(false);
    put(ATTEMPT, 'not json');
    expect(ask()).toBe(false);
    put(ATTEMPT, '7');
    expect(ask()).toBe(false);
  });

  it('reads the draft only when resuming, and only a fresh one with items', () => {
    put(DRAFT, { savedAt: Date.now(), items: [{}] });
    expect(ask(false, false)).toBe(false);
    expect(ask(false, true)).toBe(true);
    put(DRAFT, { savedAt: Date.now() - MAX_AGE - 1, items: [{}] });
    expect(ask(false, true)).toBe(false);
    put(DRAFT, { savedAt: Date.now() + 5_000, items: [{}] });
    expect(ask(false, true)).toBe(false);
    put(DRAFT, { savedAt: Date.now(), items: [] });
    expect(ask(false, true)).toBe(false);
    put(DRAFT, { items: [{}] });
    expect(ask(false, true)).toBe(false);
  });
});
