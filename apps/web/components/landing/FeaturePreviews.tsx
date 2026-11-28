/**
 * @module web/components/landing/FeaturePreviews
 * @description The six decorative product previews inside the landing page's
 * feature grid: a live document, a whiteboard, a chat that drafts a doc, a call
 * panel, search results and an export progress list. Each one loops a short
 * sample sequence off a shared timer.
 *
 * @important All previews are `aria-hidden` illustrations with sample content,
 *            not product data. Under reduced motion each renders its finished
 *            frame (see `useTick`).
 */
"use client";
import { PERSONA_COLOR, type Persona } from "./personas";
import { reveal } from "./parts";
import { useTick } from "./useTick";

/** Frame shared by the small previews. */
const PANE =
  "rounded-xl border border-(--line-1) bg-(--panel) box-border";

/** Remote-cursor flag and caret in a person's colour. */
function Cursor({
  name,
  color,
  blink = false,
}: {
  name: string;
  color: string;
  blink?: boolean;
}) {
  return (
    <span
      className={`relative inline-block h-4.5 w-0.5 align-[-3px] ${blink ? "lp-caret" : ""}`}
      style={{ background: color }}
    >
      <span
        className="absolute bottom-full left-0 rounded-[4px_4px_4px_0] px-1.5 py-px text-[10px] font-semibold whitespace-nowrap text-(--ink)"
        style={{ background: color }}
      >
        {name}
      </span>
    </span>
  );
}

