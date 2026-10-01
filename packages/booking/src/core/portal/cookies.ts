/**
 * The cookie jar the portal helpers read and write, as an interface.
 *
 * `/core` imports no framework, so the helpers that touch cookies take the jar
 * from a function the caller supplies. `/next` (P4) passes Next's own
 * `cookies()` from `next/headers`; a test passes an in-memory jar.
 */

export interface CookieAttributes {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
  expires?: Date;
}

export interface CookieJar {
  get(name: string): { value?: string } | undefined;
  set(name: string, value: string, options?: CookieAttributes): unknown;
  delete(options: { name: string } & CookieAttributes): unknown;
}

/** Where the jar for THIS request comes from — Next's `cookies`, or a test double. */
export type CookieSource = () => CookieJar | Promise<CookieJar>;
