/**
 * What a link to the ordering page can ask for, and how the page reads it.
 *
 * `?t=<token>`   the table a QR code on it stands for (opaque; Medal resolves it)
 * `?c=<channel>` `dine_in`, `takeaway` or `delivery` (the wire values, any case)
 *
 * A table link is a dine-in link: `?t=` without a valid `?c=` means
 * `dine_in`. An explicit `takeaway` or `delivery` wins, and the table is
 * dropped then — it means nothing to an order that leaves the restaurant.
 *
 * Every value is untrusted: the QR sticker may be a year old, or typed by
 * hand. An unknown value is ignored, never an error.
 */
import type { OrderingChannel } from '@medalsocial/sdk';

export const TABLE_QUERY_KEY = 't';
export const CHANNEL_QUERY_KEY = 'c';

/** Every wire channel, in the order the API lists them. */
export const CHANNELS: readonly OrderingChannel[] = ['dine_in', 'takeaway', 'delivery'];

/** A table token: letters, digits, `-` and `_`, at most 64 of them. */
const TABLE_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

/** A query as a page receives it: the address bar's, a raw string, or Next's `searchParams`. */
export type OrderLinkQuery =
  | URLSearchParams
  | string
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface OrderLink {
  /** The table token, or `null`. Only ever set for a dine-in link. */
  table: string | null;
  /** The channel the link asks for, or `null` when it asks for none. */
  channel: OrderingChannel | null;
}

/** `?t=` as a table token, or `null`. */
export function parseTable(value: string | null | undefined): string | null {
  const token = value?.trim() ?? '';
  return TABLE_TOKEN.test(token) ? token : null;
}

/** `?c=` as a channel, or `null`. */
export function parseChannel(value: string | null | undefined): OrderingChannel | null {
  const wanted = value?.trim().toLowerCase();
  return CHANNELS.find((channel) => channel === wanted) ?? null;
}

function read(query: OrderLinkQuery, key: string): string | undefined {
  if (typeof query === 'string') return new URLSearchParams(query).get(key) ?? undefined;
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined;
  const value = query[key];
  return typeof value === 'string' ? value : value?.[0];
}

/** The table and channel a link asks for. */
export function parseOrderLink(query: OrderLinkQuery): OrderLink {
  const table = parseTable(read(query, TABLE_QUERY_KEY));
  const channel = parseChannel(read(query, CHANNEL_QUERY_KEY));
  if (table === null) return { table: null, channel };
  if (channel === null || channel === 'dine_in') return { table, channel: 'dine_in' };
  return { table: null, channel };
}

export interface BuildOrderLinkInput {
  /** The ordering page, optionally with its own query and fragment. */
  path: string;
  table?: string | null;
  channel?: OrderingChannel | null;
}

/**
 * A link to the ordering page for a table and/or a channel — what a QR code
 * prints. A table link leaves out the `?c=dine_in` it implies; anything the
 * parser would ignore is left out. The path's own query is kept, minus any
 * old `t`/`c`, and so is its fragment.
 */
export function buildOrderLink(input: BuildOrderLinkInput): string {
  const hashAt = input.path.indexOf('#');
  const beforeHash = hashAt === -1 ? input.path : input.path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : input.path.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : beforeHash.slice(queryAt + 1));
  params.delete(TABLE_QUERY_KEY);
  params.delete(CHANNEL_QUERY_KEY);

  const channel = parseChannel(input.channel);
  const table = channel === null || channel === 'dine_in' ? parseTable(input.table) : null;
  if (table !== null) params.set(TABLE_QUERY_KEY, table);
  else if (channel !== null) params.set(CHANNEL_QUERY_KEY, channel);

  const query = params.toString();
  return `${base}${query === '' ? '' : `?${query}`}${hash}`;
}
