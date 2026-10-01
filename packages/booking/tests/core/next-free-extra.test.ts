import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNextFree } from '../../src/core/next-free';
import { PARITY_CONFIG } from '../support/parity-config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createNextFree', () => {
  it('asks this site’s own endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createNextFree(PARITY_CONFIG);
    expect(client.endpoint).toBe('/api/booking/next-free');
    expect(await client.fetchNextFree()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/booking/next-free');
  });

  it('answers null, and keeps nothing, when the request itself fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createNextFree(PARITY_CONFIG);
    expect(await client.fetchNextFree()).toBeNull();
    expect(await client.fetchNextFree()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares nothing between two clients', async () => {
    const startTs = Date.now() + 3_600_000;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ startTs, label: 'i dag 11:00' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    await createNextFree(PARITY_CONFIG).fetchNextFree();
    await createNextFree(PARITY_CONFIG).fetchNextFree();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
