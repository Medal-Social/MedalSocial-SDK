import { useEffect } from 'react';
import type { BookingConfig } from '../../core/config';

/**
 * Keeps the visitor's login alive while they use the portal. Renders nothing;
 * on mount it asks `POST <portalApi>/session/touch` to rewrite the session
 * cookie to the life the backend has just given the session — at most once an
 * hour per browser, because the backend slides a session at most hourly. The
 * stamp (a time, never a credential) lives in `localStorage`, shared by every
 * tab, and is written only after a 204: a 401 or a failure leaves the next
 * load free to try. No storage means a touch per load, which is still right.
 */

export const SESSION_TOUCH_THROTTLE_MS = 60 * 60 * 1000;

/** `<namespace>:portal-session-touched-at`. */
export function sessionTouchKey(namespace: string): string {
  return `${namespace}:portal-session-touched-at`;
}

export function SessionTouch({
  config,
}: {
  config: Pick<BookingConfig, 'paths' | 'storageNamespace'>;
}) {
  const key = sessionTouchKey(config.storageNamespace);
  const path = `${config.paths.portalApi}/session/touch`;
  useEffect(() => {
    const now = Date.now();
    try {
      const stamp = Number(window.localStorage.getItem(key));
      // A stamp in the future is a clock that moved, not a reason to wait.
      if (Number.isFinite(stamp) && stamp <= now && now - stamp < SESSION_TOUCH_THROTTLE_MS) return;
    } catch {
      // Unreadable storage: touch.
    }
    fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        if (response.status === 204) window.localStorage.setItem(key, String(now));
      })
      // Offline, a blocked request or unwritable storage: nothing to say.
      .catch(() => undefined);
  }, [key, path]);
  return null;
}
