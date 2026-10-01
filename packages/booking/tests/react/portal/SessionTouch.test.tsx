import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_TOUCH_THROTTLE_MS,
  sessionTouchKey,
  SessionTouch as Touch,
} from '../../../src/react/portal/SessionTouch';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * The browser half of session renewal: one `POST /api/portal/session/touch`
 * per Min side load, at most once an hour per browser (the stamp is in
 * `localStorage`, shared by every tab), and the stamp is written only when the
 * touch actually renewed — a 401 or a 503 leaves the next load free to try.
 */

const SESSION_TOUCH_KEY = sessionTouchKey(PARITY_CONFIG.storageNamespace);
const SessionTouch = () => <Touch config={PARITY_CONFIG} />;

const NOW = Date.UTC(2026, 9, 5, 12);
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SessionTouch', () => {
  it('renders nothing', () => {
    const { container } = render(<SessionTouch />);
    expect(container).toBeEmptyDOMElement();
  });

  it('touches once and stamps the time when the session was renewed', async () => {
    render(<SessionTouch />);

    await waitFor(() => expect(window.localStorage.getItem(SESSION_TOUCH_KEY)).toBe(String(NOW)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/portal/session/touch', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it('does not touch again within the hour', () => {
    window.localStorage.setItem(SESSION_TOUCH_KEY, String(NOW - SESSION_TOUCH_THROTTLE_MS + 1000));
    render(<SessionTouch />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('touches again once the hour is up', async () => {
    window.localStorage.setItem(SESSION_TOUCH_KEY, String(NOW - SESSION_TOUCH_THROTTLE_MS - 1));
    render(<SessionTouch />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('ignores a stamp from the future or one that is not a number', async () => {
    window.localStorage.setItem(SESSION_TOUCH_KEY, 'soon');
    const { unmount } = render(<SessionTouch />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();

    window.localStorage.setItem(SESSION_TOUCH_KEY, String(NOW + 10 * SESSION_TOUCH_THROTTLE_MS));
    render(<SessionTouch />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it.each([401, 503])('leaves no stamp when the touch answered %i', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    render(<SessionTouch />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(window.localStorage.getItem(SESSION_TOUCH_KEY)).toBeNull();
  });

  it('swallows a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SessionTouch />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(SESSION_TOUCH_KEY)).toBeNull();
  });

  it('still touches when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    render(<SessionTouch />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
