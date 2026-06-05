import groqClient from "./groqClient";

export async function generateMarkdownDocument(
  prompt: string,
  label: string,
  onToken: (token: string) => void,
  onThinking: (token: string) => void = () => {},
): Promise<{ fullContent: string }> {
  const systemPrompt = `You are an expert technical writer and document generator.
Generate a rich, detailed, and highly professional Markdown document based on the user's prompt.
Include clear headings, bulleted and numbered lists, code blocks (with syntax highlighting), tables where appropriate, blockquotes, and bold/italic text.
Ensure the content is comprehensive, well-structured, and ready to read.

Document Title: ${label}`;

  const stream = await groqClient.responses.create({
    model: process.env.GROQ_MODEL!,
    stream: true,
    instructions: systemPrompt,
    input: prompt,
  });

  let fullContent = "";
  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta) {
      fullContent += event.delta;
      onToken(event.delta);
    }

    if (event.type === "response.reasoning_text.delta" && event.delta) {
      onThinking(event.delta);
    }
  }

  return { fullContent };
}
