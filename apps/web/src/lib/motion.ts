'use client';

/**
 * Motion — every animation in the app goes through here so it is consistent and can be turned off.
 * GSAP runs only in the browser; with prefers-reduced-motion everything snaps to its end state.
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
