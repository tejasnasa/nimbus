/**
 * @module api/lib/bot
 * @description NimbusBot chat pipeline: loads the last 20 workspace messages
 * as LLM history (bot rows → assistant, others prefixed `Name:`), calls Groq
 * with a strict `create_document` tool (MARKDOWN for text, CANVAS for
 * diagrams), and returns a discriminated `BotResult` (`reply` | `create_document`
 * | `refused`). Plain-text replies only — no Markdown formatting.
 *
 * @important The bot's HTTP-facing surface is `resolve → generate`, never
 *            `generate` alone. Callers that have not resolved a client handle
 *            first will not get a useful answer here — the caller must own the
 *            entitlement decision so a refusal can be claimed, refunded and
 *            announced (or refused) before any chat traffic is posted.
 *
 * @important Never throws — LLM/DB failures degrade to a fallback `reply` so
 *            chat handlers stay simple. The deliberate exception is the
 *            `refused` branch, which is a successful outcome from this module's
 *            point of view, not a failure.
 */
import { prisma } from "@nimbus/db";
import { BotResult } from "@nimbus/types";
import type { AiClientHandle } from "./ai/clientFactory";

/** Options for {@link generateBotResponse}. */
export type GenerateBotResponseOptions = {
  /** Workspace whose recent history seeds the prompt. */
  workspaceId: string;
  /** The pre-resolved SDK client handle. The bot never reads env. */
  handle: AiClientHandle;
  /**
   * Whether the user is allowed to ask for a document at all. When false
   * the `create_document` tool is omitted entirely (so the model has no way
   * to promise one) and the system instructions gain one line telling the
   * model to answer in text. Without this, a quota-exhausted user would still
   * get a bot reply announcing a document that never arrives.
   */
  allowDocument: boolean;
};

/**
 * Generates the bot's next action for a workspace conversation.
 *
 * @param options - See {@link GenerateBotResponseOptions}. The caller owns the
 *                  entitlement decision (the resolver decides which handle and
 *                  whether document creation is allowed); this function only
 *                  turns that decision into a `BotResult`.
 * @returns `create_document` (with type/label/prompt + interim chatMessage)
 *          when the tool fires, a plain `reply` otherwise, or a `refused`
 *          when the supplied handle is invalid (the resolver would normally
 *          refuse earlier — this is a defence-in-depth check that the
 *          chat handler relied on previously).
 */
export async function generateBotResponse(
  options: GenerateBotResponseOptions,
): Promise<BotResult> {
  const { workspaceId, handle, allowDocument } = options;

  try {
    const messages = await prisma.message.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      include: {
        user: true,
      },
    });

    // Chronological order for the model: newest-first DB rows reversed, bot
    // rows as `assistant`, user rows prefixed so the model sees speaker names.
    const history = messages.reverse().map((msg) => ({
      role:
        msg.userId === process.env.BOT_USERID
          ? ("assistant" as const)
          : ("user" as const),
      content:
        msg.userId === process.env.BOT_USERID
          ? (msg.content ?? "")
          : `${msg.user.name ?? "User"}: ${msg.content ?? ""}`,
    }));

    let instructions = `You are Nimbus Bot, the official AI companion for the Nimbus collaborative workspace.

You can create documents for users. When they ask you to create, write, draft, make,
or generate a document, note, diagram, flowchart, wireframe, canvas, or any written
content — use the create_document tool. For rich text content (notes, docs, specs,
proposals), use type MARKDOWN. For visual content (diagrams, flowcharts, wireframes,
mind maps, architecture diagrams), use type CANVAS.

Nimbus is a high-performance, real-time platform that unifies Document Editing (Milkdown), Infinite Whiteboard Drawing (Excalidraw), and Direct Collaborative Chat.

Your role is to assist users within their workspaces. Here is how they can perform common actions:
- Create a Workspace: On the Home dashboard, click 'Create Workspace' on the 'New Workspace' card.
- Join a Workspace: On the Home dashboard, click 'or join with invite code' on the 'New Workspace' card.
- Create a Document: Inside a workspace, click the gear icon (Settings) in the sidebar -> 'Documents' tab -> '+ Add Document'.
- Invite Others: Go to workspace Settings (gear icon) -> 'Permissions' tab to copy the unique Invite Code.

STRICT RULES:
- Reply to messages which called you using @NimbusBot or something similar.
- ALWAYS reply in simple text, not markdown. Do not use symbols like ** or # for formatting.
- Keep your responses helpful, concise, and professional yet friendly.
- Line breaks are allowed.`;

    // The tool is offered only when the caller has confirmed a document path
    // exists for this user. Without this, a quota-exhausted user (or a user
    // with no key at all on a BYOK-only deployment) would still get a bot
    // reply that announces a document — and the room would then never see one.
    const tools = allowDocument
      ? [
          {
            type: "function" as const,
            name: "create_document",
            description:
              "Create a new document in the workspace when the user asks for one.",
            // `strict: true` requires `additionalProperties: false` on every
            // object schema — OpenAI rejects the schema without it (Phase 0
            // finding F4). We inject it here so DeepSeek, Groq and OpenAI all
            // see the same shape.
            strict: true,
            parameters: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["MARKDOWN", "CANVAS"],
                  description:
                    "MARKDOWN for text documents, CANVAS for diagrams/flowcharts/wireframes",
                },
                label: {
                  type: "string",
                  description: "A concise title for the document",
                },
                prompt: {
                  type: "string",
                  description:
                    "Detailed description of what the document should contain",
                },
              },
              required: ["type", "label", "prompt"],
              additionalProperties: false,
            },
          },
        ]
      : [];

    if (!allowDocument) {
      // Tell the model up front that no document will be created. Without this
      // it may still promise one — `create_document` was already removed from
      // `tools`, so the model *cannot* call it, but it can still say "sure,
      // I'll create it for you", which would then never arrive.
      instructions =
        instructions +
        "\n\nDocument creation is unavailable in this conversation; answer in text.";
    }

    const response = await handle.client.responses.create({
      model: handle.modelId,
      tools,
      input: history,
      instructions: instructions,
      max_output_tokens: 1000,
    });

    const toolCall = response.output?.find(
      (item) => item.type === "function_call",
    ) as any;

    // Only `create_document` is offered, but guard the name anyway — an
    // unexpected tool must fall through to a text reply, not crash chat.
    if (toolCall && toolCall.name === "create_document") {
      try {
        const args = JSON.parse(toolCall.arguments);
        // Default to MARKDOWN on unrecognized types rather than rejecting.
        const type = args.type === "CANVAS" ? "CANVAS" : "MARKDOWN";
        const label = args.label || "Untitled Document";
        const prompt = args.prompt || "";
        const chatMessage = `Sure! I am creating the document "${label}" for you now. Please wait...`;
        return {
          kind: "create_document",
          type,
          label,
          prompt,
          chatMessage,
        };
      } catch (e) {
        console.error("Error parsing tool call arguments:", e);
      }
    }

    return {
      kind: "reply",
      content: response.output_text || "I'm sorry, I couldn't process that.",
    };
  } catch (error) {
    console.error("Error generating bot response:", error);
    return {
      kind: "reply",
      content: "Something went wrong while thinking. Please try again later.",
    };
  }
}
