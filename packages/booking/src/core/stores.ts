/**
 * The three browser stores the wizard keeps, under one namespace.
 *
 * Keys are `<namespace>:booking:draft`, `<namespace>:booking:attempt` and
 * `<namespace>:booking:rebook-who` — so a site moving onto the package keeps
 * every draft and pending attempt a visitor already has, by passing the
 * namespace it used before.
 */

import { type AttemptStore, createAttemptStore } from './attempt-store';
import { createDraftStore, type DraftStore } from './draft-store';
import { createRebookStore, type RebookStore } from './rebook-store';

export type Stores = DraftStore & AttemptStore & RebookStore;

export function createStores(namespace: string): Stores {
  return {
    ...createDraftStore(namespace),
    ...createAttemptStore(namespace),
    ...createRebookStore(namespace),
  };
}
