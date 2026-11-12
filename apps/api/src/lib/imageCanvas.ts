/**
 * @module api/lib/imageCanvas
 * @description Turns a photographed or screenshotted diagram into Excalidraw
 * elements: one vision-model call that transcribes what is drawn into the
 * shared `{ nodes, edges }` JSON, then the same parse → layout → Excalidraw
 * pipeline the text-to-diagram path uses.
 *
 * The result is a discriminated union. An image that is not a diagram comes
 * back as `not-a-diagram` with the model's one-line reason, which the caller
 * posts as a bot reply; only an unreadable answer throws.
 *
 * @important The model is told to transcribe, not improve: labels verbatim, no
 *            invented nodes. That wording was tuned on real photographs; edit it
 *            only with the same kind of evidence.
 *
 * @important The image is sent by URL at `detail: "low"`. Callers must have
 *            checked the URL with `isOwnedChatImageUrl` first — this module
 *            sends whatever it is given to the provider.
 *
 * @important The call is written to the workspace call log as `vision` (via
 *            `withAiCall`), including when it is aborted or its output cannot
 *            be parsed (`parse-failed`). An image the model declines as not a
 *            diagram is a successful call.
 */
import type { Diagram } from "@nimbus/types";
import {
  buildExcalidrawFromDiagram,
  extractJsonObject,
  layoutDiagram,
  parseDiagramPayload,
} from "@nimbus/utils";
import {
  AiCallError,
  usageFromResponse,
  withAiCall,
  type AiCallMeta,
} from "./ai/callLog";
import { reasoningKwargs, type AiClientHandle } from "./ai/clientFactory";
import {
  CANVAS_MAX_OUTPUT_TOKENS,
  buildCanvasSystemPrompt,
} from "./canvasGeneration";

/** Added to the canvas system prompt when the diagram comes from an image. */
const IMAGE_ADDENDUM = `

The user message contains an image. It should be a photo or screenshot of a diagram: a whiteboard, a sketch on paper, an architecture or flow diagram, a mind map or a UI wireframe. Recreate what is drawn:
- One node per box, shape, bubble or labelled item. Copy each label exactly as written. Fix handwriting only when the intended word is unambiguous. Never invent a node that is not in the image. Transcribe the drawing; do not improve it.
- One edge per arrow or connecting line, from the tail to the arrowhead. For a line with no arrowhead, go from top to bottom, or left to right.
- A double-headed arrow is two edges, one each way.
- Add a top-level "direction" to the object: "LR" when the diagram reads left to right (or has no clear direction), "TB" when it reads top to bottom.
- Ignore the background, the paper, the glare and any people or objects that are not part of the drawing.
- If the image is NOT a diagram, whiteboard, sketch, flowchart, mind map or UI wireframe (for example a landscape, a person or a document of plain text), return exactly {"notADiagram":true,"reason":"<one short sentence saying what the image shows>"}.
The 4 to 18 node range above does not apply when the image shows fewer nodes.`;

/** The instruction paired with the image. */
const USER_TEXT = "Create the diagram shown in this image as a JSON object.";

/** Longest reason from the model that is passed on to the room. */
const MAX_REASON_LENGTH = 200;

/** Shown when the model's answer cannot be turned into a diagram. */
export const IMAGE_UNREADABLE_MESSAGE =
  "I couldn't read a diagram from that image. Try a clearer photo with the whole drawing in frame.";

/** What {@link generateCanvasFromImage} resolves to. */
export type ImageCanvasResult =
  | {
      kind: "diagram";
      /** Excalidraw elements ready to persist as `canvasData`. */
      canvasData: object[];
      /** Accumulated reasoning text, for the thinking log. */
      thinking: string;
    }
  | {
      kind: "not-a-diagram";
      /** The model's one-sentence description of what the image shows. */
      reason: string;
    };

/** Options for {@link generateCanvasFromImage}. */
export type GenerateCanvasFromImageOptions = {
  /** The pre-resolved vision-capable client handle. */
  handle: AiClientHandle;
  /** URL of the image; already checked with `isOwnedChatImageUrl`. */
  imageUrl: string;
  /** What the user asked for, appended to the fixed instruction. */
  instruction?: string;
  /** Called per milestone (reading → layout → drawing → done). */
  onStatus?: (status: string) => void;
  /** Called per reasoning delta (socket relay). */
  onReasoning?: (token: string) => void;
  /** Aborts the provider request. */
  signal?: AbortSignal;
  /** When given, the model call is written to the workspace call log. */
  callMeta?: AiCallMeta;
};

