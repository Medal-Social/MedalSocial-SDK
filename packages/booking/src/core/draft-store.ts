/**
 * The half-built booking a Vipps login leaves behind, kept for the length of
 * one round trip.
 *
 * The login sheet offers «Fortsett med Vipps», and Vipps is a whole navigation away:
 * the browser goes to Medal, then to Vipps, then back to `/min-side/vipps`,
 * which hands it on to wherever the login said it started. Every answer the
 * parent has given by then — the service, the stylist, the hour — lives in a
 * `useReducer` in a component that no longer exists. Without this they come
 * back logged in to an empty step 1, which is a worse experience than never
 * having been offered the login.
 *
 * `sessionStorage`, for the same reasons `rebook-store.ts` uses it: one tab,
 * gone with it, and never in a URL. The draft carries a child's NAME, which is
 * personal data about a minor — a query string is copied into browser history,
 * the edge access log and every analytics pageview that records `location`, and
 * this is not.
 *
 * Read-once, like the rebook stash and for the same reason: a draft that
 * survived its login would rebuild an abandoned booking on the parent's next
 * visit to `/bestill` in the same tab.
 *
 * IDS AND INSTANTS ONLY. Nothing here is trusted on the way back in: the
 * service ids are looked up in the catalogue the page just fetched, and the
 * restore runs through the machine's own actions, so a draft naming a service
 * the salon has since retired rebuilds nothing rather than a basket the wizard
 * could not have produced by tapping.
 *
 * Every path falls back to «no draft» rather than throwing — no storage during
 * the server render, Safari private mode, storage turned off — because the
 * worst case is a parent answering three questions they had answered once.
 */

/** `<namespace>:booking:draft`. A storage key, not a credential. */
export function draftStorageKey(namespace: string): string {
  return `${namespace}:booking:draft`;
}

/** How long a draft is worth restoring. A Vipps login is a phone unlock and a
 * confirmation; anything older than this is a tab left open over lunch, and the
 * hour in it has very likely gone. A draft dated in the future is refused
 * outright — see `asDraft`. */
export const DRAFT_MAX_AGE_MS = 30 * 60 * 1000;

/** One line item, as little of it as a rebuild needs. */
export interface WizardDraftItem {
  serviceId: string;
  /**
   * The rest of the person's visit after `serviceId`, in order. Absent for a
   * one-service line (and in a draft written before visits had extras), never
   * `[]`. Ids only, like `serviceId`: a restore looks each one up again.
   */
  extraServiceIds?: string[];
  bookedForName: string | null;
  bookedForBirthYear: number | null;
  /**
   * A grown-up's line (`true`) or a child's (`false`); `null` in a draft
   * written before the field existed. A restore reseats a guest from it, so a
   * parent who changed «Voksen» to «1 barn» comes back from Vipps as they left,
   * not as the link they arrived on said.
   */
  adult?: boolean | null;
  /**
   * The saved child the line was for (`bookedForPersonId`); `null` for a guest
   * or a draft written before the field existed. Never trusted on the way
   * back: a restore reseats it only when the logged-in parent's own family has
   * a child with this id.
   */
  personId?: string | null;
}

export interface WizardDraft {
  items: WizardDraftItem[];
  /** The visitor's preference — `null` is «Første ledige». */
  resourceId: string | null;
  partyMode: 'sequential' | 'parallel';
  startTs: number | null;
  /** Who the chosen slot resolved to, which is what gets submitted. */
  resolvedResourceId: string | null;
  /** One stylist per line item, for a party; `null` for everything else. */
  partyResourceIds: string[] | null;
  /** When it was written, so a stale tab does not resurrect last week's hour. */
  savedAt: number;
}

/** The most extras a line can carry — the engine's own ceiling. */
const MAX_DRAFT_EXTRAS = 3;

/**
 * A line's extras, or `null` to drop the field: anything but a short list of
 * non-empty strings is a jar somebody edited, and the line is still worth
 * restoring as its one service — without the hour, which was chosen for the
 * longer visit (see `asDraft`).
 */
function asExtraServiceIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DRAFT_EXTRAS) return null;
  return value.every((id) => typeof id === 'string' && id.length > 0) ? [...value] : null;
}

/** The shape check, done here so nothing downstream has to trust the jar. */
function asDraft(value: unknown, now: number): WizardDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const draft = value as Partial<WizardDraft>;
  // Both ends of the window. A draft older than the lifetime is a tab left open
  // over lunch — and one stamped in the FUTURE is a clock that has since been
  // corrected backwards, whose negative age would pass an «older than» check
  // indefinitely and resurrect an obsolete hour hours later.
  if (typeof draft.savedAt !== 'number') return null;
  const age = now - draft.savedAt;
  if (age < 0 || age > DRAFT_MAX_AGE_MS) return null;
  if (!Array.isArray(draft.items) || draft.items.length === 0) return null;
  const items: WizardDraftItem[] = [];
  // Whether every line's visit survived the check whole. A dropped extra makes
  // the visit shorter than the one the stored hour was chosen for.
  let visitsWhole = true;
  for (const item of draft.items) {
    if (typeof item?.serviceId !== 'string' || item.serviceId.length === 0) return null;
    const extraServiceIds = asExtraServiceIds(item.extraServiceIds);
    if (item.extraServiceIds !== undefined && extraServiceIds === null) visitsWhole = false;
    items.push({
      serviceId: item.serviceId,
      ...(extraServiceIds === null ? {} : { extraServiceIds }),
      bookedForName: typeof item.bookedForName === 'string' ? item.bookedForName : null,
      bookedForBirthYear:
        typeof item.bookedForBirthYear === 'number' && Number.isFinite(item.bookedForBirthYear)
          ? item.bookedForBirthYear
          : null,
      adult: typeof item.adult === 'boolean' ? item.adult : null,
      personId:
        typeof item.personId === 'string' && item.personId.length > 0 ? item.personId : null,
    });
  }
  const partyResourceIds =
    Array.isArray(draft.partyResourceIds) &&
    draft.partyResourceIds.every((id) => typeof id === 'string')
      ? draft.partyResourceIds
      : null;
  return {
    items,
    resourceId: typeof draft.resourceId === 'string' ? draft.resourceId : null,
    partyMode: draft.partyMode === 'parallel' ? 'parallel' : 'sequential',
    startTs: visitsWhole && typeof draft.startTs === 'number' ? draft.startTs : null,
    resolvedResourceId:
      typeof draft.resolvedResourceId === 'string' ? draft.resolvedResourceId : null,
    partyResourceIds,
    savedAt: draft.savedAt,
  };
}

export interface DraftStore {
  readonly DRAFT_STORAGE_KEY: string;
  stashDraft(draft: Omit<WizardDraft, 'savedAt'>, now?: number): void;
  takeDraft(now?: number): WizardDraft | null;
  clearDraft(): void;
}

/** The draft store under `<namespace>:booking:draft`. */
export function createDraftStore(namespace: string): DraftStore {
  const STORAGE_KEY = draftStorageKey(namespace);

  /** Write the draft, replacing whatever was there. One tab holds one booking. */
  function stashDraft(draft: Omit<WizardDraft, 'savedAt'>, now: number = Date.now()): void {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, savedAt: now }));
    } catch {
      // The parent answers the three questions again. Nothing is lost that was
      // not already only in a browser tab.
    }
  }

  /** The draft, and it is gone afterwards. */
  function takeDraft(now: number = Date.now()): WizardDraft | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      window.sessionStorage.removeItem(STORAGE_KEY);
      if (raw === null) return null;
      return asDraft(JSON.parse(raw), now);
    } catch {
      // A malformed value has already been removed above where it could be.
      return null;
    }
  }

  /** Forget any draft, for a booking that has been made or abandoned. */
  function clearDraft(): void {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do: a draft that cannot be removed also could not be written.
    }
  }

  return { DRAFT_STORAGE_KEY: STORAGE_KEY, stashDraft, takeDraft, clearDraft };
}
