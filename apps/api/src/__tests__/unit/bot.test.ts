/**
 * @module api/__tests__/unit/bot
 * @description The NimbusBot decision pipeline. The LLM client is mocked (never
 * call a real model), but history is assembled from a real database so the
 * 20-message window and role mapping are exercised against actual rows.
 *
 * `bot.ts` promises never to throw: failures degrade to a plain reply so the
 * chat handler stays simple. That contract is asserted here.
 *
 * The mock is the per-call `client.responses.create` — the production code
 * path is now through a per-request `AiClientHandle`, not a module-level
 * singleton, so the seam is the handle the chat handler constructs and the
 * test constructs with throwaway data.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, searchDocumentsMock, searchSegmentsMock } = vi.hoisted(
  () => ({
    createMock: vi.fn(),
    searchDocumentsMock: vi.fn(),
    searchSegmentsMock: vi.fn(),
  }),
);

// The searches run against the real database. They are wrapped only so a test
// can make one fail.
vi.mock("../../lib/documentSearch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/documentSearch")>();
  return {
    ...actual,
    searchDocuments: (...args: Parameters<typeof actual.searchDocuments>) =>
      searchDocumentsMock(...args),
  };
});
vi.mock("../../lib/meeting/search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/meeting/search")>();
  return {
    ...actual,
    searchSegments: (...args: Parameters<typeof actual.searchSegments>) =>
      searchSegmentsMock(...args),
  };
});

import { AI_PROVIDERS, modelById, type AiProviderSpec } from "@nimbus/types";
import { generateBotResponse } from "../../lib/bot";
import type { AiClientHandle } from "../../lib/ai/clientFactory";
import {
  closeTestResources,
  createDocument,
  createMeeting,
  createMessage,
  createUser,
  createWorkspace,
  resetDatabase,
  seedTranscript,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

/** A plain-text reply response, i.e. no tool call. */
const replyWith = (text: string) => ({
  output: [{ type: "message" }],
  output_text: text,
});

/** A response that fires the `create_document` tool. */
const toolCallWith = (args: unknown) => ({
  output: [
    {
      type: "function_call",
      name: "create_document",
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    },
  ],
  output_text: "",
});

/**
 * A test-only handle whose SDK client is the mocked `createMock`. Production
 * calls go through `createAiClient`; tests inject a fake to avoid touching
 * the SDK's constructor. The provider/model id on the handle is what the
 * production code reads, so the test asserts on it.
 */
const makeTestHandle = (
  provider: AiProviderSpec = AI_PROVIDERS.deepseek,
  modelId = "deepseek-flash",
): AiClientHandle => {
  const model = modelById(provider, modelId);
  if (!model) throw new Error(`unknown model ${modelId}`);
  return {
    providerId: provider.id,
    modelId: model.id,
    source: "free",
    supportsReasoning: model.capabilities.includes("reasoning"),
    client: {
      responses: { create: createMock },
    } as unknown as AiClientHandle["client"],
  };
};

const historySent = () =>
  createMock.mock.calls.at(-1)?.[0]?.input as Array<{
    role: string;
    content: string;
  }>;

