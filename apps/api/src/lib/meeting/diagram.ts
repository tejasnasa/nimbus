/**
 * @module api/lib/meeting/diagram
 * @description Drawing a meeting's discussion: builds a prompt from the stored
 * notes and runs the same canvas generation NimbusBot uses, creating a new
 * canvas document and streaming `doc:ai:start`, `doc:ai:thinking` and then
 * `doc:ai:complete` or `doc:ai:error` to the workspace.
 *
 * @important This only ever creates a new canvas document. Nothing here reads
 *            or edits an existing one.
 *
 * @important {@link runMeetingDiagram} never throws. A failure after a free
 *            allowance was claimed refunds it, and the workspace is told with
 *            `doc:ai:error`, exactly as for a failed bot document.
 */
import { prisma } from "@nimbus/db";
import type { MeetingSummary } from "@nimbus/types";
import type { AiCallMeta } from "../ai/callLog";
import type { AiClientHandle } from "../ai/clientFactory";
import { refundFreeDocGeneration } from "../ai/quota";
import { generateCanvasDocument } from "../canvasGeneration";
import { announceDocumentCreated } from "../documentEvents";
import { searchTextForNew } from "../documentText";
import type { MeetingBroadcaster } from "./lifecycle";

/** Longest prompt handed to the canvas model, in characters. */
const MAX_PROMPT_CHARS = 4000;

/**
 * Builds the canvas label and prompt from a meeting's notes.
 *
 * @param notes - The stored, validated notes.
 */
export function buildDiagramPrompt(notes: MeetingSummary): {
  label: string;
  prompt: string;
} {
  const parts = [
    `Draw a diagram of what a team discussed in a meeting titled "${notes.title}". Show the topics and how they relate, and where decisions were made.`,
    `Summary: ${notes.summary}`,
  ];
  if (notes.topics.length > 0) parts.push(`Topics: ${notes.topics.join("; ")}`);
  if (notes.decisions.length > 0) {
    parts.push(
      `Decisions:\n${notes.decisions.map((d) => `- ${d.text}`).join("\n")}`,
    );
  }
  if (notes.openQuestions.length > 0) {
    parts.push(
      `Open questions:\n${notes.openQuestions.map((q) => `- ${q}`).join("\n")}`,
    );
  }
  return {
    label: `Discussion: ${notes.title}`.slice(0, 120),
    prompt: parts.join("\n\n").slice(0, MAX_PROMPT_CHARS),
  };
}

/** Inputs of {@link runMeetingDiagram}. */
export type RunDiagramInput = {
  io: MeetingBroadcaster | undefined;
  workspaceId: string;
  /** Whose free allowance a claim was made against. */
  userId: string;
  label: string;
  prompt: string;
  handle: AiClientHandle;
  meta: AiCallMeta;
  /** True when a free-tier allowance was claimed and must be refunded on failure. */
  claimed: boolean;
};

/**
 * Generates the diagram and stores it as a new canvas document.
 *
 * @param input - See {@link RunDiagramInput}.
 * @returns The new document's id, or null when generation failed.
 */
export async function runMeetingDiagram(
  input: RunDiagramInput,
): Promise<string | null> {
  const { io, workspaceId, userId, label } = input;
  io?.to(workspaceId).emit("doc:ai:start", { type: "CANVAS", label });
  try {
    const { canvasData } = await generateCanvasDocument({
      prompt: input.prompt,
      label,
      onReasoning: (token) => {
        io?.to(workspaceId).emit("doc:ai:thinking", { token });
      },
      onStatus: () => {},
      handle: input.handle,
      callMeta: input.meta,
    });
    const document = await prisma.document.create({
      data: {
        title: label,
        type: "CANVAS",
        workspaceId,
        canvasData,
        searchText: searchTextForNew({ canvasData }),
      },
    });
    announceDocumentCreated(io, document);
    io?.to(workspaceId).emit("doc:ai:complete", {
      documentId: document.id,
      label: document.title,
      type: document.type,
      canvasData: canvasData as never,
    });
    return document.id;
  } catch (error) {
    console.error(
      "[meeting] diagram generation failed:",
      error instanceof Error ? error.name : "unknown error",
    );
    if (input.claimed) {
      await refundFreeDocGeneration(userId).catch(() => false);
    }
    io?.to(workspaceId).emit("doc:ai:error", {
      message: "Document generation failed. Please try again.",
    });
    return null;
  }
}
