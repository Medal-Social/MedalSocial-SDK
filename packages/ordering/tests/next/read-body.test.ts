import { describe, expect, it } from 'vitest';
import { BodyTimeoutError, readBody } from '../../src/next/shared';

/** A body that sends `first` and then never ends. */
function stalled(first: string, signal?: AbortSignal): Request {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(first));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('https://shop.test/api', {
    method: 'POST',
    body,
    duplex: 'half',
    signal,
  } as RequestInit);
  Object.defineProperty(request, 'wasCancelled', { get: () => cancelled });
  return request;
}

describe('readBody', () => {
  it('reads a whole body', async () => {
    const request = new Request('https://shop.test/api', { method: 'POST', body: '{"a":1}' });
    await expect(readBody(request, 100, 1_000)).resolves.toBe('{"a":1}');
  });

  it('gives up on a body still arriving after the deadline, and cancels it', async () => {
    const request = stalled('{"a":');
    await expect(readBody(request, 100, 20)).rejects.toBeInstanceOf(BodyTimeoutError);
    expect((request as unknown as { wasCancelled: boolean }).wasCancelled).toBe(true);
  });

  it('gives up at once when the visitor leaves', async () => {
    const left = new AbortController();
    const request = stalled('{"a":', left.signal);
    const reading = readBody(request, 100, 60_000);
    left.abort();
    await expect(reading).rejects.toBeInstanceOf(BodyTimeoutError);
  });

  it('gives up at once when the visitor left before the read began', async () => {
    const left = new AbortController();
    left.abort();
    await expect(readBody(stalled('{"a":', left.signal), 100, 60_000)).rejects.toBeInstanceOf(
      BodyTimeoutError
    );
  });

  it('answers without waiting for a stream whose cancel never settles', async () => {
    const hanging = (chunks: string[]) =>
      new Request('https://shop.test/api', {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          },
          cancel: () => new Promise<void>(() => {}),
        }),
        duplex: 'half',
      } as RequestInit);
    await expect(readBody(hanging(['{"a":']), 100, 20)).rejects.toBeInstanceOf(BodyTimeoutError);
    await expect(readBody(hanging(['x'.repeat(20)]), 10, 60_000)).resolves.toBeNull();
  });

  it('still answers null for a body over the cap', async () => {
    const request = new Request('https://shop.test/api', { method: 'POST', body: 'x'.repeat(50) });
    await expect(readBody(request, 10, 1_000)).resolves.toBeNull();
  });
});
