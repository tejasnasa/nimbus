import { OpenAI } from "openai";
import { prisma } from "@nimbus/db";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateBotResponse(workspaceId: string) {
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
      role: msg.userId === process.env.BOT_USERID ? "assistant" as const : "user" as const,
      content: msg.userId === process.env.BOT_USERID ? (msg.content ?? "") : `${msg.user.name ??  "User"}: ${msg.content ?? ""}`,
}));

    const instructions = `You are Nimbus Bot, the official AI companion for the Nimbus collaborative workspace. 

Nimbus is a high-performance, real-time platform that unifies:
1. Document Editing (Milkdown/Markdown)
2. Infinite Whiteboard Drawing (Excalidraw/Canvas)
3. Direct Collaborative Chat

Your role is to assist users within their workspaces by providing information, answering questions, and acting as a knowledgeable teammate. Keep your responses helpful, concise, and professional yet friendly. When asked about features, keep in mind you are embedded directly into this real-time environment.

Reply to messages which called you using @NimbusBot or something similar. And always reply in simple text, not markdown. Line breaks are allowed.`;

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL!,
      input: history,
      instructions: instructions,
      max_output_tokens: 1000,
    });

    return response.output_text || "I'm sorry, I couldn't process that.";
  } catch (error) {
    console.error("Error generating bot response:", error);
    return "Something went wrong while thinking. Please try again later.";
  }
}
