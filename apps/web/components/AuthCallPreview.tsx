/**
 * @module web/components/AuthCallPreview
 * @description Decorative, self-running illustration of a call for the sign-in
 * screen: captions scroll up one line at a time with the active speaker
 * highlighted, and two meeting notes tick off. All content is fixed sample
 * copy, never user data.
 *
 * @important Purely decorative (`aria-hidden`). A timer advances the script;
 * under `prefers-reduced-motion` the timer never starts and the card rests on
 * its final frame instead, so nothing moves.
 */
"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

const SPEAKERS = {
  Aiko: "#fdba74",
  Marco: "#7dd3fc",
  Priya: "#f0a6ca",
  Nimbus: "var(--lime)",
} as const;

type Speaker = keyof typeof SPEAKERS;

const SCRIPT: ReadonlyArray<readonly [Speaker, string]> = [
  ["Aiko", "Can we ship the empty state on Friday?"],
  ["Marco", "Yes, if we drop the second button."],
  ["Nimbus", "Noted: empty state ships Friday."],
  ["Aiko", "Who is updating the onboarding copy?"],
  ["Priya", "Me. Draft by Wednesday."],
  ["Nimbus", "Action item for Priya, due Wednesday."],
];

const NOTES = [
  { text: "Empty state ships Friday", doneAt: 2 },
  { text: "Priya · onboarding copy, Wed", doneAt: 5 },
];

const BAR_HEIGHTS = [6, 11, 8, 12];
const ROW = 50;
const OPACITIES = [1, 0.55, 0.25];
const LAST = SCRIPT.length - 1;
const TICK_MS = 2000;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mql = window.matchMedia(REDUCED_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** Vertical offset and opacity for a caption, by its distance behind the live line. */
function linePlacement(index: number, current: number) {
  const n = SCRIPT.length;
  const pos = (((current - index) % n) + n) % n;
  if (pos <= 2) return { y: (2 - pos) * ROW, opacity: OPACITIES[pos] ?? 0 };
  if (pos === n - 1) return { y: 3 * ROW, opacity: 0 };
  return { y: -ROW, opacity: 0 };
}

/** The animated call card shown beside the sign-in form. */
export default function AuthCallPreview() {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [reduced]);

  // The script holds on its last line for three ticks before looping.
  const current = reduced ? LAST : Math.min(tick % 8, LAST);
  const speaker: Speaker = SCRIPT[current]?.[0] ?? "Nimbus";
  const speakerColor = SPEAKERS[speaker];

  return (
    <div
      aria-hidden="true"
      className="relative flex w-full max-w-[460px] flex-col gap-3.5"
    >
      <div className="overflow-hidden rounded-[18px] border border-(--line-2) bg-(--surface-1) shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-(--line-1) px-5 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Design review</span>
            <span className="flex items-center gap-2 text-xs text-(--muted-foreground)">
              <span className="inline-flex h-3 items-center gap-0.5">
                {BAR_HEIGHTS.map((h, i) => (
                  <span
                    key={i}
                    className="animate-eq block w-0.5 rounded-[1px] motion-reduce:animate-none"
                    style={{
                      height: h,
                      background: speakerColor,
                      animationDelay: `-${(i * 0.2).toFixed(1)}s`,
                    }}
                  />
                ))}
              </span>
              {speaker === "Nimbus"
                ? "Nimbus is taking notes"
                : `${speaker} is speaking`}
            </span>
          </div>
          <div className="flex">
            {(Object.keys(SPEAKERS) as Speaker[]).map((name, i) => {
              const on = name === speaker;
              return (
                <span
                  key={name}
                  className="flex size-7 items-center justify-center rounded-full border-2 border-(--surface-1) text-xs font-semibold text-(--background) transition-[box-shadow,opacity] duration-300 motion-reduce:transition-none"
                  style={{
                    background: SPEAKERS[name],
                    marginLeft: i ? -6 : 0,
                    opacity: on ? 1 : 0.45,
                    boxShadow: on ? `0 0 0 2px ${SPEAKERS[name]}` : "none",
                  }}
                >
                  {name[0]}
                </span>
              );
            })}
          </div>
        </div>
        <div className="relative mx-5 h-[150px] overflow-hidden">
          {SCRIPT.map(([name, text], i) => {
            const { y, opacity } = linePlacement(i, current);
            return (
              <div
                key={i}
                className="absolute inset-x-0 top-0 transition-[transform,opacity] duration-700 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none"
                style={{ transform: `translateY(${y}px)`, opacity }}
              >
                <div className="flex gap-3 py-3.5 text-sm leading-[1.45]">
                  <span
                    className="w-[50px] shrink-0 font-mono text-xs leading-5 font-bold"
                    style={{ color: SPEAKERS[name] }}
                  >
                    {name}
                  </span>
                  <span className="text-[#e7e1ea]">{text}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-(--line-2) bg-(--surface-2) px-4.5 py-4">
        <div className="flex items-center justify-between text-[13px] font-semibold">
          <span>Meeting notes</span>
          <span className="font-mono text-[11px] font-normal text-(--muted-foreground)">
            {current >= LAST ? "saved to workspace" : "listening…"}
          </span>
        </div>
        {NOTES.map((note) => {
          const done = current >= note.doneAt;
          return (
            <div key={note.text} className="flex items-center gap-2.5 text-[13px]">
              <span
                className={`flex size-[18px] shrink-0 items-center justify-center rounded-md border text-[11px] font-bold transition-[background,border-color,color] duration-400 motion-reduce:transition-none ${
                  done
                    ? "border-(--lime) bg-(--lime) text-(--background)"
                    : "border-[#3a3440] bg-transparent text-transparent"
                }`}
              >
                ✓
              </span>
              <span
                className={`transition-colors duration-400 motion-reduce:transition-none ${
                  done ? "text-[#e7e1ea]" : "text-(--text-dim)"
                }`}
              >
                {note.text}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2 font-display text-[22px] leading-[1.35] font-medium tracking-[-0.01em] text-(--text-soft)">
        Your docs, boards and calls are where you left them,{" "}
        <span className="text-(--violet)">and so are the notes.</span>
      </p>
    </div>
  );
}
