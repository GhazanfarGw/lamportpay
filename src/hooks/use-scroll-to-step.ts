import { useEffect, useRef } from "react";

/**
 * Scrolls `ref` into view when `step` changes (not on first render), so the
 * action the user must take next is on screen after a step completes. Skipped
 * when the element is already fully visible.
 */
export function useScrollToStep(step: string, ref: { current: HTMLElement | null }) {
  const previous = useRef(step);
  useEffect(() => {
    if (previous.current === step) return;
    previous.current = step;
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.top >= 72 && box.bottom <= window.innerHeight) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: window.scrollY + box.top - 88, behavior: reduce ? "auto" : "smooth" });
  }, [step, ref]);
}
