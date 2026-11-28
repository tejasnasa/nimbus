/**
 * @module web/components/landing/useTick
 * @description A shared clock for the landing page's animated product
 * previews: a counter that advances on an interval, plus whether motion is
 * allowed at all.
 *
 * @important When the visitor prefers reduced motion the counter never starts
 *            and `animate` is `false`; previews then render their finished
 *            state instead of freezing partway through a sequence. The first
 *            render on the server and in the browser is always `tick: 0,
 *            animate: true`, so hydration matches and the preference is
 *            applied immediately after.
 */
"use client";
import { useEffect, useState } from "react";

/**
 * @param intervalMs - Milliseconds between ticks.
 * @returns The current tick, and whether the preview should animate.
 */
export function useTick(intervalMs = 850): { tick: number; animate: boolean } {
  const [tick, setTick] = useState(0);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimate(false);
      return;
    }
    const timer = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return { tick, animate };
}
