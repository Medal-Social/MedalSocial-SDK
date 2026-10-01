/**
 * `restorePendingInStorage` called as a module function. The parity suite
 * only runs it rebuilt from its own source — the way the browser gets it —
 * which proves it is self-contained but leaves the module copy unexercised.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRestoreGate, restorePendingInStorage } from '../../src/core/restore-gate';

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

describe('restoreGateScript — safe inside an inline <script>', () => {
  const { restoreGateScript } = createRestoreGate('gate');

  it('escapes what could end the element or a line, and still finds the same root', () => {
    const rootId = 'root</script><img src=x>\u2028\u2029/';
    const script = restoreGateScript(rootId, false, false);
    // The gate's own source has `<=` and `=>`; what must not appear is the id's markup.
    expect(script).not.toContain('</');
    expect(script).not.toContain('<img');
    expect(script).not.toMatch(/\u2028|\u2029/);
    expect(script).toContain('root\\u003C\\u002Fscript\\u003E');

    put('gate:booking:attempt', { nonce: 'n', at: Date.now(), pending: {} });
    const root = document.createElement('div');
    root.id = rootId;
    document.body.append(root);
    expect(new Function(`return ${script}`)()).toBe(true);
    expect(root.hasAttribute('data-restoring')).toBe(true);
    root.remove();
  });

  it('emits plain JSON literals for ordinary ids and keys', () => {
    const script = restoreGateScript('booking-root', true, false);
    expect(script).toContain('"gate:booking:attempt"');
    expect(script).toContain('document.getElementById("booking-root")');
  });
});
