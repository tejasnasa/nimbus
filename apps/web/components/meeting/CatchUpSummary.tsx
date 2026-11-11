/**
 * @module web/components/meeting/CatchUpSummary
 * @description Renders the result of a "Catch me up" request: the summary as
 * bullet points, a line saying nothing has been said yet, or the error with a
 * retry. Shared by the card above the captions and the button in the transcript
 * panel so both read the same.
 *
 * @important The summary is model text, so it is split into lines and rendered
 *            as React text. A leading bullet marker is stripped so the list does
 *            not show two.
 */
"use client";

import type { CatchUpState } from "../../hooks/useCatchUp";

/** Lines of a bulleted summary without their bullet markers. */
export function summaryBullets(summary: string): string[] {
  return summary
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * @param props.state - The request's state.
 * @param props.onRetry - Asks again after a failure.
 */
export default function CatchUpSummary({
  state,
  onRetry,
}: {
  state: CatchUpState;
  onRetry: () => void;
}) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") {
    return (
      <p role="status" className="text-xs opacity-70">
        Catching you up…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-1">
        <p role="alert" className="text-xs text-(--destructive)">
          {state.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold underline hover:cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }
  const { summary } = state.catchUp;
  if (!summary) {
    return <p className="text-xs opacity-70">Nothing has been said yet.</p>;
  }
  return (
    <ul
      data-testid="catch-up-bullets"
      className="list-disc space-y-0.5 pl-4 text-xs"
    >
      {summaryBullets(summary).map((bullet, index) => (
        <li key={index}>{bullet}</li>
      ))}
    </ul>
  );
}
