import { prisma } from "@nimbus/db";
import { BotResult } from "@nimbus/types";
import groqClient from "./groqClient";

export async function generateBotResponse(
  workspaceId: string,
): Promise<BotResult> {
  try {
    const messages = await prisma.message.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        user: true,
      },
    });

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

    const instructions = `You are Nimbus Bot, the official AI companion for the Nimbus collaborative workspace.

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

    const tools = [
      {
        type: "function" as const,
        name: "create_document",
        description:
          "Create a new document in the workspace when the user asks for one.",
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
        },
      },
    ];

    const response = await groqClient.responses.create({
      model: process.env.GROQ_MODEL!,
      tools,
      input: history,
      instructions: instructions,
      max_output_tokens: 1000,
    });

    const toolCall = response.output?.find(
      (item) => item.type === "function_call",
    ) as any;

    if (toolCall && toolCall.name === "create_document") {
      try {
        const args = JSON.parse(toolCall.arguments);
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
