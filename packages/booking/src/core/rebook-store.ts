/**
 * The child's name a «Bestill igjen» card hands the wizard — carried in the
 * tab's `sessionStorage`, never in the URL.
 *
 * The service and stylist ids ride in the query string because they are
 * catalogue ids and a parent may as well see them; a child's name is personal
 * data about a minor, and a query string is copied into browser history, the
 * edge access log and every analytics pageview that records `location`.
 * `sessionStorage` is none of those: one tab, gone with it, read once.
 *
 * Read-once (`take`) so a name stashed for one rebook cannot resurface on a
 * later, unrelated visit to `/bestill` in the same tab.
 *
 * Every path falls back to «nothing stashed» rather than throwing — no
 * storage during the server render, Safari private mode, storage turned off —
 * because the worst case is a parent typing a name they have typed before.
 */
/** `<namespace>:booking:rebook-who`. */
export function rebookStorageKey(namespace: string): string {
  return `${namespace}:booking:rebook-who`;
}

export interface RebookStore {
  stashRebookWho(name: string | null): void;
  takeRebookWho(): string | null;
}

/** The «book again» name under `<namespace>:booking:rebook-who`. */
export function createRebookStore(namespace: string): RebookStore {
  const STORAGE_KEY = rebookStorageKey(namespace);

  /**
   * Every tap REPLACES what is stashed — `null` clears it — so a name left
   * behind by an earlier tap that opened its wizard in another tab (Cmd-click)
   * cannot be picked up by a later tap for a booking that named nobody, and
   * prefill the wrong child.
   */
  function stashRebookWho(name: string | null): void {
    if (typeof window === 'undefined') return;
    try {
      if (name === null) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      window.sessionStorage.setItem(STORAGE_KEY, name);
    } catch {
      // The wizard simply asks for the name.
    }
  }

  function takeRebookWho(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const name = window.sessionStorage.getItem(STORAGE_KEY);
      window.sessionStorage.removeItem(STORAGE_KEY);
      return name !== null && name.trim().length > 0 ? name : null;
    } catch {
      return null;
    }
  }

  return { stashRebookWho, takeRebookWho };
}
