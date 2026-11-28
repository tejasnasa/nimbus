/**
 * @module web/components/AuthPerks
 * @description Decorative panel for the signup screen: a slowly rotating
 * outline of the logo mark behind four feature cards, one highlighted at a
 * time on a timer.
 *
 * @important Purely decorative (`aria-hidden`). Under `prefers-reduced-motion`
 * the highlight does not advance and the mark does not rotate.
 */
"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

const PERKS = [
  {
    title: "Live docs and whiteboards",
    text: "Write and draw together, with everyone’s cursor on screen.",
  },
  {
    title: "Chat with @nimbus",
    text: "Ask for a doc or a diagram right from the conversation.",
  },
  {
    title: "Calls with captions",
    text: "Read along in your own language, then get the notes.",
  },
  {
    title: "Free assistant minutes",
    text: "Try the meeting assistant before you add a key.",
  },
];

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mql = window.matchMedia(REDUCED_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** The feature list shown beside the signup form. */
export default function AuthPerks() {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(timer);
  }, [reduced]);

  const active = reduced ? -1 : tick % PERKS.length;

  return (
    <div aria-hidden="true" className="contents">
      <div className="animate-spin-60 absolute size-[900px] opacity-[0.07] motion-reduce:animate-none">
        <svg width="900" height="900" viewBox="0 0 120 120">
          <rect
            x="22"
            y="22"
            width="52"
            height="52"
            rx="14"
            fill="none"
            stroke="var(--violet)"
            strokeWidth="1"
          />
          <rect
            x="46"
            y="46"
            width="52"
            height="52"
            rx="14"
            fill="none"
            stroke="var(--violet)"
            strokeWidth="1"
          />
        </svg>
      </div>
      <div className="relative flex w-full max-w-[460px] flex-col gap-3.5">
        <span className="font-mono text-xs tracking-[0.12em] text-(--violet) uppercase">
          Every workspace comes with
        </span>
        {PERKS.map((perk, i) => {
          const on = i === active;
          return (
            <div
              key={perk.title}
              className={`flex items-start gap-4 rounded-2xl border p-[18px] transition-[background,border-color,transform] duration-500 motion-reduce:transition-none ${
                on
                  ? "-translate-x-1.5 border-(--violet) bg-(--surface-3)"
                  : "border-(--line-2) bg-(--surface-1)"
              }`}
            >
              <span
                className={`flex size-[38px] shrink-0 items-center justify-center rounded-[11px] font-mono text-xs font-bold transition-colors duration-500 motion-reduce:transition-none ${
                  on
                    ? "bg-(--lime) text-(--background)"
                    : "bg-[#1f1b24] text-(--muted-foreground)"
                }`}
              >
                {`0${i + 1}`}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-display text-lg font-semibold">
                  {perk.title}
                </span>
                <span className="text-sm leading-normal text-[#c9c2cc]">
                  {perk.text}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
