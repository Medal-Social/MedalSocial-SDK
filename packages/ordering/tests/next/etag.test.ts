import { describe, expect, it } from 'vitest';
import { matchesIfNoneMatch, toEntityTag } from '../../src/next/etag';

describe('toEntityTag', () => {
  it('keeps a strong or weak entity-tag as it is', () => {
    expect(toEntityTag('W/"abc"')).toBe('W/"abc"');
    expect(toEntityTag('"abc"')).toBe('"abc"');
  });

  it('quotes a bare tag (and drops quotes inside it) so the header stays well formed', () => {
    expect(toEntityTag('abc')).toBe('"abc"');
    expect(toEntityTag(' a"b ')).toBe('"ab"');
  });
});

describe('matchesIfNoneMatch (RFC 9110 weak comparison)', () => {
  const etag = 'W/"0123456789abcdef"';

  it('is false without a header', () => {
    expect(matchesIfNoneMatch(null, etag)).toBe(false);
    expect(matchesIfNoneMatch('', etag)).toBe(false);
  });

  it('matches the same tag, weak or strong on either side', () => {
    expect(matchesIfNoneMatch('W/"0123456789abcdef"', etag)).toBe(true);
    expect(matchesIfNoneMatch('"0123456789abcdef"', etag)).toBe(true);
    expect(matchesIfNoneMatch('W/"x"', '"x"')).toBe(true);
  });

  it('matches anywhere in a comma list, with whitespace', () => {
    expect(matchesIfNoneMatch('"a", W/"b" ,  W/"0123456789abcdef"', etag)).toBe(true);
    expect(matchesIfNoneMatch('"a", W/"b"', etag)).toBe(false);
  });

  it('treats a comma inside a quoted tag as part of the tag', () => {
    expect(matchesIfNoneMatch('"a,b"', '"a,b"')).toBe(true);
    expect(matchesIfNoneMatch('"a,b"', '"a"')).toBe(false);
  });

  it('matches * against any current representation', () => {
    expect(matchesIfNoneMatch(' * ', etag)).toBe(true);
  });

  it('ignores garbage that is not an entity-tag', () => {
    expect(matchesIfNoneMatch('0123456789abcdef', etag)).toBe(false);
  });
});
