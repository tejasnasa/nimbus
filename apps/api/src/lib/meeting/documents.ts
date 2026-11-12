/**
 * @module api/lib/meeting/documents
 * @description Writing a markdown document the assistant was asked for, in the
 * background: streams `doc:ai:start`, `doc:ai:thinking` and then
 * `doc:ai:complete` or `doc:ai:error` to the workspace, exactly as a document
 * NimbusBot creates from chat. Canvas documents go through
 * `diagram.runMeetingDiagram`, which has the same shape.
 *
 * @important {@link runMarkdownDocument} never throws. A failure after a free
 *            allowance was claimed refunds it, and the workspace is told with
 *            `doc:ai:error`.
 */
import { prisma } from "@nimbus/db";
import type { AiCallMeta } from "../ai/callLog";
import type { AiClientHandle } from "../ai/clientFactory";
import { refundFreeDocGeneration } from "../ai/quota";
import { announceDocumentCreated } from "../documentEvents";
import { searchTextForNew } from "../documentText";
import { generateMarkdownDocument } from "../markdownGeneration";
import type { MeetingBroadcaster } from "./lifecycle";

/** Inputs of {@link runMarkdownDocument}. */
export type RunMarkdownInput = {
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
 * Generates a markdown document and stores it.
 *
 * @param input - See {@link RunMarkdownInput}.
 * @returns The new document's id, or null when generation failed.
 */
export async function runMarkdownDocument(
  input: RunMarkdownInput,
): Promise<string | null> {
  const { io, workspaceId, userId, label } = input;
  io?.to(workspaceId).emit("doc:ai:start", { type: "MARKDOWN", label });
  try {
    const { fullContent } = await generateMarkdownDocument({
      prompt: input.prompt,
      label,
      onToken: () => {},
      onThinking: (token) => {
        io?.to(workspaceId).emit("doc:ai:thinking", { token });
      },
      handle: input.handle,
      callMeta: input.meta,
    });
    const document = await prisma.document.create({
      data: {
        title: label,
        type: "MARKDOWN",
        workspaceId,
        initialContent: fullContent,
        searchText: searchTextForNew({ initialContent: fullContent }),
      },
    });
    announceDocumentCreated(io, document);
    io?.to(workspaceId).emit("doc:ai:complete", {
      documentId: document.id,
      label: document.title,
      type: document.type,
    });
    return document.id;
  } catch (error) {
    console.error(
      "[meeting] document generation failed:",
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
