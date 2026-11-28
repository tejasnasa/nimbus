"use client";

import { useEffect, useRef } from "react";

/**
 * @module web/components/AiGenOverlay
 * @description Full-pane AI generation status for a `generating:*` tab: a
 * turning two-square mark with a breathing lime core while Nimbus works, a lime
 * check on complete, a red notice on failure, three step pills (Reading,
 * Reasoning, Writing or Drawing) that follow the stage, and an auto-scrolling
 * reasoning/token log. A failed generation offers Dismiss. All motion stops
 * under `prefers-reduced-motion`.
 */
/** Generation progress for one `generating:*` tab. */
export type AIGenerationState = {
  tabId: string;
  type: "MARKDOWN" | "CANVAS";
  label: string;
  thinkingTokens: string;
  stage: "starting" | "thinking" | "error" | "complete";
  status: string;
  errorMessage?: string;
};

interface Props {
  state: AIGenerationState;
  onDismissError: () => void;
}

/** Position of each stage in the step pills; `complete` is past them all. */
const STAGE_INDEX = {
  starting: 0,
  thinking: 1,
  error: 0,
  complete: 3,
} as const;

/** Colour of the pill dot and border for a step in a given condition. */
function stepColor(failed: boolean, done: boolean, current: boolean): string {
  if (failed) return "var(--destructive)";
  if (done) return "var(--lime)";
  if (current) return "var(--violet)";
  return "var(--line-3)";
}

/**
 * @param props.state - Generation snapshot (stage drives mark/check/error).
 * @param props.onDismissError - Removes the failed GENERATING tab.
 */
export function AiGenOverlay({ state, onDismissError }: Props) {
  const reasoningRef = useRef<HTMLDivElement>(null);
  const isMarkdown = state.type === "MARKDOWN";
  const failed = state.stage === "error";
  const complete = state.stage === "complete";
  const showLogPanel = isMarkdown
    ? state.thinkingTokens.length > 0
    : state.stage !== "error";
  const stageIndex = STAGE_INDEX[state.stage];

  useEffect(() => {
    if (reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [state.thinkingTokens]);

  const steps = [
    "Reading",
    "Reasoning",
    isMarkdown ? "Writing" : "Drawing",
  ] as const;

  const glow = failed
    ? "radial-gradient(circle, rgba(239,68,68,0.14), transparent 62%)"
    : complete
      ? "radial-gradient(circle, rgba(124,207,0,0.16), transparent 62%)"
      : "radial-gradient(circle, rgba(124,58,237,0.22), transparent 62%)";

  return (
    <div
      className="relative h-full overflow-hidden font-sans animate-fade-in"
      style={{
        backgroundImage:
          "linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-55 left-1/2 size-160 -translate-x-1/2 rounded-full"
        style={{ background: glow }}
      />

      <div className="relative z-10 flex h-full flex-col items-center gap-7.5 overflow-y-auto px-6 py-12 md:px-10">
        <div className="flex flex-col items-center gap-4.5 text-center animate-slide-up">
          <div className="relative size-30">
            {failed ? (
              <div className="ws-shake absolute inset-3 grid place-items-center rounded-full border-2 border-(--destructive) bg-(--destructive)/8">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--destructive)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 7v6M12 17h.01" />
                </svg>
              </div>
            ) : complete ? (
              <div className="lp-pop absolute inset-3 grid place-items-center rounded-full border-2 border-(--lime) bg-(--lime)/10">
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--lime)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12l5 5 9-10" />
                </svg>
              </div>
            ) : (
              <svg
                width="120"
                height="120"
                viewBox="0 0 120 120"
                className="absolute inset-0"
                aria-hidden="true"
              >
                <rect
                  className="ws-spin-a"
                  x="18"
                  y="18"
                  width="62"
                  height="62"
                  rx="18"
                  fill="none"
                  stroke="var(--violet)"
                  strokeWidth="5"
                />
                <rect
                  className="ws-spin-b"
                  x="40"
                  y="40"
                  width="62"
                  height="62"
                  rx="18"
                  fill="none"
                  stroke="var(--violet)"
                  strokeWidth="5"
                  opacity="0.8"
                />
                <circle
                  className="ws-breathe"
                  cx="60"
                  cy="60"
                  r="12"
                  fill="var(--lime)"
                />
              </svg>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-(--muted-foreground)">
              {isMarkdown ? "Rich Text Document" : "Canvas"}
            </p>
            <h2 className="font-display text-[34px] font-semibold tracking-[-0.03em] text-(--foreground)">
              {failed
                ? `Couldn't finish "${state.label}"`
                : complete
                  ? `Created "${state.label}"`
                  : `Creating "${state.label}"`}
            </h2>
            <p role="status" className="text-[15px] text-(--text-body)">
              {state.errorMessage || state.status || "Preparing generation..."}
            </p>
          </div>
        </div>

        <ul
          className="flex flex-wrap justify-center gap-2"
          aria-label="Progress"
        >
          {steps.map((label, i) => {
            const done = !failed && stageIndex > i;
            const current = !failed && stageIndex === i;
            const color = stepColor(failed, done, current);
            return (
              <li
                key={label}
                className="inline-flex items-center gap-2 rounded-full border bg-(--surface-1) px-3 py-1.75 text-[13px] transition-colors duration-300"
                style={{
                  borderColor:
                    done || current || failed ? color : "var(--line-2)",
                  color:
                    done || current
                      ? "var(--foreground)"
                      : "var(--muted-foreground)",
                }}
              >
                <span
                  className="size-1.75 rounded-full transition-colors duration-300"
                  style={{ background: color }}
                />
                {label}
              </li>
            );
          })}
        </ul>

        {showLogPanel && (
          <div className="box-border flex w-full max-w-190 flex-col gap-3 rounded-[20px] border border-(--line-2) bg-(--surface-1)/90 p-4.5 backdrop-blur-sm animate-fade-in">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-sm font-semibold text-(--foreground)">
                {isMarkdown ? "Reasoning log" : "Generation log"}
              </h3>
              <p className="text-xs text-(--muted-foreground)">
                {isMarkdown
                  ? "Model reasoning from the API."
                  : "Model reasoning while the diagram is planned."}
              </p>
            </div>
            <div
              ref={reasoningRef}
              className="h-57.5 overflow-y-auto rounded-xl bg-(--ink) p-3.5 scrollbar-thin"
            >
              <pre className="whitespace-pre-wrap font-mono text-xs leading-[1.75] text-(--muted-foreground)">
                {state.thinkingTokens || "Waiting for reasoning…"}
                {state.stage !== "error" && state.thinkingTokens.length > 0 && (
                  <span className="animate-typewriter-blink text-(--violet)">
                    |
                  </span>
                )}
              </pre>
            </div>
          </div>
        )}

        {failed && (
          <div className="flex justify-center animate-slide-up">
            <button
              className="min-h-11 rounded-[11px] border border-(--line-3) px-4.5 text-sm text-(--foreground) transition-colors hover:cursor-pointer hover:bg-(--surface-3)"
              onClick={onDismissError}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
