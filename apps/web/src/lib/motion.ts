'use client';

/**
 * Motion — every animation in the app goes through here so it is consistent and can be turned off.
 * With prefers-reduced-motion everything snaps to its end state (GSAP helpers check `reducedMotion()`,
 * Motion components get `<MotionConfig reducedMotion="user">` from the app layout).
 *
 * Who animates what (docs/ui.md → "Motion และลูกเล่น"):
 *   CSS     hover / press / focus, colour and shadow changes — no JavaScript
 *   Motion  anything tied to React state: enter / exit (AnimatePresence), cards moving between lanes (`layout`),
 *           a highlight that slides to the selected item (`layoutId`), dialogs and sheets — springs from `SPRING`
 *   GSAP    choreography on existing DOM: page entrance, list stagger, count-up numbers, bars, the flow stepper,
 *           "AI filled these fields" — timelines from the helpers below
 * Only transform and opacity (and filter: blur for entrances) are animated; nothing runs longer than ~0.9 s.
 */
import gsap from 'gsap';
import { useLayoutEffect, useEffect, type RefObject } from 'react';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fade/slide children of `ref` matching `selector` in a short stagger when `deps` change. */
export function useReveal(ref: RefObject<HTMLElement | null>, selector: string, deps: unknown[] = []) {
  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll(selector);
    if (!targets.length || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(targets, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.42, ease: 'power3.out', stagger: { each: 0.035, from: 'start' }, clearProps: 'transform,opacity' });
    }, root);
    return () => ctx.revert();
  }, deps);
}

/** Animate a number from 0 to `to`, writing the formatted value into `el`. */
export function countUp(el: HTMLElement, to: number, format: (n: number) => string) {
  if (reducedMotion() || !Number.isFinite(to)) { el.textContent = format(to); return; }
  const obj = { n: 0 };
  gsap.to(obj, { n: to, duration: 1.1, ease: 'power2.out', onUpdate: () => { el.textContent = format(Math.round(obj.n * 100) / 100); }, onComplete: () => { el.textContent = format(to); } });
}

/** Grow elements from their left edge (bars, progress lines). */
export function growX(targets: Element[] | NodeListOf<Element>, opts: { delay?: number } = {}) {
  if (reducedMotion() || !targets.length) return;
  gsap.fromTo(targets, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: 'power3.out', stagger: 0.05, delay: opts.delay ?? 0.1, transformOrigin: 'left center' });
}

/** Page entrance used by the app template on every navigation. */
export function enterPage(el: HTMLElement) {
  if (reducedMotion()) return;
  gsap.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'transform,opacity' });
}

export { gsap };

/** Motion springs and transitions shared by every component (import these, don't invent new curves). */
export const SPRING = {
  /** cards, highlights, panels — quick with a little settle */
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 },
  /** sheets and dialogs coming in */
  soft: { type: 'spring', stiffness: 300, damping: 30 },
  /** a check mark or a badge popping in */
  pop: { type: 'spring', stiffness: 600, damping: 20 },
} as const;

/**
 * Motion variants for a staggered "blur in" of a panel's children (the success panel, detail facts):
 * parent `variants={STAGGER.parent}` initial="hidden" animate="show", each child `variants={STAGGER.item}`.
 */
export const STAGGER = {
  parent: { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } } },
  item: {
    hidden: { opacity: 0, y: 8, filter: 'blur(6px)' },
    show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
  },
} as const;

/**
 * "AI filled these": a soft violet glow runs down the inputs the AI just filled, one after another, then fades.
 * Pass the inputs in reading order (FormView finds them by `[data-field]` / `tr[data-line]`).
 */
export function aiFilledGlow(inputs: HTMLElement[]) {
  if (!inputs.length || reducedMotion()) return;
  gsap.fromTo(inputs,
    { boxShadow: '0 0 0 0 rgba(139, 92, 246, 0)', backgroundColor: 'rgba(139, 92, 246, 0)' },
    { keyframes: [
      { boxShadow: '0 0 0 4px rgba(139, 92, 246, .30)', backgroundColor: 'rgba(139, 92, 246, .09)', duration: 0.28, ease: 'power2.out' },
      { boxShadow: '0 0 0 0 rgba(139, 92, 246, 0)', backgroundColor: 'rgba(139, 92, 246, 0)', duration: 1, ease: 'power2.inOut' },
    ], stagger: 0.07, clearProps: 'boxShadow,backgroundColor' });
}
