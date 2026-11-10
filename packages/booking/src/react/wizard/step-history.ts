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
 * Every mark names the VISIT that wrote it (one id per mounted wizard), its
 * step and its depth (entries since the visit's arrival entry, 0).
 *
 * - The step the page opens on tags the entry it arrived on (`replaceState`):
 *   back from there leaves the page, as it always did. A page that opens ON
 *   an entry already marked — a reload, a return from another page or site
 *   with the back button — takes that visit and depth over, so the entries
 *   behind it stay one step each.
 * - A step the visitor moves on to is pushed; the same step again (a
 *   re-render, a restored answer) is not.
 * - Going back in the wizard to a step already behind them in history walks
 *   history back to it (`history.go`), so the two never disagree about what
 *   «back» means. Back to an earlier step that is NOT behind them (the page
 *   opened past it) replaces the current entry, so no later step is ever
 *   left behind an earlier one.
 * - `popstate` moves the wizard to the entry's step when the machine allows
 *   it (`canGoToStep`). An entry of this visit it cannot show is never a dead
 *   press: one behind is passed through to the page before the visit, one
 *   ahead (or any entry while a submission is in flight) sends history back
 *   to where the visitor was. Another visit's entry is passed through.
 * - The booked screen takes the arrival entry over: history is walked back to
 *   it, so back from «booked» leaves the page instead of reopening a form
 *   that has already been sent, and forward into the old form's entries
 *   comes straight back.
 *
 * Invariants (each path below keeps them, so no press is ever dead and no
 * later `history.go` lands on the wrong entry):
 * - While the browser is on one of this visit's entries, `depth.current` is
 *   that entry's mark depth: every popstate of this visit sets it first, and
 *   each `history.go` the hook issues sets it to the target, which that
 *   traversal's popstate then confirms.
 * - A `history.go` is only issued to an entry known to exist: one of this
 *   visit's own (all depths from 0 to the one just left exist), or the page
 *   before the visit — only when the visit's arrival entry has one (`prev`,
 *   recorded in every mark when the arrival entry is first tagged). Never
 *   `go(0)`, which reloads the page. Where no such entry exists, the entry the
 *   browser is on is re-tagged with the step on screen instead.
 */

import { useEffect, useRef } from 'react';
import type { WizardState, WizardStep } from '../../core/machine';

/** Where the wizard's mark sits in `history.state`. */
export const HISTORY_KEY = 'medalBookingStep';

type Screen = WizardStep | 'confirmed';

interface HistoryMark {
  step: Screen;
  /** Entries since the one the visit arrived on (0). */
  depth: number;
  /** The mounted wizard that wrote it. */
  visit: string;
  /**
   * Whether the visit's arrival entry has an entry before it in this tab —
   * false for a tab opened straight on the booking page, where there is
   * nothing to go back to.
   */
  prev: boolean;
}

/** The screens in the order the visitor meets them. */
const FLOW: readonly Screen[] = ['who', 'service', 'when', 'details', 'confirmed'];
const SCREENS: readonly string[] = FLOW;

