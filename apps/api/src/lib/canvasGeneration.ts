/**
 * @module api/lib/canvasGeneration
 * @description LLM→JSON→Excalidraw pipeline for AI diagram generation.
 *
 * Flow: an OpenAI-compatible provider (reasoning + `json_object` mode) returns
 * `{ nodes, edges }` logical JSON → tolerant parse (fence strip, brace-match,
 * truncated-JSON salvage) → label-fit sizing → layout (rank-based layered flow
 * when edges exist, grid fallback otherwise) → Excalidraw shapes + bound text
 * + elbowed arrow connectors. Only nodes carry visible text; edges are logical
 * and the app draws the arrows.
 *
 * The parse → layout → Excalidraw steps live in `@nimbus/utils`; this module
 * owns the prompt, the model call and the streaming status.
 *
 * @important Takes a pre-resolved {@link AiClientHandle} — no env reads, no
 *            module-level singleton. A BYOK user pays for their own generation,
 *            the free tier uses the operator's key on the configured provider.
 *            Progress and reasoning stream through `onStatus` / `onReasoning`
 *            for socket relay.
 */
import type { AiClientHandle } from "./ai/clientFactory";
import { reasoningKwargs } from "./ai/clientFactory";
import { startAiCall, usageFromResponse, type AiCallMeta } from "./ai/callLog";
import type { Diagram } from "@nimbus/types";
import {
  DIAGRAM_PALETTE,
  buildExcalidrawFromDiagram,
  extractJsonObject,
  layoutDiagram,
  parseDiagramPayload,
  parseDiagramRecord,
} from "@nimbus/utils";

/** Hard cap for the diagram JSON response. */
export const CANVAS_MAX_OUTPUT_TOKENS = 16_384;

/* ═══ LLM prompt & tolerant JSON extraction ═══ */
/**
 * Builds the system prompt constraining the model to nodes+edges JSON only.
 *
 * Sizing/coordinates are hints — `fitNodesToLabels` + `layoutDiagram`
 * recompute the final geometry, so the prompt asks for flow placement only.
 */
export function buildCanvasSystemPrompt(title: string) {
  return `You are an expert information architect creating Excalidraw-ready diagrams.

Title: "${title}"

Return a single JSON object with this exact structure:
{
  "nodes": [
    {
      "id": "unique_snake_case_id",
      "shape": "rectangle",
      "label": "Short label shown inside the shape",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 80,
      "backgroundColor": "#e8f0fe",
      "strokeColor": "#1e1e1e"
    }
  ],
  "edges": [
    { "from": "source_id", "to": "target_id" }
  ]
}

Rules:
- Output JSON only. No markdown. No commentary.
- Use 4–18 nodes depending on complexity.
- "shape" must be rectangle, ellipse, or diamond.
- Put ALL visible text in "label" on the node. Never emit separate text or arrow elements.
- "edges" lists logical connections only (from → to node ids). The app draws arrows.
- Box sizing is automatic from labels; omit width/height in JSON.
- Place each node with explicit x,y in a clear left-to-right flow (~280px horizontal gap, ~140px vertical gap between row centers).
- Align parallel branches on the same column x; stack branches vertically with even spacing.
- Keep labels concise; use "\\n" only when a line break is intentional.
- Use distinct soft background colors from: ${DIAGRAM_PALETTE.join(", ")}.
- strokeColor "#1e1e1e" unless a highlight needs another color.
- Every edge "from" and "to" must match an existing node "id".
- For branching flows, use multiple edges from one node to several targets.
- Coordinates: canvas origin top-left, x increases right, y increases down.`;
}
/* ═══ Streaming orchestration ═══ */
/** Pulls the first `output_text` string from a completed Responses API output. */
function extractResponseText(
  output: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>,
) {
  for (const item of output) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return "";
}

/** Options for {@link generateCanvasDocument}. */
export type GenerateCanvasDocumentOptions = {
  /** User's description of the desired diagram. */
  prompt: string;
  /** Diagram title injected into the system prompt. */
  label: string;
  /** Called per reasoning delta (socket relay). */
  onReasoning?: (token: string) => void;
  /** Called per milestone (planning → parsing → layout → drawing → done). */
  onStatus?: (status: string) => void;
  /**
   * The pre-resolved SDK client handle. The caller owns entitlement — this
   * module never reads `process.env` for keys, models, or base URLs.
   */
  handle: AiClientHandle;
  /** When given, the model call is written to the workspace call log. */
  callMeta?: AiCallMeta;
};

/**
 * Generates Excalidraw elements for a natural-language diagram prompt.
 *
 * Streams reasoning deltas to `onReasoning` and lifecycle milestones to
 * `onStatus`. Prefers the fast path (`output_parsed` nodes on
 * `response.completed`); otherwise accumulates streamed text with
 * `output_text.done`/completed-output reconciliation, then parses with a
 * thinking-log fallback for truncated JSON.
 *
 * @param options - See {@link GenerateCanvasDocumentOptions}.
 * @returns Excalidraw element array plus the accumulated reasoning log.
 * @throws When the model returns empty text or no elements can be built.
 */
