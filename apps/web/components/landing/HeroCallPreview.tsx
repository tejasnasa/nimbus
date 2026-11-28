/**
 * @module web/components/landing/HeroCallPreview
 * @description The hero's decorative call preview: participants with a speaking
 * ring, a level meter, live captions (one line translated mid-sequence) and a
 * floating meeting-notes card that fills in as the conversation goes on. It
 * replays a fixed sample sequence on a timer.
 *
 * @important Purely decorative (`aria-hidden`); the sample people and lines are
 *            illustrative, not data. Under reduced motion it renders the
 *            finished frame.
 */
"use client";
import { PERSONA_COLOR, type Persona } from "./personas";
import { MarkGlyph, reveal } from "./parts";
import { useTick } from "./useTick";

const HERO_SEQ: ReadonlyArray<readonly [number, number]> = [
  [3, 1], [3, 1], [3, 1], [3, 1], [3, 0], [3, 0], [4, 0], [4, 0], [5, 0], [5, 0],
  [6, 0], [6, 0], [7, 0], [7, 0], [8, 0], [8, 0], [9, 0], [9, 0], [10, 0], [10, 0],
  [2, 0], [2, 0],
];

const LINES: ReadonlyArray<{
  at: number;
  name: Persona;
  text: string;
  ja?: string;
}> = [
  { at: 1, name: "Priya", text: "Let’s ship magic-link sign-in first and leave passwords for later." },
  { at: 2, name: "Marco", text: "Agreed. I can have it behind a flag by Thursday." },
  { at: 3, name: "Aiko", text: "Can we keep Google sign-in as well?", ja: "Googleログインも残せますか？" },
  { at: 4, name: "Priya", text: "Nimbus, what did we decide about auth last week?" },
  { at: 5, name: "Nimbus", text: "Last Tuesday you dropped SMS codes and kept Google sign-in. Marco owns the migration." },
];

const PEOPLE: Persona[] = ["Priya", "Marco", "Aiko", "Nimbus"];
const HEIGHTS = [
  14, 22, 34, 46, 30, 18, 38, 50, 42, 26, 16, 32, 48, 40, 24, 36, 52, 44, 28, 20,
  34, 46, 30, 18, 26, 38, 22, 14,
];

