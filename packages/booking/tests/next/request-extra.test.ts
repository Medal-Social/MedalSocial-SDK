import { describe, expect, it } from 'vitest';
import { isCrossOriginRequest, readBoundedText } from '../../src/next/request';

/**
 * The defensive halves of the request guards, which a real `Request` never
 * reaches in Node: a request URL that will not parse, a runtime that exposes
 * no body stream, and a stream that hands over an empty read.
 */

describe('isCrossOriginRequest — a request whose own URL will not parse', () => {
  it('is somebody else’s', () => {
    const request = {
      url: 'not a url',
      headers: new Headers({ origin: 'https://salong.example' }),
    } as unknown as Request;

    expect(isCrossOriginRequest(request)).toBe(true);
  });
});

describe('readBoundedText — no body stream', () => {
  const bodiless = (text: string) => ({ body: null, text: async () => text }) as unknown as Request;

  it('reads the text when it fits', async () => {
    await expect(readBoundedText(bodiless('{"a":1}'), 100)).resolves.toBe('{"a":1}');
  });

  it('holds the text to the same ceiling, in bytes', async () => {
    // 3 characters, 6 bytes.
    await expect(readBoundedText(bodiless('øøø'), 5)).resolves.toBeNull();
  });

  it('reads a real request without a body as empty', async () => {
    await expect(readBoundedText(new Request('https://salong.example/'), 10)).resolves.toBe('');
  });
});

describe('readBoundedText — an empty read', () => {
  it('skips it and keeps reading', async () => {
    const stream = new ReadableStream<Uint8Array | undefined>({
      start(controller) {
        controller.enqueue(undefined);
        controller.enqueue(new TextEncoder().encode('ok'));
        controller.close();
      },
    });
    const request = { body: stream } as unknown as Request;

    await expect(readBoundedText(request, 10)).resolves.toBe('ok');
  });
});