export async function generateCanvasDocument(
  options: GenerateCanvasDocumentOptions,
): Promise<{ canvasData: object[]; thinking: string }> {
  const {
    prompt,
    label,
    onReasoning = () => {},
    onStatus = () => {},
    handle,
    callMeta,
  } = options;
  // The cheapest effort the canvas path needs. `low` is the cheapest level
  // every verified provider accepts — `minimal` is not one of them.
  const reasoningEffort = "low" as const;
  let thinkingLog = "";

  const appendReasoning = (token: string) => {
    thinkingLog += token;
    onReasoning(token);
  };

  onStatus(`Planning diagram…`);

  // `reasoningKwargs` is capability-aware: a model without `reasoningSummary`
  // (Groq's gpt-oss) gets `{ reasoning: { effort } }` only, and a model
  // without `reasoning` at all gets `{}`. This is the seam that keeps the
  // canvas path from 400ing on providers that reject `summary`.
  const call = callMeta ? startAiCall(callMeta) : null;

  let content = "";
  let completedOutput: Parameters<typeof extractResponseText>[0] | undefined;
  /** Why the structured fast path was abandoned, if it was. */
  let fastPathError: string | null = null;

  try {
    const stream = await handle.client.responses.create({
      model: handle.modelId,
      stream: true,
      instructions: buildCanvasSystemPrompt(label),
      input: `Create a professional diagram as a JSON object for:
${prompt}`,
      ...reasoningKwargs(handle, reasoningEffort),
      text: { format: { type: "json_object" } },
      max_output_tokens: CANVAS_MAX_OUTPUT_TOKENS,
    });

    for await (const event of stream) {
      if (event.type === "response.reasoning_text.delta") {
        appendReasoning(event.delta);
        continue;
      }
      if (event.type === "response.reasoning_summary_text.delta") {
        appendReasoning(event.delta);
        continue;
      }
      if (event.type === "response.output_text.delta") {
        content += event.delta;
        continue;
      }
      // `done` carries the authoritative full text — adopt it only when it
      // extends what the deltas accumulated (guards out-of-order delivery).
      if (event.type === "response.output_text.done" && event.text) {
        if (event.text.length >= content.length) {
          content = event.text;
        }
        continue;
      }
      if (event.type === "response.completed") {
        await call?.finish(usageFromResponse(event.response));
        completedOutput = event.response.output;
        // Reconcile streamed deltas against the final snapshot (same guard).
        const fromResponse = extractResponseText(event.response.output);
        if (fromResponse.length >= content.length) {
          content = fromResponse;
        }
        const parsed = (event.response as { output_parsed?: unknown })
          .output_parsed;
        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { nodes?: unknown }).nodes)
        ) {
          // An optimisation, never the only route to an answer. The streamed text
          // and the structured payload are two deliveries of the same reply, so a
          // payload that fails validation must fall through to `content` rather
          // than discarding a diagram that is already sitting there. The reason is
          // kept so a failure of both can name both.
          try {
            onStatus("Parsing diagram structure…");
            const diagram = parseDiagramRecord(
              parsed as { nodes?: unknown; edges?: unknown },
            );
            onStatus(
              `Layout — ${diagram.nodes.length} nodes, ${diagram.edges.length} edges`,
            );
            layoutDiagram(diagram);
            onStatus("Drawing shapes and connectors…");
            const canvasData = buildExcalidrawFromDiagram(diagram);
            if (canvasData.length === 0) {
              throw new Error("Canvas builder produced no elements");
            }
            onStatus(`Done — ${canvasData.length} canvas elements`);
            return { canvasData, thinking: thinkingLog };
          } catch (err) {
            fastPathError = err instanceof Error ? err.message : String(err);
            console.error(
              "[canvas] structured payload rejected:",
              fastPathError,
            );
          }
        }
      }
    }
  } catch (err) {
    await call?.fail(err);
    throw err;
  }
  // A stream that ended without a completion event still cost a request.
  await call?.finish();

  /**
   * Names the structured payload's rejection alongside a fallback failure, so
   * a run that exhausted both deliveries says so instead of implying the model
   * produced nothing usable.
   */
  const withFastPathReason = (message: string) =>
    fastPathError
      ? `${message} (structured payload rejected: ${fastPathError})`
      : message;

  if (!content.trim() && completedOutput) {
    content = extractResponseText(completedOutput);
  }

  if (!content.trim()) {
    throw new Error(
      withFastPathReason("AI provider returned an empty canvas response"),
    );
  }

  onStatus("Parsing diagram structure…");
  let diagram: Diagram;
  try {
    diagram = parseDiagramPayload(content);
  } catch (contentError) {
    // Last resort: the JSON may have bled into the reasoning channel, so
    // retry extraction over content + thinking combined before failing.
    const fallback = extractJsonObject(`${content}\n${thinkingLog}`);
    if (!fallback) {
      throw new Error(
        withFastPathReason(
          contentError instanceof Error
            ? contentError.message
            : "Canvas model returned invalid JSON",
        ),
      );
    }
    diagram = parseDiagramPayload(fallback);
  }

  onStatus(
    `Layout — ${diagram.nodes.length} nodes, ${diagram.edges.length} edges`,
  );
  layoutDiagram(diagram);

  onStatus("Drawing shapes and connectors…");
  const canvasData = buildExcalidrawFromDiagram(diagram);

  if (canvasData.length === 0) {
    throw new Error("Canvas builder produced no elements");
  }

  onStatus(`Done — ${canvasData.length} canvas elements`);
  return { canvasData, thinking: thinkingLog };
}