describe("lib/bot", () => {
  let workspaceId: string;
  let authorName: string;

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();

    const author = await createUser("Ada Lovelace");
    authorName = author.name;
    workspaceId = (await createWorkspace(author.id)).id;
  });

  describe("history assembly", () => {
    beforeEach(() => {
      createMock.mockResolvedValue(replyWith("ok"));
    });

    it("maps the bot's own messages to the assistant role", async () => {
      await createMessage(workspaceId, process.env.BOT_USERID!, "I am the bot");
      await createMessage(
        workspaceId,
        (await createUser("Grace Hopper")).id,
        "hi bot",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const history = historySent();
      expect(history[0]).toMatchObject({
        role: "assistant",
        content: "I am the bot",
      });
    });

    it("prefixes other users' messages with their display name", async () => {
      await createMessage(
        workspaceId,
        (await createUser("Grace Hopper")).id,
        "hi bot",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(historySent()[0]).toMatchObject({
        role: "user",
        content: "Grace Hopper: hi bot",
      });
    });

    it("orders history oldest-first, as the model expects", async () => {
      const grace = await createUser("Grace Hopper");
      await createMessage(workspaceId, grace.id, "first");
      await createMessage(workspaceId, grace.id, "second");
      await createMessage(workspaceId, grace.id, "third");

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(historySent().map((m) => m.content)).toEqual([
        "Grace Hopper: first",
        "Grace Hopper: second",
        "Grace Hopper: third",
      ]);
    });

    it("caps history at the 20 most recent messages", async () => {
      const grace = await createUser("Grace Hopper");
      for (let i = 1; i <= 25; i += 1) {
        await createMessage(workspaceId, grace.id, `message-${i}`);
      }

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const history = historySent();
      expect(history).toHaveLength(20);
      expect(history.at(-1)?.content).toBe("Grace Hopper: message-25");
      expect(history[0]?.content).toBe("Grace Hopper: message-6");
    });

    it("does not leak another workspace's messages", async () => {
      const other = await createWorkspace((await createUser("Other")).id);
      await createMessage(
        other.id,
        (await createUser("Outsider")).id,
        "not mine",
      );
      await createMessage(
        workspaceId,
        (await createUser("Grace Hopper")).id,
        "mine",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const contents = historySent().map((m) => m.content);
      expect(contents).toEqual(["Grace Hopper: mine"]);
    });

    it("passes the handle's model id, not an env var", async () => {
      await createMessage(
        workspaceId,
        (await createUser("Grace Hopper")).id,
        "hi",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(AI_PROVIDERS.deepseek, "deepseek-flash"),
        allowDocument: true,
      });

      expect(createMock.mock.calls.at(-1)?.[0]?.model).toBe("deepseek-flash");
    });

    it("requests a low reasoning effort rather than the provider's default", async () => {
      // Chat is the latency- and budget-sensitive path: reasoning tokens count
      // against `max_output_tokens`, so an unstated provider default can spend
      // most of the reply's budget before the answer starts.
      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(AI_PROVIDERS.deepseek, "deepseek-flash"),
        allowDocument: true,
      });

      expect(createMock.mock.calls.at(-1)?.[0]?.reasoning).toEqual({
        effort: "low",
        summary: "detailed",
      });
    });

    it("omits `reasoning` entirely for a model that has no such capability", async () => {
      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(AI_PROVIDERS.groq, "qwen/qwen3.8-27b"),
        allowDocument: true,
      });

      expect(createMock.mock.calls.at(-1)?.[0]).not.toHaveProperty("reasoning");
    });
  });

  describe("decisions", () => {
    it("returns a plain reply when no tool call is made", async () => {
      createMock.mockResolvedValue(replyWith("Nothing to build"));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toEqual({ kind: "reply", content: "Nothing to build" });
    });

    it("falls back to an apology when the model returns no text", async () => {
      createMock.mockResolvedValue({ output: [], output_text: "" });

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({ kind: "reply" });
      if (result.kind === "reply")
        expect(result.content).toMatch(/couldn't process/i);
    });

    it("returns create_document when the tool fires", async () => {
      createMock.mockResolvedValue(
        toolCallWith({
          type: "CANVAS",
          label: "Auth Flow",
          prompt: "draw the auth flow",
        }),
      );

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({
        kind: "create_document",
        type: "CANVAS",
        label: "Auth Flow",
        prompt: "draw the auth flow",
      });
    });

    it("defaults an unrecognised document type to MARKDOWN", async () => {
      createMock.mockResolvedValue(
        toolCallWith({
          type: "SPREADSHEET",
          label: "Sheet",
          prompt: "make a sheet",
        }),
      );

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({
        kind: "create_document",
        type: "MARKDOWN",
      });
    });

    it("substitutes placeholders for a tool call with missing fields", async () => {
      createMock.mockResolvedValue(toolCallWith({ type: "MARKDOWN" }));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({
        kind: "create_document",
        label: "Untitled Document",
        prompt: "",
      });
    });

    it("degrades to a reply when the tool arguments are unparseable JSON", async () => {
      createMock.mockResolvedValue(toolCallWith('{"type": "CANVAS", '));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result.kind).toBe("reply");
    });

    it("ignores a tool call it does not recognise", async () => {
      createMock.mockResolvedValue({
        output: [
          { type: "function_call", name: "delete_everything", arguments: "{}" },
        ],
        output_text: "not doing that",
      });

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toEqual({ kind: "reply", content: "not doing that" });
    });
  });

  describe("allowDocument", () => {
    /**
     * The Phase 4 fix for the "bot promises a document that never arrives"
     * bug: when `allowDocument` is false, the `create_document` tool is
     * omitted entirely and the instructions gain one line. The model still
     * has the chat capability — only the document path is removed.
     */
    it("omits the create_document tool when allowDocument is false", async () => {
      createMock.mockResolvedValue(replyWith("I can chat but not make docs"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: false,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      const tools = request.tools as Array<{ name: string }>;
      expect(tools.map((tool) => tool.name)).toEqual(["search_workspace"]);
    });

    it("offers no tools at all when neither documents nor search are allowed", async () => {
      createMock.mockResolvedValue(replyWith("plain"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: false,
        allowSearch: false,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(request.tools).toEqual([]);
      expect(String(request.instructions)).not.toMatch(/search_workspace/);
    });

    it("tells the model that document creation is unavailable", async () => {
      createMock.mockResolvedValue(replyWith("text answer"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: false,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(String(request.instructions)).toMatch(
        /document creation is unavailable/i,
      );
    });

    it("offers the create_document tool when allowDocument is true", async () => {
      createMock.mockResolvedValue(replyWith("ok"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      const tools = request.tools as Array<Record<string, unknown>>;
      expect(tools.map((tool) => tool.name)).toEqual([
        "create_document",
        "search_workspace",
      ]);
    });

    /**
     * Phase 0 finding F4: OpenAI rejects `strict: true` without
     * `additionalProperties: false`. The fix injects it here so all four
     * providers see the same shape — DeepSeek and Groq accept it as-is,
     * OpenAI requires it. The picker tests rely on the fix not regressing
     * for any BYOK user who picks OpenAI.
     */
    it("injects additionalProperties: false into the tool schema", async () => {
      createMock.mockResolvedValue(replyWith("ok"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      const tools = request.tools as Array<{
        parameters: { additionalProperties?: unknown };
      }>;
      expect(tools[0]?.parameters.additionalProperties).toBe(false);
    });
  });

  describe("client construction (who paid)", () => {
    /**
     * The Phase 4 "who paid" headline assertion: a stage must NOT silently
     * revert to the operator's key. We pin the test on the handle's
     * `providerId` and `modelId` rather than on request-body fields, because
     * the failure mode this feature exists to prevent is a request that
     * carries one provider id and is billed to another.
     */
    it("uses the BYOK handle's provider and model — not env vars", async () => {
      createMock.mockResolvedValue(replyWith("ok"));

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(AI_PROVIDERS.openai, "gpt-5-nano"),
        allowDocument: true,
      });

      const request = createMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(request.model).toBe("gpt-5-nano");
    });
  });

  describe("failure handling", () => {
    it("never throws — an LLM failure becomes a reply", async () => {
      createMock.mockRejectedValue(new Error("groq is down"));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({ kind: "reply" });
      if (result.kind === "reply")
        expect(result.content).toMatch(/something went wrong/i);
    });

    it("never throws — even when the failure is not an Error", async () => {
      createMock.mockRejectedValue("a plain string failure");

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({ kind: "reply" });
    });
  });

  describe("images", () => {
    const IMAGE =
      "https://res.cloudinary.com/test/image/upload/v1/nimbus/chat/ws/new.jpg";

    type InputItem = {
      role: string;
      content:
        | string
        | Array<{ type: string; image_url?: string; detail?: string }>;
    };
    const inputSent = () =>
      createMock.mock.calls.at(-1)?.[0]?.input as InputItem[];

    beforeEach(() => {
      createMock.mockResolvedValue(replyWith("ok"));
    });

    it("sends the image as an input_image part on the latest user message only", async () => {
      const author = await createUser("Grace");
      await createMessage(workspaceId, author.id, "first");
      await createMessage(workspaceId, author.id, "second");
      await createMessage(workspaceId, author.id, "@nimbusbot what is this?");

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
        imageUrl: IMAGE,
      });

      const input = inputSent();
      const withImage = input.filter((i) => Array.isArray(i.content));
      expect(withImage).toHaveLength(1);
      expect(input.at(-1)).toBe(withImage[0]);
      expect(withImage[0]!.content).toEqual([
        { type: "input_text", text: expect.stringContaining("what is this?") },
        { type: "input_image", image_url: IMAGE, detail: "auto" },
      ]);
    });

    it("keeps an older message's image out of the request but marks it in the text", async () => {
      const author = await createUser("Grace");
      await testPrisma.message.create({
        data: {
          workspaceId,
          userId: author.id,
          content: "look",
          imageUrl:
            "https://res.cloudinary.com/test/image/upload/v1/nimbus/chat/ws/old.jpg",
        },
      });
      await createMessage(workspaceId, author.id, "@nimbusbot hello");

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      const input = inputSent();
      expect(input.some((i) => Array.isArray(i.content))).toBe(false);
      expect(JSON.stringify(input)).not.toContain("old.jpg");
      expect(input[0]!.content).toContain("[attached an image]");
    });

    it("adds fromImage to the tool only when an image is attached", async () => {
      await createMessage(workspaceId, (await createUser("G")).id, "hi");

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });
      const plain = createMock.mock.calls.at(-1)![0].tools[0].parameters;
      expect(plain.properties).not.toHaveProperty("fromImage");
      expect(plain.required).toEqual(["type", "label", "prompt"]);

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
        imageUrl: IMAGE,
      });
      const tool = createMock.mock.calls.at(-1)![0].tools[0];
      expect(tool.parameters.properties.fromImage).toMatchObject({
        type: ["boolean", "null"],
        description: expect.stringContaining(
          "attached image turned into a diagram",
        ),
      });
      expect(tool.parameters.required).toContain("fromImage");
      expect(tool.parameters.additionalProperties).toBe(false);
    });

    it("returns fromImage and forces a canvas when the model asks for it", async () => {
      await createMessage(
        workspaceId,
        (await createUser("G")).id,
        "diagram it",
      );
      createMock.mockResolvedValue(
        toolCallWith({
          type: "MARKDOWN",
          label: "Board",
          prompt: "p",
          fromImage: true,
        }),
      );

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
        imageUrl: IMAGE,
      });

      expect(result).toMatchObject({
        kind: "create_document",
        type: "CANVAS",
        fromImage: true,
      });
    });

    it("ignores fromImage when no image is attached", async () => {
      await createMessage(
        workspaceId,
        (await createUser("G")).id,
        "write notes",
      );
      createMock.mockResolvedValue(
        toolCallWith({
          type: "MARKDOWN",
          label: "N",
          prompt: "p",
          fromImage: true,
        }),
      );

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
      });

      expect(result).toMatchObject({
        kind: "create_document",
        type: "MARKDOWN",
      });
      expect(result).not.toHaveProperty("fromImage");
    });

    it("does not set fromImage when the model sends null", async () => {
      await createMessage(workspaceId, (await createUser("G")).id, "hi");
      createMock.mockResolvedValue(
        toolCallWith({
          type: "CANVAS",
          label: "N",
          prompt: "p",
          fromImage: null,
        }),
      );

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
        imageUrl: IMAGE,
      });

      expect(result).toMatchObject({ kind: "create_document", type: "CANVAS" });
      expect(result).not.toHaveProperty("fromImage");
    });

    it("tells the model it cannot see an image it was not given", async () => {
      await createMessage(
        workspaceId,
        (await createUser("G")).id,
        "what is this",
      );

      await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: false,
        imageUnreadable: true,
      });

      expect(createMock.mock.calls.at(-1)![0].instructions).toContain(
        "attached that you cannot see",
      );
    });

    it("still degrades to a reply instead of throwing when the call fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      createMock.mockRejectedValue(new Error("vision exploded"));

      const result = await generateBotResponse({
        workspaceId,
        handle: makeTestHandle(),
        allowDocument: true,
        imageUrl: IMAGE,
      });

      expect(result).toMatchObject({ kind: "reply" });
    });
  });

  describe("BOT_USERID handling", () => {
    /**
     * Pins CURRENT behaviour: the role map keys off `BOT_USERID`. With it unset,
     * no row matches, so the bot's own history is relabelled as user input and
     * the model loses the distinction between its replies and the user's.
     */
    it("treats bot-authored messages as user input when BOT_USERID is unset", async () => {
      const botId = process.env.BOT_USERID!;
      // Authored by the real bot user row, so only the env var can classify it.
      await createMessage(workspaceId, botId, "bot line");

      const original = process.env.BOT_USERID;
      delete process.env.BOT_USERID;

      try {
        createMock.mockResolvedValue(replyWith("ok"));

        await generateBotResponse({
          workspaceId,
          handle: makeTestHandle(),
          allowDocument: true,
        });

        const entry = historySent()[0];
        expect(entry).toMatchObject({ role: "user" });
        expect(entry?.content).toContain("bot line");
      } finally {
        process.env.BOT_USERID = original;
      }
    });
  });
});

