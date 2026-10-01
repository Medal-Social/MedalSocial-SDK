import { describe, expect, it } from 'vitest';
import { isCrossOriginRequest, originFromHeaders, readBoundedText } from '../../src/next/request';

function post(headers: Record<string, string>): Request {
  return new Request('https://salong.example/api/booking/barnehage/register', {
    method: 'POST',
    headers,
  });
}

describe('isCrossOriginRequest', () => {
  it('accepts a submission the site made of itself', () => {
    expect(isCrossOriginRequest(post({ origin: 'https://salong.example' }))).toBe(false);
  });

  it('refuses a submission another site made on a visitor behalf', () => {
    expect(isCrossOriginRequest(post({ origin: 'https://evil.example' }))).toBe(true);
  });

  it('reads the host the browser typed, not the last hop', () => {
    const request = new Request('https://salong-worker.internal/api/booking/barnehage/register', {
      method: 'POST',
      headers: {
        origin: 'https://salong.example',
        'x-forwarded-host': 'salong.example',
        'x-forwarded-proto': 'https',
      },
    });
    expect(isCrossOriginRequest(request)).toBe(false);
  });

  it('falls back to the referring page when there is no Origin', () => {
    expect(
      isCrossOriginRequest(post({ referer: 'https://salong.example/barnehage/eksempel' }))
    ).toBe(false);
    expect(isCrossOriginRequest(post({ referer: 'https://evil.example/embed' }))).toBe(true);
  });

  it('refuses an Origin it cannot read as one — `null` from a sandboxed frame included', () => {
    expect(isCrossOriginRequest(post({ origin: 'null' }))).toBe(true);
    expect(isCrossOriginRequest(post({ origin: 'not a url' }))).toBe(true);
  });

  /**
   * DELIBERATE. Origin validation stops a page on ANOTHER origin from
   * submitting on a visitor's behalf; it does not stop a script, which sets
   * whatever header it likes. Refusing a request that declares no origin would
   * therefore buy no protection from the case this guard exists for, while
   * costing a haircut to a parent behind a proxy that strips both headers. The
   * per-IP limit and the honeypot answer the header-less caller instead.
   */
  it('lets a request that declares no origin through, to the rest of the guard', () => {
    expect(isCrossOriginRequest(post({}))).toBe(false);
  });
});

/**
 * The ceiling has to be measured in the unit it is written in.
 *
 * A JavaScript string's `.length` is UTF-16 code units, and a UTF-8 request
 * body is bytes: «ø» is one unit and two bytes, an emoji is two units and
 * four. Comparing the decoded string's length against a byte limit therefore
 * lets a body four times the ceiling through — and only for the payloads most
 * likely to be hostile.
 */
describe('readBoundedText', () => {
  function streamed(bytes: Uint8Array, chunkSize = 16): Request {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += chunkSize) {
          controller.enqueue(bytes.slice(at, at + chunkSize));
        }
        controller.close();
      },
    });
    return new Request('https://salong.example/api/booking/barnehage/register', {
      method: 'POST',
      body: stream,
      // Node will not accept a stream body without it, and a stream is the
      // only way to build a request that declares no length.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
  }

  it('returns the body when it fits', async () => {
    const bytes = new TextEncoder().encode('{"childName":"Emil"}');
    await expect(readBoundedText(streamed(bytes), 1024)).resolves.toBe('{"childName":"Emil"}');
  });

  it('counts bytes, not code units — the multibyte body over the ceiling is refused', async () => {
    // 400 emoji: 800 UTF-16 code units, 1600 bytes. A `.length` check against
    // 1000 would have let this through.
    const bytes = new TextEncoder().encode('🙂'.repeat(400));
    expect(bytes.byteLength).toBeGreaterThan(1000);
    await expect(readBoundedText(streamed(bytes), 1000)).resolves.toBeNull();
  });

  it('keeps a multibyte body that really does fit', async () => {
    const norwegian = 'Små barn bør klippes forsiktig. ';
    const bytes = new TextEncoder().encode(norwegian);
    await expect(readBoundedText(streamed(bytes), 1000)).resolves.toBe(norwegian);
  });

  /** The point of reading it in pieces: the ceiling is reached and the rest is
   * never taken, rather than the whole body being buffered and then judged. */
  it('stops reading at the ceiling instead of buffering the whole body', async () => {
    let delivered = 0;
    const chunk = new Uint8Array(64);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        delivered += 1;
        // Far more than the ceiling, so a reader that does not stop will spin
        // through all of it.
        if (delivered > 200) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const request = new Request('https://salong.example/api/booking/barnehage/register', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readBoundedText(request, 256)).resolves.toBeNull();
    // 256 bytes is four 64-byte chunks; a handful more is scheduling slack, a
    // hundred is "read the whole thing first".
    expect(delivered).toBeLessThan(20);
  });

  it('reads an empty body as an empty string, not as an overflow', async () => {
    await expect(readBoundedText(streamed(new Uint8Array()), 1000)).resolves.toBe('');
  });
});

/**
 * `originFromHeaders` — the origin a Server Action was reached on, for code
 * that has no `Request` to read it from. The forwarded headers win, a bare
 * host is assumed HTTPS unless it is local, and anything unusable falls back
 * to the canonical URL rather than guessing.
 */

const FALLBACK = 'https://salong.example';

function headers(entries: Record<string, string>) {
  return new Headers(entries);
}

describe('originFromHeaders', () => {
  it('prefers x-forwarded-host and x-forwarded-proto', () => {
    expect(
      originFromHeaders(
        headers({
          host: 'internal:8787',
          'x-forwarded-host': 'preview.salong.example',
          'x-forwarded-proto': 'https',
        }),
        FALLBACK
      )
    ).toBe('https://preview.salong.example');
  });

  it('assumes https for a bare non-local host', () => {
    expect(originFromHeaders(headers({ host: 'salong.example' }), FALLBACK)).toBe(
      'https://salong.example'
    );
  });

  it('keeps http for localhost', () => {
    expect(originFromHeaders(headers({ host: 'localhost:3000' }), FALLBACK)).toBe(
      'http://localhost:3000'
    );
  });

  it('takes the first entry of a comma-joined forwarded header', () => {
    expect(
      originFromHeaders(
        headers({
          'x-forwarded-host': 'salong.example, proxy.internal',
          'x-forwarded-proto': 'https, http',
        }),
        FALLBACK
      )
    ).toBe('https://salong.example');
  });

  it('falls back when there is no host at all, or an unparsable one', () => {
    expect(originFromHeaders(headers({}), FALLBACK)).toBe(FALLBACK);
    expect(originFromHeaders(headers({ host: 'not a host' }), FALLBACK)).toBe(FALLBACK);
  });

  it('never keeps a path or query from the fallback', () => {
    expect(originFromHeaders(headers({ host: 'salong.example' }), 'https://x.test/path?q=1')).toBe(
      'https://salong.example'
    );
  });
});