/** Renders the hero's call preview. */
export default function HeroCallPreview() {
  const { tick, animate } = useTick();
  const [step, showJa] = animate
    ? (HERO_SEQ[tick % HERO_SEQ.length] as readonly [number, number])
    : ([9, 0] as const);

  const speaking =
    LINES.find((l) => step === l.at || (l.name === "Nimbus" && step === 6))
      ?.name ?? null;
  const barColor = speaking ? PERSONA_COLOR[speaking] : "#3a3341";

  const decisions = [
    { text: "Magic-link sign-in ships first", on: step >= 3 },
    { text: "Keep Google sign-in", on: step >= 7 },
  ];
  const actions = [
    { text: "Magic link behind a flag", owner: "Marco · Thu", on: step >= 3 },
    { text: "Update the sign-in copy", owner: "Aiko", on: step >= 8 },
  ];

  return (
    <div className="relative min-w-0 flex-[1_1_520px] pb-30" aria-hidden="true">
      <div className="flex flex-col gap-4.5 rounded-[20px] border border-(--line-2) bg-(--surface-1) p-5.5 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="lp-live size-2 rounded-full bg-(--lime)" />
            <span className="text-[15px] font-semibold">Auth sync</span>
            <span className="font-mono text-xs text-(--muted-foreground)">
              #product · 4 in call
            </span>
          </div>
          <span className="font-mono text-xs text-(--muted-foreground)">12:04</span>
        </div>

        <div className="flex flex-wrap items-center gap-4.5">
          <div className="flex gap-3">
            {PEOPLE.map((name) => {
              const c = PERSONA_COLOR[name];
              const on = speaking === name;
              return (
                <div key={name} className="flex flex-col items-center gap-1.5">
                  <div
                    className="flex size-13 items-center justify-center rounded-2xl bg-[#1c1821] transition-shadow duration-300 motion-reduce:transition-none"
                    style={{
                      color: c,
                      boxShadow: on
                        ? `0 0 0 2px ${c}, 0 0 0 7px rgba(255,255,255,0.06)`
                        : "0 0 0 1px var(--line-2)",
                    }}
                  >
                    {name === "Nimbus" ? (
                      <svg width="26" height="26" viewBox="0 0 120 120">
                        <rect x="22" y="22" width="52" height="52" rx="14" fill="none" stroke="var(--violet)" strokeWidth="12" />
                        <rect x="46" y="46" width="52" height="52" rx="14" fill="none" stroke="var(--violet)" strokeWidth="12" />
                        <path d="M60 46 H74 V60 A14 14 0 0 1 60 74 H46 V60 A14 14 0 0 1 60 46 Z" fill="var(--lime)" />
                      </svg>
                    ) : (
                      <span className="font-display text-[17px] font-semibold">
                        {name.charAt(0)}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-(--muted-foreground)">{name}</span>
                </div>
              );
            })}
          </div>
          <div className="flex h-13 min-w-0 flex-[1_1_160px] items-center gap-0.75">
            {HEIGHTS.map((h, i) => (
              <div
                key={i}
                className="lp-bar w-1 shrink-0 rounded-xs transition-colors duration-300"
                style={{
                  height: h,
                  background: barColor,
                  animationDelay: `-${((i * 0.17) % 0.9).toFixed(2)}s`,
                  animationPlayState: speaking && animate ? "running" : "paused",
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex min-h-59 flex-col gap-3 border-t border-(--line-1) pt-4">
          <div className="flex items-center justify-between font-mono text-[11px] text-(--muted-foreground)">
            <span className="tracking-widest uppercase">Live captions</span>
            <span>showing in English</span>
          </div>
          {LINES.map((l) => (
            <div key={l.at} className={reveal(step >= l.at)}>
              <div className="flex items-baseline gap-2.5">
                <span
                  className="w-14 shrink-0 font-mono text-xs font-bold"
                  style={{ color: PERSONA_COLOR[l.name] }}
                >
                  {l.name}
                </span>
                <span
                  className={`text-sm leading-normal ${l.name === "Nimbus" ? "text-[#f3fbe6]" : "text-(--text-strong)"}`}
                >
                  {l.ja && showJa === 1 ? l.ja : l.text}
                  {l.ja && showJa === 1 && (
                    <span className="ml-2 rounded-[5px] border border-(--line-3) px-1.5 py-px font-mono text-[10px] text-(--muted-foreground)">
                      JA → EN
                    </span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lp-float absolute -right-2 bottom-0 flex w-75 max-w-[80%] flex-col gap-3 rounded-2xl border border-(--line-3) bg-(--surface-3) p-4.5 shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Meeting notes</span>
          <span className="font-mono text-[11px] text-(--lime)">
            {step >= 8 ? "saved" : "drafting…"}
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-widest text-(--muted-foreground) uppercase">
          Decisions
        </span>
        {decisions.map((d) => (
          <div key={d.text} className={reveal(d.on)}>
            <div className="flex items-start gap-2 text-[13px] leading-snug text-(--text-strong)">
              <MarkGlyph className="mt-0.75" />
              <span>{d.text}</span>
            </div>
          </div>
        ))}
        <span className="font-mono text-[10px] tracking-widest text-(--muted-foreground) uppercase">
          Action items
        </span>
        {actions.map((a) => (
          <div key={a.text} className={reveal(a.on)}>
            <div className="flex items-center gap-2 text-[13px] text-(--text-strong)">
              <span className="size-3.5 shrink-0 rounded border-[1.5px] border-(--violet)" />
              <span className="min-w-0 flex-1">{a.text}</span>
              <span className="rounded-md bg-[#2a2131] px-1.75 py-0.5 font-mono text-[10px] text-(--violet-pale)">
                {a.owner}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