/** What one model call produced, before parsing. */
type RawCall = {
  content: string;
  thinking: string;
  response?: unknown;
};

/** Pulls the first `output_text` from a completed response's output items. */
function textFromOutput(
  output: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>,
): string {
  for (const item of output) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return "";
}

/**
 * Reads the model's answer: a not-a-diagram verdict, or a diagram.
 *
 * @throws {AiCallError} `parse-failed` when the text holds no usable diagram.
 */
function interpret(
  content: string,
): { notADiagram: string } | { diagram: Diagram } {
  const json = extractJsonObject(content);
  if (json) {
    try {
      const record = JSON.parse(json) as Record<string, unknown> | null;
      if (
        record &&
        (record.notADiagram === true || record.notDiagram === true)
      ) {
        const reason =
          typeof record.reason === "string" && record.reason.trim()
            ? record.reason.trim().slice(0, MAX_REASON_LENGTH)
            : "it does not look like a diagram";
        return { notADiagram: reason };
      }
    } catch {
      // Not JSON after all; the diagram parser below reports it.
    }
  }

  try {
    return { diagram: parseDiagramPayload(content) };
  } catch {
    throw new AiCallError("parse-failed", IMAGE_UNREADABLE_MESSAGE);
  }
}

/**
 * Generates Excalidraw elements from a picture of a diagram.
 *
 * @param options - See {@link GenerateCanvasFromImageOptions}.
 * @returns The elements, or the model's reason the image is not a diagram.
 * @throws {AiCallError} `parse-failed` (with a user-presentable message) when
 *         the answer holds no diagram; provider and abort errors propagate.
 */
export async function generateCanvasFromImage(
  options: GenerateCanvasFromImageOptions,
): Promise<ImageCanvasResult> {
  const {
    handle,
    imageUrl,
    instruction,
    onStatus = () => {},
    onReasoning = () => {},
    signal,
    callMeta,
  } = options;

  onStatus("Reading the image…");

  const request = async (): Promise<RawCall> => {
    let thinking = "";
    let content = "";
    let response: unknown;

    const text = instruction?.trim()
      ? `${USER_TEXT}\nThe user asked: ${instruction.trim()}`
      : USER_TEXT;

    const stream = await handle.client.responses.create(
      {
        model: handle.modelId,
        stream: true,
        instructions:
          buildCanvasSystemPrompt("Diagram from image") + IMAGE_ADDENDUM,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text },
              { type: "input_image", image_url: imageUrl, detail: "low" },
            ],
          },
        ],
        ...reasoningKwargs(handle, "low"),
        text: { format: { type: "json_object" } },
        max_output_tokens: CANVAS_MAX_OUTPUT_TOKENS,
      },
      signal ? { signal } : undefined,
    );

    for await (const event of stream) {
      if (
        event.type === "response.reasoning_text.delta" ||
        event.type === "response.reasoning_summary_text.delta"
      ) {
        thinking += event.delta;
        onReasoning(event.delta);
      } else if (event.type === "response.output_text.delta") {
        content += event.delta;
      } else if (event.type === "response.output_text.done" && event.text) {
        if (event.text.length >= content.length) content = event.text;
      } else if (event.type === "response.completed") {
        response = event.response;
        const full = textFromOutput(event.response.output);
        if (full.length >= content.length) content = full;
      }
    }

    return { content, thinking, response };
  };

  // Interpreting happens inside the logged call, so an unreadable answer is
  // recorded as `parse-failed` rather than as a success.
  const readImage = async () => {
    const raw = await request();
    if (!raw.content.trim()) {
      throw new AiCallError("parse-failed", IMAGE_UNREADABLE_MESSAGE);
    }
    return { raw, outcome: interpret(raw.content) };
  };

  const { raw, outcome } = callMeta
    ? await withAiCall(callMeta, readImage, (r) =>
        usageFromResponse(r.raw.response),
      )
    : await readImage();

  if ("notADiagram" in outcome) {
    return { kind: "not-a-diagram", reason: outcome.notADiagram };
  }

  const diagram = outcome.diagram;
  onStatus(
    `Layout — ${diagram.nodes.length} nodes, ${diagram.edges.length} edges`,
  );
  const laidOut = await layoutDiagram(diagram);

  onStatus("Drawing shapes and connectors…");
  // A parsed diagram always has at least one node, so this is never empty.
  const canvasData = buildExcalidrawFromDiagram(laidOut);

  onStatus(`Done — ${canvasData.length} canvas elements`);
  return { kind: "diagram", canvasData, thinking: raw.thinking };
}