/** A collaborative document with two remote cursors, one typing. */
export function DocPreview() {
  const { tick, animate } = useTick();
  const sentence =
    "Roll out to 10% of workspaces on Tuesday, then everyone by Friday if sign-in errors stay flat.";
  const typed = animate
    ? sentence.slice(0, Math.min(sentence.length, (tick % 34) * 4))
    : sentence;

  return (
    <div
      className={`${PANE} flex min-h-100 grow flex-col overflow-hidden`}
      aria-hidden="true"
    >
      <div className="flex items-center justify-between gap-3 border-b border-(--line-1) px-4 py-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="rounded-[7px] bg-(--surface-4) px-2.5 py-1.25 text-(--foreground)">
            Launch plan
          </span>
          <span className="hidden rounded-[7px] px-2.5 py-1.25 text-(--muted-foreground) sm:inline">
            Roadmap board
          </span>
          <span className="hidden rounded-[7px] px-2.5 py-1.25 text-(--muted-foreground) sm:inline">
            Auth sync notes
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-(--muted-foreground)">Also editing</span>
          <div className="flex">
            {(["Priya", "Marco"] as const).map((n, i) => (
              <span
                key={n}
                className={`inline-flex size-6 items-center justify-center rounded-full text-[11px] font-bold ${i ? "ml-1" : ""}`}
                style={{
                  color: PERSONA_COLOR[n],
                  background: n === "Priya" ? "#2a1d27" : "#17242c",
                  boxShadow: `0 0 0 2px ${PERSONA_COLOR[n]}`,
                }}
              >
                {n.charAt(0)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex grow flex-col gap-3.5 px-5 py-6 sm:px-7.5">
        <span className="font-display text-2xl font-semibold">Launch plan</span>
        <p className="text-[15px] leading-[1.7] text-(--text-soft)">
          We ship magic-link sign-in first. Google sign-in stays, and passwords
          come{" "}
          <span className="bg-[rgba(125,211,252,0.22)] shadow-[inset_0_-2px_0_var(--sky)]">
            later in the quarter
          </span>
          <Cursor name="Marco" color="var(--sky)" />.
        </p>
        <span className="pt-1.5 font-display text-[17px] font-semibold">
          Rollout
        </span>
        <p className="min-h-13 text-[15px] leading-[1.7] text-(--text-soft)">
          {typed}
          <Cursor name="Priya" color="var(--pink)" blink />
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-(--text-soft)">
          <li>Flag on in staging this week</li>
          <li>Sign-in copy reviewed before the 10% step</li>
        </ul>
      </div>
    </div>
  );
}

/** A whiteboard with a drawn connector and a roaming remote cursor. */
export function BoardPreview() {
  return (
    <div
      className={`${PANE} relative h-50 overflow-hidden bg-[radial-gradient(var(--line-2)_1px,transparent_1px)] bg-size-[16px_16px]`}
      aria-hidden="true"
    >
      <svg
        width="100%"
        height="200"
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0"
      >
        <rect x="28" y="70" width="96" height="48" rx="10" fill="#1f1b24" stroke="var(--text-body)" strokeWidth="1.6" />
        <text x="76" y="99" textAnchor="middle" fill="var(--text-strong)" fontFamily="Inter, sans-serif" fontSize="13">Idea</text>
        <path className="lp-draw" d="M124 94 C160 94 170 60 206 60" fill="none" stroke="var(--lime)" strokeWidth="2" strokeLinecap="round" />
        <rect x="272" y="120" width="96" height="48" rx="24" fill="#1f1b24" stroke="var(--violet)" strokeWidth="1.6" />
        <text x="320" y="149" textAnchor="middle" fill="var(--violet-pale)" fontFamily="Inter, sans-serif" fontSize="13">Ship</text>
      </svg>
      <div className="lp-nudge absolute top-[22%] left-[39%] flex flex-col items-start">
        <div className="box-border flex h-12 w-26 items-center justify-center rounded-[10px] border-[1.6px] border-dashed border-(--amber) bg-(--surface-4) text-[13px] text-(--text-strong)">
          Review
        </div>
        <div className="mt-1 ml-17.5 flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--amber)">
            <path d="M4 3l16 8-7 2-2 7z" />
          </svg>
          <span className="rounded-[4px] bg-(--amber) px-1.5 py-px text-[10px] font-semibold text-(--ink)">
            Aiko
          </span>
        </div>
      </div>
    </div>
  );
}

/** A chat where an @nimbus mention starts drafting a doc. */
export function ChatPreview() {
  const { tick, animate } = useTick();
  const cs = animate ? Math.floor(tick / 2) % 7 : 6;
  const width = cs < 2 ? 4 : Math.min(100, (cs - 1) * 26);

  return (
    <div
      className={`${PANE} flex h-50 flex-col justify-end gap-2 p-3.5`}
      aria-hidden="true"
    >
      <div className={reveal(cs >= 0)}>
        <div className="inline-block rounded-[10px_10px_10px_3px] bg-(--surface-4) px-2.75 py-1.75 text-[13px] text-(--text-strong)">
          <span className="font-semibold text-(--sky)">Marco</span> so magic link
          first, Google stays?
        </div>
      </div>
      <div className={reveal(cs >= 1)}>
        <div className="inline-block rounded-[10px_10px_10px_3px] bg-(--surface-4) px-2.75 py-1.75 text-[13px] text-(--text-strong)">
          <span className="font-semibold text-(--pink)">Priya</span> yes.{" "}
          <span className="font-semibold text-(--violet)">@nimbus</span> write
          the launch plan
        </div>
      </div>
      <div className={reveal(cs >= 2)}>
        <div className="flex flex-col gap-1.75 rounded-[10px] border border-(--line-3) bg-(--surface-3) px-2.75 py-2.25">
          <span className="font-mono text-[11px] text-(--lime)">
            {cs >= 5
              ? "Created doc · Launch plan"
              : "Nimbus is writing “Launch plan”…"}
          </span>
          <div className="h-1.25 overflow-hidden rounded-[3px] bg-[#262129]">
            <div
              className="h-1.25 rounded-[3px] bg-(--lime) transition-[width] duration-700 motion-reduce:transition-none"
              style={{ width: `${width}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A call panel with a rotating active speaker and a running timer. */
export function CallPreview() {
  const { tick, animate } = useTick();
  const talker = animate ? Math.floor(tick / 4) % 3 : 0;
  const secs = 754 + tick;
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const names: Persona[] = ["Priya", "Marco", "Aiko"];

  return (
    <div
      className={`${PANE} flex grow flex-col gap-3.5 p-4`}
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <span className="lp-live size-1.75 rounded-full bg-(--lime)" />
          In meeting
        </span>
        <span className="font-mono text-[11px] text-(--muted-foreground)">{time}</span>
      </div>
      <div className="flex gap-2.5">
        {names.map((n, i) => (
          <div key={n} className="flex flex-col items-center gap-1.5">
            <span
              className="inline-flex size-10 items-center justify-center rounded-xl bg-[#1c1821] font-display font-semibold transition-shadow duration-300 motion-reduce:transition-none"
              style={{
                color: PERSONA_COLOR[n],
                boxShadow:
                  i === talker
                    ? `0 0 0 2px ${PERSONA_COLOR[n]}, 0 0 0 6px rgba(255,255,255,0.06)`
                    : "0 0 0 1px var(--line-2)",
              }}
            >
              {n.charAt(0)}
            </span>
            <span className="text-[11px] text-(--muted-foreground)">{n}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <span className="flex h-8.5 flex-1 items-center justify-center rounded-[9px] bg-(--surface-4) text-xs text-(--text-strong)">
          Mute
        </span>
        <span className="flex h-8.5 flex-1 items-center justify-center rounded-[9px] bg-[rgba(239,68,68,0.16)] text-xs text-[#fca5a5]">
          Leave
        </span>
      </div>
    </div>
  );
}

/** A search box typing a query and showing highlighted matches. */
export function SearchPreview() {
  const { tick, animate } = useTick();
  const query = "rollout";
  const di = animate ? tick % 18 : 17;
  const typed = query.slice(0, Math.min(query.length, di));
  const hit =
    "rounded-[3px] bg-[rgba(180,139,240,0.3)] px-0.5 text-(--foreground)";

  return (
    <div
      className={`${PANE} flex grow flex-col gap-2.5 p-3.5`}
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 rounded-[9px] border border-(--line-3) bg-(--surface-3) px-2.5 py-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span className="text-[13px]">
          {typed}
          <span className="lp-caret text-(--violet)">▌</span>
        </span>
      </div>
      <div className={reveal(di > query.length)}>
        <div className="flex flex-col gap-2">
          <div className="rounded-lg bg-(--surface-3) px-2.5 py-2">
            <div className="flex justify-between text-[13px] font-semibold">
              <span>Launch plan</span>
              <span className="font-mono text-[10px] text-(--muted-foreground)">DOC</span>
            </div>
            <div className="pt-0.75 text-xs text-(--text-body)">
              …<span className={hit}>rollout</span> to 10% of workspaces on Tuesday…
            </div>
          </div>
          <div className="rounded-lg px-2.5 py-2">
            <div className="flex justify-between text-[13px] font-semibold">
              <span>Roadmap board</span>
              <span className="font-mono text-[10px] text-(--muted-foreground)">BOARD</span>
            </div>
            <div className="pt-0.75 text-xs text-(--text-body)">
              …staged <span className={hit}>rollout</span> → review → ship
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Two files exporting in turn, each with a progress bar. */
export function ExportPreview() {
  const { tick, animate } = useTick();
  const es = animate ? Math.floor(tick / 2) % 8 : 7;
  const files = [
    { name: "Launch plan.md", ext: "MD", color: "var(--violet)", start: 1 },
    { name: "Roadmap board.png", ext: "PNG", color: "var(--lime)", start: 3 },
  ];

  return (
    <div
      className={`${PANE} flex grow flex-col gap-2.5 p-3.5`}
      aria-hidden="true"
    >
      {files.map((f) => {
        const p = Math.max(0, Math.min(100, (es - f.start) * 50));
        const done = p >= 100;
        return (
          <div
            key={f.name}
            className="flex flex-col gap-2 rounded-[9px] bg-(--surface-3) px-3 py-2.5"
          >
            <div className="flex items-center gap-2.5">
              <span
                className="inline-flex size-7.5 items-center justify-center rounded-lg bg-[#241f29] font-mono text-[9px] font-bold"
                style={{ color: f.color }}
              >
                {f.ext}
              </span>
              <span className="flex-1 text-[13px] text-(--text-strong)">{f.name}</span>
              <span
                className="font-mono text-[11px]"
                style={{ color: done ? "var(--lime)" : "var(--muted-foreground)" }}
              >
                {done ? "saved" : p > 0 ? "saving…" : "ready"}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-xs bg-[#262129]">
              <div
                className="h-1 rounded-xs transition-[width] duration-700 motion-reduce:transition-none"
                style={{
                  width: `${p}%`,
                  background: done ? "var(--lime)" : "var(--violet)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
