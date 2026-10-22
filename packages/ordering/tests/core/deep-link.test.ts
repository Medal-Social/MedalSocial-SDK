import { describe, expect, it } from 'vitest';
import {
  buildOrderLink,
  CHANNEL_QUERY_KEY,
  parseChannel,
  parseOrderLink,
  parseTable,
  TABLE_QUERY_KEY,
} from '../../src/core/deep-link';

describe('parseTable', () => {
  it('accepts an opaque token, trimmed', () => {
    expect(parseTable('  A12-b_3  ')).toBe('A12-b_3');
    expect(parseTable('x'.repeat(64))).toBe('x'.repeat(64));
  });

  it.each([
    [undefined],
    [null],
    [''],
    ['   '],
    ['x'.repeat(65)],
    ['a b'],
    ['<script>'],
    ['bord/1'],
    ['bord%201'],
    ['æøå'],
  ])('ignores %j', (value) => {
    expect(parseTable(value)).toBeNull();
  });
});

describe('parseChannel', () => {
  it.each([
    ['dine_in', 'dine_in'],
    ['takeaway', 'takeaway'],
    ['delivery', 'delivery'],
    [' TAKEAWAY ', 'takeaway'],
    ['Dine_In', 'dine_in'],
  ])('reads %j as %s', (value, expected) => {
    expect(parseChannel(value)).toBe(expected);
  });

  it.each([[undefined], [null], [''], ['henting'], ['dine-in'], ['pickup']])(
    'ignores %j',
    (value) => {
      expect(parseChannel(value)).toBeNull();
    }
  );
});

describe('parseOrderLink', () => {
  it('uses t and c as the query keys', () => {
    expect(TABLE_QUERY_KEY).toBe('t');
    expect(CHANNEL_QUERY_KEY).toBe('c');
  });

  it('reads nothing from an empty query', () => {
    expect(parseOrderLink('')).toEqual({ table: null, channel: null });
    expect(parseOrderLink({})).toEqual({ table: null, channel: null });
    expect(parseOrderLink(new URLSearchParams())).toEqual({ table: null, channel: null });
  });

  it('reads a query string, with or without its «?»', () => {
    expect(parseOrderLink('?c=takeaway')).toEqual({ table: null, channel: 'takeaway' });
    expect(parseOrderLink('c=delivery&x=1')).toEqual({ table: null, channel: 'delivery' });
  });

  it('reads URLSearchParams', () => {
    expect(parseOrderLink(new URLSearchParams({ c: 'delivery' }))).toEqual({
      table: null,
      channel: 'delivery',
    });
  });

  it('reads Next searchParams, taking the first of a repeated key', () => {
    expect(parseOrderLink({ c: ['takeaway', 'delivery'], t: undefined })).toEqual({
      table: null,
      channel: 'takeaway',
    });
    expect(parseOrderLink({ c: [] })).toEqual({ table: null, channel: null });
  });

  it('makes a table link dine-in when it names no channel', () => {
    expect(parseOrderLink('?t=T7')).toEqual({ table: 'T7', channel: 'dine_in' });
    expect(parseOrderLink('?t=T7&c=nonsense')).toEqual({ table: 'T7', channel: 'dine_in' });
    expect(parseOrderLink('?t=T7&c=dine_in')).toEqual({ table: 'T7', channel: 'dine_in' });
  });

  it('lets an explicit takeaway or delivery channel win, and drops the table then', () => {
    expect(parseOrderLink('?t=T7&c=takeaway')).toEqual({ table: null, channel: 'takeaway' });
    expect(parseOrderLink({ t: 'T7', c: 'delivery' })).toEqual({
      table: null,
      channel: 'delivery',
    });
  });

  it('ignores an invalid table token', () => {
    expect(parseOrderLink('?t=%3Cscript%3E')).toEqual({ table: null, channel: null });
  });
});

describe('buildOrderLink', () => {
  it('returns the path alone when there is nothing to add', () => {
    expect(buildOrderLink({ path: '/bestill' })).toBe('/bestill');
  });

  it('writes a table link without the implied channel', () => {
    expect(buildOrderLink({ path: '/bestill', table: 'T7' })).toBe('/bestill?t=T7');
    expect(buildOrderLink({ path: '/bestill', table: 'T7', channel: 'dine_in' })).toBe(
      '/bestill?t=T7'
    );
  });

  it('writes a channel link, and drops the table for takeaway or delivery', () => {
    expect(buildOrderLink({ path: '/bestill', channel: 'takeaway' })).toBe('/bestill?c=takeaway');
    expect(buildOrderLink({ path: '/bestill', channel: 'dine_in' })).toBe('/bestill?c=dine_in');
    expect(buildOrderLink({ path: '/bestill', table: 'T7', channel: 'delivery' })).toBe(
      '/bestill?c=delivery'
    );
  });

  it('keeps the rest of the query and the fragment, replacing old t and c', () => {
    expect(buildOrderLink({ path: '/bestill?utm=qr&t=old&c=delivery#meny', table: 'T7' })).toBe(
      '/bestill?utm=qr&t=T7#meny'
    );
    expect(buildOrderLink({ path: '/bestill?t=old#x' })).toBe('/bestill#x');
  });

  it('ignores values the parser would ignore', () => {
    expect(
      buildOrderLink({
        path: '/bestill',
        table: 'a b',
        channel: 'pickup' as unknown as 'takeaway',
      })
    ).toBe('/bestill');
  });

  it('round-trips through the parser', () => {
    const link = buildOrderLink({ path: '/bestill', table: 'T-12_a' });
    expect(parseOrderLink(link.slice(link.indexOf('?')))).toEqual({
      table: 'T-12_a',
      channel: 'dine_in',
    });
  });
});
