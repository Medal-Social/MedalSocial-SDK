/**
 * «Neste ledige» is shared by every component on the page, but only briefly:
 * a minute at most, never past the time it quotes, and a failure is retried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNextFree, NEXT_FREE_TTL_MS } from '../../src/core/next-free';
import { PARITY_CONFIG } from '../support/parity-config';

const { fetchNextFree, resetNextFree } = createNextFree(PARITY_CONFIG);

const fetchMock = vi.fn();
const answer = (startTs: number) =>
  new Response(JSON.stringify({ startTs, label: 'i dag 11:00' }), { status: 200 });

beforeEach(() => {
  resetNextFree();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchNextFree', () => {
  it('shares one answer while it is fresh, and asks again once its minute is up', async () => {
    const now = Date.now();
    fetchMock.mockImplementation(() => Promise.resolve(answer(now + 3_600_000)));
    await fetchNextFree(now);
    await fetchNextFree(now + 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchNextFree(now + NEXT_FREE_TTL_MS + 5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never keeps an answer past the time it quotes', async () => {
    const now = Date.now();
    fetchMock.mockImplementation(() => Promise.resolve(answer(now + 10_000)));
    await fetchNextFree(now);
    await fetchNextFree(now + 20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries after a failure instead of keeping it', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await fetchNextFree()).toBeNull();
    fetchMock.mockImplementation(() => Promise.resolve(answer(Date.now() + 3_600_000)));
    expect(await fetchNextFree()).toMatchObject({ label: 'i dag 11:00' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