describe("lib/bot search_workspace", () => {
  let workspaceId: string;

  /** A model response that calls `search_workspace`. */
  const searchCall = (query: unknown, id = "call_1") => ({
    output: [
      {
        type: "function_call",
        name: "search_workspace",
        call_id: id,
        arguments: typeof query === "string" ? query : JSON.stringify(query),
      },
    ],
    output_text: "",
  });

  type SentItem = { type?: string; output?: string };
  type SentRequest = {
    tool_choice?: string;
    instructions?: string;
    input: SentItem[];
  };

  const lastRequest = () => createMock.mock.calls.at(-1)![0] as SentRequest;

  /** The function call outputs the latest request carried back to the model. */
  const toolOutputs = () =>
    lastRequest()
      .input.filter((item) => item.type === "function_call_output")
      .map((item) => JSON.parse(item.output as string));

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();
    const actualSearch = await vi.importActual<
      typeof import("../../lib/documentSearch")
    >("../../lib/documentSearch");
    const actualSegmentSearch = await vi.importActual<
      typeof import("../../lib/meeting/search")
    >("../../lib/meeting/search");
    searchDocumentsMock.mockReset();
    searchSegmentsMock.mockReset();
    searchDocumentsMock.mockImplementation(actualSearch.searchDocuments);
    searchSegmentsMock.mockImplementation(actualSegmentSearch.searchSegments);

    const author = await createUser("Ada Lovelace");
    workspaceId = (await createWorkspace(author.id)).id;
    await createMessage(
      workspaceId,
      author.id,
      "@nimbusbot where is the plan?",
    );
  });

  it("searches once, hands the results back and answers", async () => {
    const doc = await createDocument(workspaceId, {
      title: "Launch plan",
      type: "MARKDOWN",
      searchText: "The rollout needs a rollback checklist before Friday.",
    });
    createMock
      .mockResolvedValueOnce(searchCall({ query: "rollback" }))
      .mockResolvedValueOnce(replyWith("It is in the launch plan."));

    const result = await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    expect(result).toEqual({
      kind: "reply",
      content: "It is in the launch plan.",
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    const [output] = toolOutputs();
    expect(output.documents).toHaveLength(1);
    expect(output.documents[0]).toMatchObject({
      title: "Launch plan",
      citation: `[Launch plan](nimbus-doc:${doc.id})`,
    });
    expect(output.documents[0].excerpt).toContain("rollback");
    expect(output.documents[0].excerpt).not.toMatch(/<\/?mark>/);
    expect(output.meetings).toEqual([]);
    // Neither request forces an answer: a search is still allowed after one.
    expect(createMock.mock.calls[0]![0].tool_choice).toBeUndefined();
    expect(createMock.mock.calls[1]![0].tool_choice).toBeUndefined();
  });

  it("searches transcripts too, with the meeting date and no marks", async () => {
    const meeting = await createMeeting(workspaceId, {
      status: "ENDED",
      startedAt: new Date("2026-11-03T10:00:00Z"),
      endedAt: new Date("2026-11-03T10:30:00Z"),
    });
    await testPrisma.meeting.update({
      where: { id: meeting.id },
      data: { title: "Weekly sync" },
    });
    await seedTranscript(meeting.id, [
      { speakerName: "Priya Shah", text: "We must finish the migration soon." },
    ]);
    createMock
      .mockResolvedValueOnce(searchCall({ query: "migration" }))
      .mockResolvedValueOnce(replyWith("Priya raised it on 3 November."));

    await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: false,
    });

    const [output] = toolOutputs();
    expect(output.meetings).toEqual([
      {
        meeting: "Weekly sync",
        date: "2026-11-03",
        speaker: "Priya Shah",
        excerpt: expect.stringContaining("migration"),
      },
    ]);
    expect(output.meetings[0].excerpt).not.toMatch(/<\/?mark>/);
  });

  it("allows two search rounds, then forces an answer", async () => {
    createMock
      .mockResolvedValueOnce(searchCall({ query: "one" }, "call_1"))
      .mockResolvedValueOnce(searchCall({ query: "two" }, "call_2"))
      // A model that ignores `tool_choice: "none"` still gets no third search.
      .mockResolvedValueOnce({
        ...searchCall({ query: "three" }, "call_3"),
        output_text: "Here is what I found.",
      });

    const result = await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    expect(createMock).toHaveBeenCalledTimes(3);
    expect(createMock.mock.calls[1]![0].tool_choice).toBeUndefined();
    expect(createMock.mock.calls[2]![0].tool_choice).toBe("none");
    expect(result).toEqual({
      kind: "reply",
      content: "Here is what I found.",
    });
    expect(searchDocumentsMock).toHaveBeenCalledTimes(2);
    // Both rounds' results reached the last request, each with its call.
    expect(toolOutputs()).toHaveLength(2);
    const input = lastRequest().input;
    expect(input.filter((item) => item.type === "function_call")).toHaveLength(
      2,
    );
  });

  it("falls back to a plain apology when a forced round returns no text", async () => {
    createMock
      .mockResolvedValueOnce(searchCall({ query: "a" }))
      .mockResolvedValueOnce(searchCall({ query: "b" }))
      .mockResolvedValueOnce(searchCall({ query: "c" }));

    const result = await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    expect(result).toEqual({
      kind: "reply",
      content: "I'm sorry, I couldn't process that.",
    });
  });

  it("drops only the half of a search that fails, and still answers", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    searchDocumentsMock.mockRejectedValue(new Error("db down"));
    const meeting = await createMeeting(workspaceId, { status: "ENDED" });
    await seedTranscript(meeting.id, [
      { speakerName: "Tom", text: "The budget is fine." },
    ]);
    createMock
      .mockResolvedValueOnce(searchCall({ query: "budget" }))
      .mockResolvedValueOnce(replyWith("Tom said the budget is fine."));

    const result = await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    expect(result).toMatchObject({ kind: "reply" });
    const [output] = toolOutputs();
    expect(output.documents).toBe("unavailable");
    expect(output.meetings).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it("reports an unavailable search when both halves fail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    searchDocumentsMock.mockRejectedValue(new Error("db down"));
    searchSegmentsMock.mockRejectedValue(new Error("db down"));
    createMock
      .mockResolvedValueOnce(searchCall({ query: "budget" }))
      .mockResolvedValueOnce(replyWith("I could not search right now."));

    const result = await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    expect(result).toEqual({
      kind: "reply",
      content: "I could not search right now.",
    });
    expect(toolOutputs()).toEqual([
      { error: "Search is unavailable right now." },
    ]);
    errorSpy.mockRestore();
  });

  it("answers an empty or unparseable query with an error and does not search", async () => {
    createMock
      .mockResolvedValueOnce(searchCall("not json"))
      .mockResolvedValueOnce(searchCall({ query: "   " }, "call_2"))
      .mockResolvedValueOnce(replyWith("done"));

    await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    expect(searchDocumentsMock).not.toHaveBeenCalled();
    expect(toolOutputs()).toEqual([
      { error: "A non-empty query is required." },
      { error: "A non-empty query is required." },
    ]);
  });

  it("bounds the query it forwards and makes titles safe to cite", async () => {
    await createDocument(workspaceId, {
      title: "Plan [v2]\nfinal",
      type: "MARKDOWN",
      searchText: "zebra",
    });
    createMock
      .mockResolvedValueOnce(searchCall({ query: "zebra" + "x".repeat(500) }))
      .mockResolvedValueOnce(replyWith("ok"));
    await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });
    expect(searchDocumentsMock.mock.calls[0]![1]).toHaveLength(200);

    createMock.mockReset();
    createMock
      .mockResolvedValueOnce(searchCall({ query: "zebra" }))
      .mockResolvedValueOnce(replyWith("ok"));
    await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });
    const [output] = toolOutputs();
    expect(output.documents[0].citation).toMatch(
      /^\[Plan v2 final\]\(nimbus-doc:[A-Za-z0-9]+\)$/,
    );
  });

  it("describes when to search and how to cite in the instructions", async () => {
    createMock.mockResolvedValueOnce(replyWith("hi"));

    await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    const instructions = String(lastRequest().instructions);
    expect(instructions).toContain("search_workspace");
    expect(instructions).toContain("nimbus-doc:");
  });

  it("still creates a document after a search", async () => {
    createMock
      .mockResolvedValueOnce(searchCall({ query: "roadmap" }))
      .mockResolvedValueOnce(
        toolCallWith({ type: "MARKDOWN", label: "Summary", prompt: "p" }),
      );

    const result = await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    expect(result).toMatchObject({
      kind: "create_document",
      type: "MARKDOWN",
      label: "Summary",
    });
  });

  it("logs every model round to the call log", async () => {
    createMock
      .mockResolvedValueOnce(searchCall({ query: "one" }))
      .mockResolvedValueOnce(replyWith("answer"));

    await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
      callMeta: {
        workspaceId,
        userId: null,
        feature: "chat",
        providerId: "deepseek",
        modelId: "deepseek-flash",
        source: "free",
      },
    });

    const calls = await testPrisma.aiCall.findMany({ where: { workspaceId } });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.status === "OK")).toBe(true);
  });

  it("degrades to the fallback reply when a later round throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createMock
      .mockResolvedValueOnce(searchCall({ query: "one" }))
      .mockRejectedValueOnce(new Error("provider down"));

    const result = await generateBotResponse({
      workspaceId,
      handle: makeTestHandle(),
      allowDocument: true,
    });

    expect(result).toEqual({
      kind: "reply",
      content: "Something went wrong while thinking. Please try again later.",
    });
    errorSpy.mockRestore();
  });
});
