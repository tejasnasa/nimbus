"use client";

import { AIGenOrb } from "@nimbus/ui/AiGenOrb";
import Error from "@nimbus/ui/icons/Error";
import { useEffect, useRef } from "react";

export type AIGenerationState = {
  tabId: string;
  type: "MARKDOWN" | "CANVAS";
  label: string;
  thinkingTokens: string;
  stage:
    | "starting"
    | "thinking"
    | "writing"
    | "finalizing"
    | "error"
    | "complete";
  status: string;
  errorMessage?: string;
};

interface Props {
  state: AIGenerationState;
  onDismissError: () => void;
}

export function AiGenOverlay({ state, onDismissError }: Props) {
  const reasoningRef = useRef<HTMLDivElement>(null);
  const isMarkdown = state.type === "MARKDOWN";
  const showLogPanel = isMarkdown
    ? state.thinkingTokens.length > 0
    : state.stage !== "error";

  useEffect(() => {
    if (reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [state.thinkingTokens]);

  return (
    <div className="relative h-full overflow-hidden animate-fade-in">
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at top, color-mix(in oklch, var(--primary) 10%, transparent) 0%, transparent 55%)",
        }}
      />

      <div className="relative z-10 flex h-full flex-col gap-6 overflow-y-auto px-6 py-8 md:px-10">
        <div className="flex flex-col items-center gap-4 text-center animate-slide-up">
          <div className="relative flex items-center justify-center w-30 h-30">
            {state.stage === "error" ? (
              <div className="animate-scale-in flex items-center justify-center rounded-full w-24 h-24 border-(--destructive) border-2">
                <Error className="text-(--destructive)" />
              </div>
            ) : state.stage === "complete" ? (
              <div className="animate-scale-in flex items-center justify-center rounded-full w-24 h-24 border-(--primary) border-2">
                <svg
                  className="w-12 h-12 text-(--primary) animate-checkmark"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            ) : (
              <AIGenOrb />
            )}
          </div>

          <div>
            <p className="mb-1 text-sm text-(--muted-foreground)">
              {isMarkdown ? "Rich Text Document" : "Canvas"}
            </p>
            <h2 className="text-2xl font-semibold text-(--foreground)">
              {state.stage === "error"
                ? `Couldn't finish "${state.label}"`
                : state.stage === "complete"
                  ? `Created "${state.label}"`
                  : `Creating "${state.label}"`}
            </h2>
            <p className="mt-2 text-sm text-(--muted-foreground)">
              {state.errorMessage || state.status || "Preparing generation..."}
            </p>
          </div>
        </div>

        {showLogPanel && (
          <div className="rounded-2xl border border-(--border) bg-(--card)/70 p-4 backdrop-blur-sm animate-fade-in w-3/4 mx-auto min-h-40">
            <div className="mb-3">
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
              className="h-80 overflow-y-auto rounded-xl bg-(--background)/70 p-4 scrollbar-thin"
            >
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-(--muted-foreground)">
                {state.thinkingTokens ||
                  (isMarkdown
                    ? "Waiting for reasoning…"
                    : "Waiting for reasoning…")}
                {state.stage !== "error" && state.thinkingTokens.length > 0 && (
                  <span className="animate-typewriter-blink">|</span>
                )}
              </pre>
            </div>
          </div>
        )}

        {state.stage === "error" && (
          <div className="flex justify-center animate-slide-up">
            <button
              className="rounded-xl border border-(--border) px-5 py-2.5 text-sm font-medium text-(--muted-foreground) transition-opacity hover:opacity-80"
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