/** The wizard's mark in a history state, or `null` for an entry that has none. */
export function readHistoryMark(state: unknown): HistoryMark | null {
  if (typeof state !== 'object' || state === null) return null;
  const mark = (state as Record<string, unknown>)[HISTORY_KEY];
  if (typeof mark !== 'object' || mark === null) return null;
  const { step, depth, visit, prev } = mark as Record<string, unknown>;
  if (typeof step !== 'string' || !SCREENS.includes(step)) return null;
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) return null;
  if (typeof visit !== 'string' || visit === '') return null;
  if (typeof prev !== 'boolean') return null;
  return { step: step as Screen, depth, visit, prev };
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
  /** This visit's id; a page opening on an earlier visit's entry takes that one. */
  const visit = useRef('');
  /** Whether this visit's arrival entry has an entry before it (`HistoryMark.prev`). */
  const prev = useRef(false);
  /** The screen at each depth this visit has written (gaps: before a remount). */
  const stack = useRef<Array<Screen | undefined>>([]);
  const depth = useRef(0);
  /** The step a `popstate` asked for that the screen has not shown yet. */
  const pending = useRef<WizardStep | null>(null);
  const latest = useRef(options);
  latest.current = options;

  /** This visit's mark for `step` at `at`. */
  const markFor = (step: Screen, at: number): HistoryMark => ({
    step,
    depth: at,
    visit: visit.current,
    prev: prev.current,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `markFor` reads refs only.
  useEffect(() => {
    if (restoring) return;
    if (pending.current === screen) pending.current = null;
    if (visit.current === '') {
      const arrived = readHistoryMark(window.history.state);
      visit.current = arrived?.visit ?? Math.random().toString(36).slice(2);
      depth.current = arrived?.depth ?? 0;
      // A fresh entry is the newest in the tab (a navigation drops the entries
      // ahead of it), so anything before it is a page: `length > 1` is exact
      // here. A taken-over entry keeps what its visit recorded.
      prev.current = arrived?.prev ?? window.history.length > 1;
      stack.current = [];
      stack.current[depth.current] = screen;
      writeMark('replace', markFor(screen, depth.current));
      return;
    }
    // Already this entry's step: a popstate brought us here, or nothing moved.
    const here = readHistoryMark(window.history.state);
    if (here?.visit === visit.current && here.step === screen && here.depth === depth.current) {
      return;
    }
    if (screen === 'confirmed') {
      const back = depth.current;
      stack.current = ['confirmed'];
      depth.current = 0;
      // The popstate re-tags the arrival entry (see below).
      if (back > 0) window.history.go(-back);
      else writeMark('replace', markFor('confirmed', 0));
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
    // Back to a step that is not behind us in history (the page opened past
    // it, on a link): it takes this entry over. Pushed, it would sit AFTER the
    // later step, and the browser's back would move the wizard forward. The
    // same for «book another» from the booked screen: the new visit's first
    // step takes the booked entry over (it cannot be shown again).
    // A gap (an entry from before a takeover) reads as -1: pushed as before.
    const showing = stack.current[depth.current] as Screen;
    if (FLOW.indexOf(screen) < FLOW.indexOf(showing)) {
      stack.current[depth.current] = screen;
      writeMark('replace', markFor(screen, depth.current));
      return;
    }
    depth.current += 1;
    stack.current = [...stack.current.slice(0, depth.current), screen];
    writeMark('push', markFor(screen, depth.current));
  }, [screen, restoring]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `markFor` reads refs only.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const mark = readHistoryMark(event.state);
      // Not the wizard's entry (a hash link's, the router's own), or the
      // arrival entry not tagged yet (the restore gate still decides): nothing
      // to do — and nothing to write with no visit to write it as.
      if (mark === null || visit.current === '') return;
      const live = latest.current;
      // What is on screen once the step a previous popstate asked for lands.
      const shown: Screen = pending.current ?? live.screen;
      /** The entry the browser is on, as this visit's, showing `shown`. */
      const retag = (at: number) => {
        depth.current = at;
        stack.current[at] = shown;
        writeMark('replace', markFor(shown, at));
      };
      if (mark.visit !== visit.current) {
        // Another visit's entry: on to the one before it, where there is one;
        // the first entry of the tab becomes this visit's arrival instead.
        if (mark.depth > 0 || mark.prev) window.history.go(-1);
        else {
          stack.current = [];
          retag(0);
        }
        return;
      }
      const from = depth.current;
      depth.current = mark.depth;
      /** Back to the entry the visitor just left (it exists: they were on it). */
      const stay = () => {
        if (from === mark.depth) retag(mark.depth);
        else {
          depth.current = from;
          window.history.go(from - mark.depth);
        }
      };
      /** Out of the visit: the page before it, else its arrival entry. */
      const leave = () => {
        if (prev.current) window.history.go(-(mark.depth + 1));
        else if (mark.depth > 0) {
          depth.current = 0;
          window.history.go(-mark.depth);
        } else retag(0);
      };
      if (live.screen === 'confirmed') {
        // Booked: the arrival entry is the booked screen, nothing else is.
        if (mark.depth === 0) {
          stack.current = ['confirmed'];
          retag(0);
        } else {
          depth.current = 0;
          window.history.go(-mark.depth);
        }
        return;
      }
      if (mark.step === shown) {
        stack.current[mark.depth] = mark.step;
        return;
      }
      if (live.restoring || live.submitting) {
        stay();
        return;
      }
      if (mark.step === 'confirmed' || !live.canGoToStep(live.state, mark.step)) {
        // A booking already made, or a step this visit cannot show: behind, the
        // visit is over; ahead, the visitor stays where they were.
        if (mark.depth < from) leave();
        else stay();
        return;
      }
      stack.current[mark.depth] = mark.step;
      pending.current = mark.step;
      live.goToStep(mark.step);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
