/**
 * The wizard's steps in the browser's history, so «back» — the browser's
 * button, an Android back gesture — goes to the previous step instead of
 * leaving the page with the visitor's answers.
 *
 * One entry per step the visitor moves FORWARD to, carried in
 * `history.state` under `HISTORY_KEY` beside whatever the router keeps there
 * (Next's app router copies its own fields into a state it is handed, and
 * passes on one that already has them). The URL never changes, so a deep
 * link (`?tjeneste=`, `?frisor=`, `?kategori=`) is still the page's address
 * and is never read twice.
 *
 * - The step the page opens on tags the entry it arrived on (`replaceState`):
 *   back from there leaves the page, as it always did.
 * - A step the visitor moves on to is pushed; the same step again (a
 *   re-render, a restored answer) is not.
 * - Going back in the wizard to a step already behind them in history walks
 *   history back to it (`history.go`), so the two never disagree about what
 *   «back» means.
 * - `popstate` moves the wizard to the entry's step — when the machine allows
 *   that step (`canGoToStep`); otherwise the entry is re-tagged with the step
 *   still on screen.
 * - The booked screen takes the arrival entry over: history is walked back to
 *   it, so back from «booked» leaves the page instead of reopening a form
 *   that has already been sent.
 */

import { useEffect, useRef } from 'react';
import type { WizardState, WizardStep } from '../../core/machine';

/** Where the wizard's mark sits in `history.state`. */
export const HISTORY_KEY = 'medalBookingStep';

type Screen = WizardStep | 'confirmed';

interface HistoryMark {
  step: Screen;
  /** Entries since the one the wizard arrived on (0). */
  depth: number;
}

const SCREENS: readonly string[] = ['who', 'service', 'when', 'details', 'confirmed'];

/** The wizard's mark in a history state, or `null` for an entry that has none. */
export function readHistoryMark(state: unknown): HistoryMark | null {
  if (typeof state !== 'object' || state === null) return null;
  const mark = (state as Record<string, unknown>)[HISTORY_KEY];
  if (typeof mark !== 'object' || mark === null) return null;
  const { step, depth } = mark as Record<string, unknown>;
  if (typeof step !== 'string' || !SCREENS.includes(step)) return null;
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) return null;
  return { step: step as Screen, depth };
}

function writeMark(mode: 'push' | 'replace', mark: HistoryMark): void {
  const current: unknown = window.history.state;
  // Kept: the router's own fields live in the same object.
  const base = typeof current === 'object' && current !== null ? current : {};
  const next = { ...base, [HISTORY_KEY]: mark };
  if (mode === 'push') window.history.pushState(next, '');
  else window.history.replaceState(next, '');
}

export interface StepHistoryOptions {
  /** The screen on show now. */
  screen: Screen;
  /** The restore gate still decides which screen that is: nothing is written. */
  restoring: boolean;
  state: WizardState;
  /** A submission in flight: the form stays on screen. */
  submitting: boolean;
  canGoToStep: (state: WizardState, step: WizardStep) => boolean;
  goToStep: (step: WizardStep) => void;
}

export function useStepHistory(options: StepHistoryOptions): void {
  const { screen, restoring } = options;
  /** The screen at each depth this page has written. */
  const stack = useRef<Screen[]>([]);
  const depth = useRef(0);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (restoring) return;
    if (stack.current.length === 0) {
      stack.current = [screen];
      depth.current = 0;
      writeMark('replace', { step: screen, depth: 0 });
      return;
    }
    // Already this entry's step: a popstate brought us here, or nothing moved.
    const here = readHistoryMark(window.history.state);
    if (here !== null && here.step === screen && here.depth === depth.current) return;
    if (screen === 'confirmed') {
      const back = depth.current;
      stack.current = ['confirmed'];
      depth.current = 0;
      // The popstate re-tags the arrival entry (see below).
      if (back > 0) window.history.go(-back);
      else writeMark('replace', { step: 'confirmed', depth: 0 });
      return;
    }
    // `lastIndexOf` reads a negative start from the end: nothing is behind depth 0.
    const behind = depth.current === 0 ? -1 : stack.current.lastIndexOf(screen, depth.current - 1);
    if (behind !== -1) {
      const delta = behind - depth.current;
      depth.current = behind;
      window.history.go(delta);
      return;
    }
    depth.current += 1;
    stack.current = [...stack.current.slice(0, depth.current), screen];
    writeMark('push', { step: screen, depth: depth.current });
  }, [screen, restoring]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const mark = readHistoryMark(event.state);
      if (mark === null) return;
      const live = latest.current;
      depth.current = mark.depth;
      const keep = () => {
        stack.current[mark.depth] = live.screen;
        writeMark('replace', { step: live.screen, depth: mark.depth });
      };
      if (mark.step === live.screen) return;
      if (
        live.screen === 'confirmed' ||
        mark.step === 'confirmed' ||
        live.restoring ||
        live.submitting ||
        !live.canGoToStep(live.state, mark.step)
      ) {
        keep();
        return;
      }
      live.goToStep(mark.step);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
