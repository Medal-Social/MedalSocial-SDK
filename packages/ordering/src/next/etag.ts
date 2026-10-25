/**
 * Entity-tags for the menu route (RFC 9110 §8.8.3, §13.1.2).
 *
 * The Medal API sends a weak tag (`W/"<16 hex>"`). `If-None-Match` uses the
 * WEAK comparison: two tags match when their opaque parts are equal, whatever
 * their `W/` prefixes. A header is `*` or a comma list of tags, and a comma
 * may sit inside a quoted tag, so the list is read tag by tag, not split.
 */

const ENTITY_TAG = /^(?:W\/)?"[^"]*"$/;
const LIST_TAG = /(?:W\/)?"([^"]*)"/g;

/** `etag` as a well-formed header value: kept when it is one, quoted when bare. */
export function toEntityTag(etag: string): string {
  const trimmed = etag.trim();
  return ENTITY_TAG.test(trimmed) ? trimmed : `"${trimmed.replaceAll('"', '')}"`;
}

function opaque(tag: string): string {
  return tag.replace(/^W\//, '');
}

/** Whether an `If-None-Match` header names `etag` (or `*`). */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  const value = header?.trim() ?? '';
  if (value === '*') return true;
  const current = opaque(toEntityTag(etag));
  for (const match of value.matchAll(LIST_TAG)) {
    if (`"${match[1]}"` === current) return true;
  }
  return false;
}
