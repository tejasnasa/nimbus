/**
 * @module web/tests/components/AiGenOverlay
 * @description Behaviour of the NimbusBot generation status pane: the headline
 * and status line per stage, the reasoning panel's visibility rules (which
 * differ between MARKDOWN and CANVAS), and the error dismissal affordance.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AiGenOverlay,
  type AIGenerationState,
} from "../../components/AiGenOverlay";

const baseState: AIGenerationState = {
  tabId: "generating:1",
  type: "MARKDOWN",
  label: "Sprint Notes",
  thinkingTokens: "",
  stage: "starting",
  status: "Writing your document...",
};

function renderOverlay(state: Partial<AIGenerationState> = {}) {
  const onDismissError = vi.fn();
  const utils = render(
    <AiGenOverlay
      state={{ ...baseState, ...state }}
      onDismissError={onDismissError}
    />,
  );
  return { ...utils, onDismissError };
}

describe("AiGenOverlay", () => {
  it("announces the document being created while starting", () => {
    renderOverlay();

    expect(
      screen.getByRole("heading", { name: 'Creating "Sprint Notes"' }),
    ).toBeInTheDocument();
    expect(screen.getByText("Writing your document...")).toBeInTheDocument();
    expect(screen.getByText("Rich Text Document")).toBeInTheDocument();
  });

  it("describes the canvas variant for CANVAS generations", () => {
    renderOverlay({ type: "CANVAS", status: "Generating your canvas..." });

    expect(screen.getByText("Canvas")).toBeInTheDocument();
    expect(screen.getByText("Generating your canvas...")).toBeInTheDocument();
  });

  it("confirms completion with the document label", () => {
    renderOverlay({ stage: "complete" });

    expect(
      screen.getByRole("heading", { name: 'Created "Sprint Notes"' }),
    ).toBeInTheDocument();
  });

  it("shows the failure message and dismisses on request", async () => {
    const user = userEvent.setup();
    const { onDismissError } = renderOverlay({
      stage: "error",
      errorMessage: "Groq timed out",
    });

    expect(
      screen.getByRole("heading", { name: 'Couldn\'t finish "Sprint Notes"' }),
    ).toBeInTheDocument();
    expect(screen.getByText("Groq timed out")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("hides the reasoning log for markdown until tokens arrive", () => {
    renderOverlay({ stage: "thinking", thinkingTokens: "" });

    expect(screen.queryByText("Reasoning log")).not.toBeInTheDocument();
  });

  it("streams markdown reasoning tokens into the log", () => {
    renderOverlay({ stage: "thinking", thinkingTokens: "Let me plan" });

    expect(screen.getByText("Reasoning log")).toBeInTheDocument();
    expect(screen.getByText(/Let me plan/)).toBeInTheDocument();
  });

  it("always shows the generation log for canvas while it is running", () => {
    renderOverlay({
      type: "CANVAS",
      stage: "thinking",
      thinkingTokens: "",
    });

    expect(screen.getByText("Generation log")).toBeInTheDocument();
    expect(screen.getByText("Waiting for reasoning…")).toBeInTheDocument();
  });

  it("drops the log panel once a canvas generation fails", () => {
    renderOverlay({
      type: "CANVAS",
      stage: "error",
      errorMessage: "Model refused",
    });

    expect(screen.queryByText("Generation log")).not.toBeInTheDocument();
    expect(screen.getByText("Model refused")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeNull();
  });

  it("falls back to a placeholder status before the server sends one", () => {
    renderOverlay({ stage: "starting", status: "" });

    expect(screen.getByText("Preparing generation...")).toBeInTheDocument();
  });
});
