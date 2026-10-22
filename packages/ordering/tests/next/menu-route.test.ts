import type { OrderingMenu, OrderingMenuOptions, OrderingMenuResult } from '@medalsocial/sdk';
import { MedalApiError, MedalNetworkError, MedalTimeoutError } from '@medalsocial/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMenuRoute,
  type MenuCacheEntry,
  type MenuRouteOptions,
  type MenuStore,
} from '../../src/next/menu-route';
import { MENU } from '../support/menu';

const KEY = 'medal_sk_live_0123456789SECRETabcdef';
const ETAG = 'W/"0123456789abcdef"';
const ETAG_2 = 'W/"fedcba9876543210"';
const UPSTREAM = 'https://medal.example.test';

const MENU_2: OrderingMenu = { ...MENU, etag: ETAG_2, categories: [] };

const NOW = Date.parse('2026-10-22T12:00:00Z');
const DAY = 86_400_000;
/** A valid `?at=` (tomorrow 18:00 UTC) in Unix milliseconds. */
const AT_MS = String(Date.parse('2026-10-23T18:00:00Z'));
const AT = `?at=${AT_MS}`;

type MenuFn = (
  options: OrderingMenuOptions,
  request?: { signal?: AbortSignal }
) => Promise<OrderingMenuResult>;

function fresh(menu: OrderingMenu = MENU, etag = ETAG): OrderingMenuResult {
  return { notModified: false, etag, menu };
}

function setup(options: Partial<MenuRouteOptions> = {}) {
  const menu = vi.fn<MenuFn>(async () => fresh());
  const onError = vi.fn();
  const GET = createMenuRoute({ apiKey: KEY, medal: { ordering: { menu } }, onError, ...options });
  return { GET, menu, onError };
}

function req(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`https://site.example.test/api/ordering/menu${query}`, { headers });
}

/** Everything a client can see of a response: status line, headers and body. */
async function visible(response: Response): Promise<string> {
  const headers = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
  return `${response.status} ${response.statusText}\n${headers}\n\n${await response.text()}`;
}

async function body(response: Response) {
  return (await response.json()) as {
    data?: OrderingMenu;
    error?: { code: string; message: string };
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createMenuRoute — options', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses maxTimedReadsPerWindow %s at once',
    (maxTimedReadsPerWindow) => {
      expect(() => createMenuRoute({ apiKey: KEY, maxTimedReadsPerWindow })).toThrow(RangeError);
    }
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses revalidateSeconds %s at once',
    (revalidateSeconds) => {
      expect(() => createMenuRoute({ apiKey: KEY, revalidateSeconds })).toThrow(RangeError);
    }
  );
});

describe('createMenuRoute — success', () => {
  it('answers 200 { data: menu } with a public, CDN-cacheable Cache-Control', async () => {
    const { GET, menu } = setup();
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
    expect(await body(response)).toEqual({ data: MENU });
    expect(menu).toHaveBeenCalledWith(
      { channel: 'takeaway', location: undefined, at: undefined, ifNoneMatch: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('follows revalidateSeconds in Cache-Control', async () => {
    const { GET } = setup({ revalidateSeconds: 30 });
    const response = await GET(req());
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=30, stale-while-revalidate=150'
    );
  });

  it('passes the configured location', async () => {
    const { GET, menu } = setup({ location: 'loc_1' });
    await GET(req());
    expect(menu.mock.calls[0]?.[0]).toMatchObject({ location: 'loc_1' });
  });
});

describe('createMenuRoute — etag passthrough', () => {
  it('sends the upstream etag as ETag', async () => {
    const { GET } = setup();
    const response = await GET(req());
    expect(response.headers.get('etag')).toBe(ETAG);
  });

  it('quotes an etag that arrives bare', async () => {
    const { GET, menu } = setup();
    menu.mockResolvedValueOnce(fresh(MENU, 'abc'));
    const response = await GET(req());
    expect(response.headers.get('etag')).toBe('"abc"');
  });

  it('answers 304 with the ETag and no body when If-None-Match matches', async () => {
    const { GET } = setup();
    const response = await GET(req('', { 'if-none-match': `"other", ${ETAG}` }));
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe(ETAG);
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
    expect(await response.text()).toBe('');
  });

  it('matches a strong If-None-Match against the weak etag', async () => {
    const { GET } = setup();
    const response = await GET(req('', { 'if-none-match': '"0123456789abcdef"' }));
    expect(response.status).toBe(304);
  });

  it('answers 200 when If-None-Match names another etag', async () => {
    const { GET } = setup();
    const response = await GET(req('', { 'if-none-match': ETAG_2 }));
    expect(response.status).toBe(200);
  });

  it('answers 304 when the etag is anywhere in an If-None-Match list', async () => {
    const { GET } = setup();
    const response = await GET(req('', { 'if-none-match': `W/"x", "0123456789abcdef"` }));
    expect(response.status).toBe(304);
  });

  it('never forwards the visitor If-None-Match upstream', async () => {
    const { GET, menu } = setup();
    await GET(req('', { 'if-none-match': ETAG_2 }));
    expect(menu.mock.calls[0]?.[0].ifNoneMatch).toBeUndefined();
  });
});

describe('createMenuRoute — server-side revalidation', () => {
  it('revalidates only after revalidateSeconds', async () => {
    const { GET, menu } = setup();
    await GET(req());
    vi.advanceTimersByTime(59_999);
    await GET(req());
    expect(menu).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await GET(req());
    expect(menu).toHaveBeenCalledTimes(2);
    expect(menu.mock.calls[1]?.[0].ifNoneMatch).toBe(ETAG);
  });

  it('keeps the cached menu on an upstream 304 and restarts the window', async () => {
    const { GET, menu } = setup();
    await GET(req());
    menu.mockResolvedValueOnce({ notModified: true, etag: ETAG });
    vi.advanceTimersByTime(60_000);
    const response = await GET(req());
    expect(await body(response)).toEqual({ data: MENU });
    expect(response.headers.get('etag')).toBe(ETAG);
    vi.advanceTimersByTime(59_999);
    await GET(req());
    expect(menu).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached etag when a 304 carries none', async () => {
    const { GET, menu } = setup();
    await GET(req());
    menu.mockResolvedValueOnce({ notModified: true, etag: '' });
    vi.advanceTimersByTime(60_000);
    const response = await GET(req());
    expect(response.headers.get('etag')).toBe(ETAG);
  });

  it('replaces the cached menu when upstream has a new one', async () => {
    const { GET, menu } = setup();
    await GET(req());
    menu.mockResolvedValueOnce(fresh(MENU_2, ETAG_2));
    vi.advanceTimersByTime(60_000);
    const response = await GET(req());
    expect(response.headers.get('etag')).toBe(ETAG_2);
    expect(await body(response)).toEqual({ data: MENU_2 });
  });

  it('shares one upstream call between concurrent requests', async () => {
    const { GET, menu } = setup();
    let release: (value: OrderingMenuResult) => void = () => {};
    const gate = new Promise<OrderingMenuResult>((resolve) => {
      release = resolve;
    });
    menu.mockImplementationOnce(() => gate);
    const pending = [GET(req()), GET(req()), GET(req())];
    release(fresh());
    const responses = await Promise.all(pending);
    expect(menu).toHaveBeenCalledTimes(1);
    for (const response of responses) expect(response.status).toBe(200);
  });

  it('keeps one cache entry per channel', async () => {
    const { GET, menu } = setup();
    await GET(req('?c=takeaway'));
    await GET(req('?c=dine_in'));
    await GET(req('?c=takeaway'));
    expect(menu).toHaveBeenCalledTimes(2);
  });

  it('fails a 304 that answers no etag we sent as a bad upstream', async () => {
    const { GET, menu, onError } = setup();
    menu.mockResolvedValueOnce({ notModified: true, etag: ETAG });
    const response = await GET(req());
    expect(response.status).toBe(502);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reads and writes through an injected store', async () => {
    const entries = new Map<string, MenuCacheEntry>();
    const store: MenuStore = {
      get: async (key) => entries.get(key),
      set: async (key, entry) => {
        entries.set(key, entry);
      },
      delete: async (key) => {
        entries.delete(key);
      },
    };
    const { GET, menu } = setup({ store, storeKeyPrefix: 'site' });
    await GET(req());
    expect([...entries.values()]).toEqual([{ etag: ETAG, menu: MENU, checkedAt: Date.now() }]);
    const second = setup({ store, storeKeyPrefix: 'site' });
    await second.GET(req());
    expect(second.menu).not.toHaveBeenCalled();
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('treats a store that throws as a miss and still answers', async () => {
    const store: MenuStore = {
      get: () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      delete: () => {
        throw new Error('down');
      },
    };
    const { GET, menu } = setup({ store, storeKeyPrefix: 'site' });
    expect((await GET(req())).status).toBe(200);
    expect((await GET(req())).status).toBe(200);
    expect(menu).toHaveBeenCalledTimes(2);
    menu.mockRejectedValueOnce(new MedalApiError(401, 'UNAUTHORIZED', 'no'));
    expect((await GET(req())).status).toBe(502);
  });

  it('dedupes concurrent requests behind an async store.get', async () => {
    const entries = new Map<string, MenuCacheEntry>();
    const store: MenuStore = {
      get: async (key) => {
        await Promise.resolve();
        await Promise.resolve();
        return entries.get(key);
      },
      set: async (key, entry) => {
        entries.set(key, entry);
      },
      delete: async (key) => {
        entries.delete(key);
      },
    };
    const { GET, menu } = setup({ store, storeKeyPrefix: 'site' });
    const responses = await Promise.all([GET(req()), GET(req()), GET(req())]);
    expect(menu).toHaveBeenCalledTimes(1);
    for (const response of responses) expect(response.status).toBe(200);
    expect(entries.size).toBe(1);
  });

  it('gives every concurrent request the error of a failing first fetch, then retries', async () => {
    const { GET, menu, onError } = setup();
    let fail: (error: unknown) => void = () => {};
    const gate = new Promise<OrderingMenuResult>((_resolve, reject) => {
      fail = reject;
    });
    menu.mockImplementationOnce(() => gate);
    const pending = [GET(req()), GET(req()), GET(req())];
    fail(new MedalNetworkError('fetch failed'));
    const responses = await Promise.all(pending);
    expect(menu).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    for (const response of responses) {
      expect(response.status).toBe(502);
      expect((await body(response)).error?.code).toBe('MENU_UNAVAILABLE');
    }
    expect((await GET(req())).status).toBe(200);
    expect(menu).toHaveBeenCalledTimes(2);
  });

  it('a throwing waitUntil never breaks the response', async () => {
    const { GET } = setup({
      waitUntil: () => {
        throw new Error('no context');
      },
    });
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ data: MENU });
  });

  it('hands a shared revalidation to waitUntil once, settled even when it fails', async () => {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    const { GET, menu } = setup({ waitUntil });
    await Promise.all([GET(req()), GET(req())]);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    menu.mockRejectedValueOnce(new MedalNetworkError('x'));
    await GET(req());
    expect(waitUntil).toHaveBeenCalledTimes(2);
    await expect(waitUntil.mock.calls[1]?.[0]).resolves.toBeDefined();
    // A first fetch that fails outright (nothing cached) still settles.
    menu.mockRejectedValueOnce(new MedalNetworkError('x'));
    expect((await GET(req('?c=delivery'))).status).toBe(502);
    expect(waitUntil).toHaveBeenCalledTimes(3);
    await expect(waitUntil.mock.calls[2]?.[0]).resolves.toBeUndefined();
  });
});

describe('createMenuRoute — a shared store', () => {
  function mapStore() {
    const entries = new Map<string, MenuCacheEntry>();
    const store: MenuStore = {
      get: async (key) => entries.get(key),
      set: async (key, entry) => {
        entries.set(key, entry);
      },
      delete: async (key) => {
        entries.delete(key);
      },
    };
    return { entries, store };
  }

  it.each([undefined, '', '   '])(
    'refuses a custom store without a storeKeyPrefix (%j) at once',
    (storeKeyPrefix) => {
      const { store } = mapStore();
      expect(() => createMenuRoute({ apiKey: KEY, store, storeKeyPrefix })).toThrow(RangeError);
    }
  );

  it('refuses an empty storeKeyPrefix even without a store', () => {
    expect(() => createMenuRoute({ apiKey: KEY, storeKeyPrefix: '' })).toThrow(RangeError);
  });

  it('prefixes every store key, so two routes with different prefixes keep apart', async () => {
    const { entries, store } = mapStore();
    const one = setup({ store, storeKeyPrefix: 'site-one' });
    const two = setup({ store, storeKeyPrefix: 'site-two' });
    two.menu.mockResolvedValue(fresh(MENU_2, ETAG_2));
    expect(await body(await one.GET(req()))).toEqual({ data: MENU });
    expect(await body(await two.GET(req()))).toEqual({ data: MENU_2 });
    expect(await body(await one.GET(req()))).toEqual({ data: MENU });
    expect(await body(await two.GET(req()))).toEqual({ data: MENU_2 });
    expect(one.menu).toHaveBeenCalledTimes(1);
    expect(two.menu).toHaveBeenCalledTimes(1);
    const keys = [...entries.keys()];
    expect(keys).toHaveLength(2);
    expect(keys.filter((key) => key.startsWith('site-one:'))).toHaveLength(1);
    expect(keys.filter((key) => key.startsWith('site-two:'))).toHaveLength(1);
  });

  it('prefixes the in-process keys too, and works without a prefix there', async () => {
    const plain = setup();
    const prefixed = setup({ storeKeyPrefix: 'site' });
    expect((await plain.GET(req())).status).toBe(200);
    expect((await prefixed.GET(req())).status).toBe(200);
  });
});

describe('createMenuRoute — a store that never answers', () => {
  const never = () => new Promise<never>(() => {});

  it('gives up on get and set after a deadline and still answers from Medal', async () => {
    const store: MenuStore = { get: never, set: never, delete: never };
    const { GET, menu } = setup({ store, storeKeyPrefix: 'site' });
    const pending = Promise.all([GET(req()), GET(req())]);
    await vi.advanceTimersByTimeAsync(5_000);
    const responses = await pending;
    for (const response of responses) expect(await body(response)).toEqual({ data: MENU });
    // One shared Medal read, and the in-flight entry is gone: the next request reads again.
    expect(menu).toHaveBeenCalledTimes(1);
    const next = GET(req());
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await next).status).toBe(200);
    expect(menu).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on delete after a deadline and still answers the refusal', async () => {
    const stale: MenuCacheEntry = { etag: ETAG, menu: MENU, checkedAt: NOW - 120_000 };
    const store: MenuStore = { get: async () => stale, set: async () => {}, delete: never };
    const { GET, menu } = setup({ store, storeKeyPrefix: 'site' });
    menu.mockRejectedValueOnce(new MedalApiError(404, 'ORDERING_NOT_ENABLED', 'off'));
    const pending = GET(req());
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await body(await pending)).error?.code).toBe('ORDERING_NOT_ENABLED');
    // Settled and cleared: the next request asks Medal again.
    expect((await GET(req())).status).toBe(200);
    expect(menu).toHaveBeenCalledTimes(2);
  });

  it('leaves no timer behind when the store answers in time', async () => {
    const { GET } = setup();
    expect((await GET(req())).status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createMenuRoute — stale-if-error', () => {
  it('serves the cached menu when upstream fails, and waits a window before asking again', async () => {
    const { GET, menu, onError } = setup();
    await GET(req());
    menu.mockRejectedValueOnce(new MedalNetworkError('fetch failed'));
    vi.advanceTimersByTime(60_000);
    const stale = await GET(req());
    expect(stale.status).toBe(200);
    expect(stale.headers.get('etag')).toBe(ETAG);
    expect(await body(stale)).toEqual({ data: MENU });
    expect(onError).toHaveBeenCalledTimes(1);
    await GET(req());
    expect(menu).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    await GET(req());
    expect(menu).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a 5xx', new MedalApiError(503, 'UNAVAILABLE', 'x')],
    ['a 429', new MedalApiError(429, 'RATE_LIMITED', 'x')],
    ['a timeout', new MedalTimeoutError(5000)],
    ['an abort', new DOMException('The operation timed out.', 'TimeoutError')],
  ])('serves stale on %s', async (_name, error) => {
    const { GET, menu } = setup();
    await GET(req());
    menu.mockRejectedValueOnce(error);
    vi.advanceTimersByTime(60_000);
    expect((await GET(req())).status).toBe(200);
  });

  it.each([
    ['ORDERING_NOT_ENABLED', new MedalApiError(403, 'ORDERING_NOT_ENABLED', 'off'), 404],
    ['a 401', new MedalApiError(401, 'UNAUTHORIZED', 'no'), 502],
    ['a 403', new MedalApiError(403, 'FORBIDDEN', 'no'), 502],
  ])('drops the cached menu and answers the error on %s', async (_name, error, status) => {
    const { GET, menu } = setup();
    await GET(req());
    menu.mockRejectedValueOnce(error);
    vi.advanceTimersByTime(60_000);
    expect((await GET(req())).status).toBe(status);
    // Nothing cached any more: the next request asks Medal afresh, without an etag.
    await GET(req());
    expect(menu).toHaveBeenCalledTimes(3);
    expect(menu.mock.calls[2]?.[0].ifNoneMatch).toBeUndefined();
  });
});

describe('createMenuRoute — channel', () => {
  it.each([
    ['', 'takeaway'],
    ['?c=delivery', 'delivery'],
    ['?c=DINE_IN', 'dine_in'],
    ['?channel=delivery', 'delivery'],
    ['?channel=delivery&c=dine_in', 'delivery'],
    ['?t=T7', 'dine_in'],
    ['?t=T7&c=takeaway', 'takeaway'],
    ['?t=not%20a%20token', 'takeaway'],
  ])('%s reads as %s', async (query, channel) => {
    const { GET, menu } = setup();
    expect((await GET(req(query))).status).toBe(200);
    expect(menu.mock.calls[0]?.[0].channel).toBe(channel);
  });

  it.each([
    ['?channel=', 'takeaway'],
    ['?c=', 'takeaway'],
    ['?channel=&c=delivery', 'delivery'],
    ['?c=&t=T7', 'dine_in'],
  ])('treats an empty channel as absent: %s reads as %s', async (query, channel) => {
    const { GET, menu } = setup();
    expect((await GET(req(query))).status).toBe(200);
    expect(menu.mock.calls[0]?.[0].channel).toBe(channel);
  });

  it('uses defaultChannel when the request names none', async () => {
    const { GET, menu } = setup({ defaultChannel: 'delivery' });
    await GET(req());
    expect(menu.mock.calls[0]?.[0].channel).toBe('delivery');
  });

  it.each(['?c=pickup', '?channel=dine-in', '?channel=%20x'])(
    '%s is a 400 and never reaches upstream',
    async (query) => {
      const { GET, menu } = setup();
      const response = await GET(req(query));
      expect(response.status).toBe(400);
      expect((await body(response)).error?.code).toBe('INVALID_CHANNEL');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(menu).not.toHaveBeenCalled();
    }
  );

  it('never forwards other query parameters', async () => {
    const { GET, menu } = setup();
    await GET(req('?c=takeaway&location=evil&ifNoneMatch=x&foo=bar'));
    expect(menu.mock.calls[0]?.[0]).toEqual({
      channel: 'takeaway',
      location: undefined,
      at: undefined,
      ifNoneMatch: undefined,
    });
  });
});

describe('createMenuRoute — at', () => {
  it.each([
    ['2026-10-23T18:00:00Z', '2026-10-23T18:00:00.000Z'],
    ['2026-10-23T20:00:59.999+02:00', '2026-10-23T18:00:00.000Z'],
    [String(Date.parse('2026-10-23T18:00:42.123Z')), '2026-10-23T18:00:00.000Z'],
    [new Date(NOW - DAY).toISOString(), '2026-10-21T12:00:00.000Z'],
    [String(NOW + 60 * DAY), '2026-12-21T12:00:00.000Z'],
  ])('passes %s to Medal rounded down to the minute (%s)', async (at, forwarded) => {
    const { GET, menu } = setup();
    const response = await GET(req(`?at=${encodeURIComponent(at)}`));
    expect(response.status).toBe(200);
    expect(menu.mock.calls[0]?.[0]).toMatchObject({ at: forwarded, ifNoneMatch: undefined });
  });

  it('shares one upstream call between at values in the same minute', async () => {
    const { GET, menu } = setup();
    const a = `?at=${encodeURIComponent('2026-10-23T18:00:05Z')}`;
    const b = `?at=${Date.parse('2026-10-23T18:00:50Z')}`;
    await Promise.all([GET(req(a)), GET(req(b))]);
    expect(menu).toHaveBeenCalledTimes(1);
    await GET(req(b));
    expect(menu).toHaveBeenCalledTimes(1);
    await GET(req(`?at=${encodeURIComponent('2026-10-23T18:01:00Z')}`));
    expect(menu).toHaveBeenCalledTimes(2);
  });

  it('keeps timed reads apart from the current menu', async () => {
    const { GET, menu } = setup();
    await GET(req());
    await GET(req(AT));
    expect(menu).toHaveBeenCalledTimes(2);
    expect(menu.mock.calls[1]?.[0].ifNoneMatch).toBeUndefined();
    await GET(req());
    await GET(req(AT));
    expect(menu).toHaveBeenCalledTimes(2);
  });

  it('revalidates a timed read after revalidateSeconds with its etag', async () => {
    const { GET, menu } = setup();
    await GET(req(AT));
    vi.advanceTimersByTime(60_000);
    menu.mockResolvedValueOnce({ notModified: true, etag: ETAG });
    expect((await GET(req(AT))).status).toBe(200);
    expect(menu.mock.calls[1]?.[0].ifNoneMatch).toBe(ETAG);
  });

  it('holds at most 100 timed menus, least recently used out first', async () => {
    const { GET, menu } = setup({ maxTimedReadsPerWindow: 1000 });
    const minute = (n: number) => `?at=${Date.parse('2026-10-23T00:00:00Z') + n * 60_000}`;
    for (let n = 0; n <= 100; n++) await GET(req(minute(n)));
    expect(menu).toHaveBeenCalledTimes(101);
    await GET(req(minute(100)));
    expect(menu).toHaveBeenCalledTimes(101);
    await GET(req(minute(0)));
    expect(menu).toHaveBeenCalledTimes(102);
  });

  it('budgets timed Medal reads per window, then answers 503 without calling Medal', async () => {
    const { GET, menu, onError } = setup({ maxTimedReadsPerWindow: 3 });
    const minute = (n: number) => `?at=${Date.parse('2026-10-23T00:00:00Z') + n * 60_000}`;
    for (let n = 0; n < 3; n++) expect((await GET(req(minute(n)))).status).toBe(200);
    const over = await GET(req(minute(3)));
    expect(over.status).toBe(503);
    expect(over.headers.get('cache-control')).toBe('no-store');
    expect((await body(over)).error?.code).toBe('MENU_UNAVAILABLE');
    expect(menu).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    // Cached instants and the current menu are not affected.
    expect((await GET(req(minute(0)))).status).toBe(200);
    expect((await GET(req())).status).toBe(200);
    expect(menu).toHaveBeenCalledTimes(4);
    // A new window opens the budget again.
    vi.advanceTimersByTime(60_000);
    expect((await GET(req(minute(3)))).status).toBe(200);
    expect(menu).toHaveBeenCalledTimes(5);
  });

  it('allows 20 timed Medal reads per window by default', async () => {
    const { GET, menu } = setup();
    const minute = (n: number) => `?at=${Date.parse('2026-10-23T00:00:00Z') + n * 60_000}`;
    for (let n = 0; n < 20; n++) expect((await GET(req(minute(n)))).status).toBe(200);
    expect((await GET(req(minute(20)))).status).toBe(503);
    expect(menu).toHaveBeenCalledTimes(20);
  });

  it('counts a shared timed read once', async () => {
    const { GET, menu } = setup({ maxTimedReadsPerWindow: 1 });
    const responses = await Promise.all([GET(req(AT)), GET(req(AT)), GET(req(AT))]);
    for (const response of responses) expect(response.status).toBe(200);
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('maxTimedReadsPerWindow 0 turns timed reads off', async () => {
    const { GET, menu } = setup({ maxTimedReadsPerWindow: 0 });
    expect((await GET(req(AT))).status).toBe(503);
    expect(menu).not.toHaveBeenCalled();
  });

  it('answers 304 for a timed read too', async () => {
    const { GET } = setup();
    const response = await GET(req(AT, { 'if-none-match': ETAG }));
    expect(response.status).toBe(304);
  });

  it.each([
    '',
    'tomorrow',
    '2026-10-23T18:00:00',
    '2026-10-23t18:00:00z',
    '2026-13-40T99:00:00Z',
    '1'.repeat(17),
    '9999999999999999',
    '1.5',
    new Date(NOW - DAY - 60_000).toISOString(),
    String(NOW + 60 * DAY + 60_000),
    '2026-01-01T00:00:00Z',
  ])('at=%s is a 400 and never reaches upstream', async (at) => {
    const { GET, menu } = setup();
    const response = await GET(req(`?at=${encodeURIComponent(at)}`));
    expect(response.status).toBe(400);
    expect((await body(response)).error?.code).toBe('INVALID_AT');
    expect(menu).not.toHaveBeenCalled();
  });

  it('a failing timed read has no stale menu to fall back on', async () => {
    const { GET, menu } = setup();
    await GET(req(AT));
    vi.advanceTimersByTime(60_000);
    menu.mockRejectedValueOnce(new MedalNetworkError('fetch failed'));
    expect((await GET(req(AT))).status).toBe(502);
  });
});

describe('createMenuRoute — errors', () => {
  const cases: Array<[string, unknown, number, string]> = [
    [
      'ordering not enabled',
      new MedalApiError(403, 'ORDERING_NOT_ENABLED', `no module for ${KEY}`),
      404,
      'ORDERING_NOT_ENABLED',
    ],
    [
      'validation',
      new MedalApiError(400, 'VALIDATION_ERROR', `at out of range ${UPSTREAM}`),
      400,
      'INVALID_REQUEST',
    ],
    ['rate limited', new MedalApiError(429, 'RATE_LIMITED', 'slow down'), 503, 'MENU_UNAVAILABLE'],
    [
      'unauthorised',
      new MedalApiError(401, 'UNAUTHORIZED', `bad key ${KEY}`),
      502,
      'MENU_UNAVAILABLE',
    ],
    [
      'upstream 5xx',
      new MedalApiError(500, 'INTERNAL_ERROR', `boom at ${UPSTREAM}`),
      502,
      'MENU_UNAVAILABLE',
    ],
    ['network', new MedalNetworkError(`fetch ${UPSTREAM} failed`), 502, 'MENU_UNAVAILABLE'],
    ['timeout', new MedalTimeoutError(5000), 502, 'MENU_UNAVAILABLE'],
    ['anything else', new Error(`Bearer ${KEY}`), 502, 'MENU_UNAVAILABLE'],
    ['a bare string', `Bearer ${KEY}`, 502, 'MENU_UNAVAILABLE'],
  ];

  it.each(cases)('%s → %i %s', async (_name, error, status, code) => {
    const { GET, menu, onError } = setup();
    menu.mockRejectedValueOnce(error);
    const response = await GET(req());
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const parsed = await body(response);
    expect(parsed.error?.code).toBe(code);
    expect(typeof parsed.error?.message).toBe('string');
    expect(Object.keys(parsed)).toEqual(['error']);
    expect(Object.keys(parsed.error ?? {}).sort()).toEqual(['code', 'message']);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it.each([
    [
      'a MedalApiError from another SDK copy',
      Object.assign(new Error('x'), {
        name: 'MedalApiError',
        status: 403,
        code: 'ORDERING_NOT_ENABLED',
      }),
      404,
    ],
    [
      'a look-alike with a non-numeric status',
      Object.assign(new Error('x'), {
        name: 'MedalApiError',
        status: '403',
        code: 'ORDERING_NOT_ENABLED',
      }),
      502,
    ],
    [
      'a TimeoutError DOMException',
      new DOMException('The operation timed out.', 'TimeoutError'),
      502,
    ],
  ])('%s', async (_name, error, status) => {
    const { GET, menu } = setup();
    menu.mockRejectedValueOnce(error);
    expect((await GET(req())).status).toBe(status);
  });

  it('a throwing onError never breaks the response', async () => {
    const { GET, menu } = setup({
      onError: () => {
        throw new Error('logger down');
      },
    });
    menu.mockRejectedValueOnce(new MedalNetworkError('x'));
    expect((await GET(req())).status).toBe(502);
  });

  it('works without onError', async () => {
    const menu = vi.fn<MenuFn>(async () => {
      throw new MedalNetworkError('x');
    });
    const GET = createMenuRoute({ apiKey: KEY, medal: { ordering: { menu } } });
    expect((await GET(req())).status).toBe(502);
  });

  it('a missing key is a 500 NOT_CONFIGURED, decided at request time not import', async () => {
    const GET = createMenuRoute({ apiKey: undefined as unknown as string });
    const response = await GET(req());
    expect(response.status).toBe(500);
    expect((await body(response)).error?.code).toBe('NOT_CONFIGURED');
    const blank = createMenuRoute({ apiKey: '   ' });
    expect((await blank(req())).status).toBe(500);
  });
});

describe('createMenuRoute — key never in response', () => {
  async function everyPath(
    GET: (request: Request) => Promise<Response>,
    menu: ReturnType<typeof setup>['menu']
  ) {
    const seen: string[] = [];
    seen.push(await visible(await GET(req())));
    seen.push(await visible(await GET(req('', { 'if-none-match': ETAG }))));
    seen.push(await visible(await GET(req('?c=nope'))));
    seen.push(await visible(await GET(req('?at=nope'))));
    for (const error of [
      new MedalApiError(403, 'ORDERING_NOT_ENABLED', KEY, { key: KEY }),
      new MedalApiError(400, 'VALIDATION_ERROR', KEY, { key: KEY }),
      new MedalApiError(429, 'RATE_LIMITED', KEY),
      new MedalApiError(401, 'UNAUTHORIZED', KEY),
      new MedalApiError(502, 'BAD_GATEWAY', `${UPSTREAM} ${KEY}`),
      new MedalNetworkError(KEY, { cause: new Error(KEY) }),
      new MedalTimeoutError(1, KEY),
      new Error(KEY),
      KEY,
    ]) {
      menu.mockRejectedValueOnce(error);
      seen.push(await visible(await GET(req(AT))));
    }
    return seen;
  }

  it('on success, 304 and every error path', async () => {
    const { GET, menu } = setup();
    const seen = await everyPath(GET, menu);
    expect(seen).toHaveLength(13);
    for (const text of seen) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(UPSTREAM);
      expect(text).not.toContain('Bearer');
      expect(text).not.toMatch(/\bat .+:\d+:\d+/);
    }
  });

  it('through the real SDK client: the key goes upstream only, never back out', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (headers.get('if-none-match') === ETAG) {
        return new Response(null, { status: 304, headers: { etag: ETAG } });
      }
      if (url.includes('channel=delivery')) {
        return new Response(
          JSON.stringify({ error: { code: 'ORDERING_NOT_ENABLED', message: `nope ${KEY}` } }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ data: MENU }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: ETAG },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const GET = createMenuRoute({ apiKey: KEY, baseUrl: UPSTREAM });

    const ok = await GET(req());
    expect(ok.headers.get('etag')).toBe(ETAG);
    const okText = await visible(ok);
    expect(okText).not.toContain(KEY);
    expect(okText).toContain('"etag"');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${UPSTREAM}/api/v1/ordering/menu?channel=takeaway`);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);

    vi.advanceTimersByTime(60_000);
    const revalidated = await GET(req());
    expect(revalidated.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('if-none-match')).toBe(ETAG);

    const disabled = await GET(req('?c=delivery'));
    expect(disabled.status).toBe(404);
    const disabledText = await visible(disabled);
    expect(disabledText).not.toContain(KEY);
    expect(disabledText).not.toContain(UPSTREAM);
  });

  it("defaults to the SDK's Medal origin", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(JSON.stringify({ data: MENU }), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: ETAG },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const GET = createMenuRoute({ apiKey: KEY });
    await GET(req('?c=takeaway'));
    await GET(req('?c=delivery'));
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/io\.medalsocial\.com\/api\/v1\/ordering\/menu/
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
