/**
 * @module api/__tests__/unit/botMemory
 * @description What NimbusBot's model request carries for time-aware memory:
 * the "Today is" line computed from the request's clock (and ignored in
 * production), the recalled block, the fixed instructions that tell the model
 * how to treat it, and the degradation when recall fails. The SDK client is a
 * mock; history and recall read a real database.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { createMock, recallMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  recallMock: vi.fn(),
}));

// Recall runs for real unless a test makes it fail.
vi.mock("../../lib/memory/recall", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/memory/recall")>();
  recallMock.mockImplementation(actual.recall);
  return {
    ...actual,
    recall: (...args: Parameters<typeof actual.recall>) => recallMock(...args),
  };
});

import { AI_PROVIDERS, modelById } from "@nimbus/types";
import { generateBotResponse } from "../../lib/bot";
import type { AiClientHandle } from "../../lib/ai/clientFactory";
import {
  closeTestResources,
  createMessage,
  createUser,
  createWorkspace,
  resetDatabase,
  sampleNotes,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

const handle = (): AiClientHandle => {
  const model = modelById(AI_PROVIDERS.deepseek, "deepseek-flash")!;
  return {
    providerId: AI_PROVIDERS.deepseek.id,
    modelId: model.id,
    source: "free",
    supportsReasoning: model.capabilities.includes("reasoning"),
    client: {
      responses: { create: createMock },
    } as unknown as AiClientHandle["client"],
  };
};

type Request = {
  instructions: string;
  input: Array<{ role: string; content: string }>;
};
const lastRequest = () => createMock.mock.calls.at(-1)?.[0] as Request;
const contextSent = () => lastRequest().input[0]!.content;

describe("lib/bot: time-aware memory", () => {
  let workspaceId: string;
  let askerId: string;

  const ask = (
    text: string,
    options: { timeZone?: string; clockOverride?: string } = {},
  ) =>
    createMessage(workspaceId, askerId, text).then(() =>
      generateBotResponse({
        workspaceId,
        handle: handle(),
        allowDocument: false,
        allowSearch: false,
        ...options,
      }),
    );

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();
    createMock.mockResolvedValue({
      output: [{ type: "message" }],
      output_text: "ok",
    });
    const user = await createUser("Ada Lovelace");
    askerId = user.id;
    workspaceId = (await createWorkspace(user.id)).id;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("tells the model today's date in the asker's timezone, from the request's clock", async () => {
    await ask("@nimbusbot hello", {
      timeZone: "Asia/Kolkata",
      clockOverride: "2026-11-11T08:35:00Z",
    });
    expect(lastRequest().input[0]).toMatchObject({ role: "user" });
    expect(contextSent()).toContain(
      "Today is Wednesday 2026-11-11 (Asia/Kolkata). Time now: 14:05.",
    );
    expect(contextSent()).toContain("No earlier history was recalled");
    // The conversation itself follows the context message.
    expect(lastRequest().input[1]!.content).toBe(
      "Ada Lovelace: @nimbusbot hello",
    );
  });

  it("keeps everything that changes per turn out of the fixed instructions", async () => {
    await ask("@nimbusbot hello", { clockOverride: "2026-11-11" });
    const first = lastRequest().instructions;
    await ask("@nimbusbot hello again", { clockOverride: "2027-05-05" });
    expect(lastRequest().instructions).toBe(first);
    expect(first).not.toMatch(/2026-11-11|Today is/);
    expect(first).toContain("MEMORY:");
    for (const flag of [
      "NO_MATCHING_HISTORY",
      "NO_HISTORY_ON_REQUESTED_DATE",
      "AMBIGUOUS_MATCH",
    ]) {
      expect(first).toContain(flag);
    }
    expect(first).toContain("then versus now");
    expect(first).toContain("nimbus-doc:");
  });

  it("falls back to UTC for a timezone it does not know", async () => {
    await ask("@nimbusbot hello", {
      timeZone: "Mars/Olympus_Mons",
      clockOverride: "2026-11-11T08:35:00Z",
    });
    expect(contextSent()).toContain(
      "Today is Wednesday 2026-11-11 (UTC). Time now: 08:35.",
    );
  });

  it("puts the recalled meeting in the context for a question about a day", async () => {
    const meeting = await testPrisma.meeting.create({
      data: {
        workspaceId,
        roomName: `nimbus-ws-${workspaceId}`,
        source: "BYOK",
        status: "SUMMARIZED",
        title: "Beta launch planning",
        startedAt: new Date("2026-11-10T08:30:00Z"),
        endedAt: new Date("2026-11-10T09:02:00Z"),
        summary: sampleNotes(),
      },
    });
    await testPrisma.decision.create({
      data: {
        workspaceId,
        meetingId: meeting.id,
        text: "Ship the beta on Friday",
      },
    });

    await ask("@nimbusbot What did we decide on Tuesday's call?", {
      timeZone: "Asia/Kolkata",
      clockOverride: "2026-11-11T08:35:00Z",
    });

    expect(contextSent()).toContain("Recalled workspace history:");
    expect(contextSent()).toContain(
      '[Tue 2026-11-10 14:00] Meeting "Beta launch planning" (32 min, no transcript)',
    );
    expect(contextSent()).toContain("Ship the beta on Friday");
  });

  it("recalls for the latest mention, not an older one still in history", async () => {
    await testPrisma.meeting.create({
      data: {
        workspaceId,
        roomName: `nimbus-ws-${workspaceId}`,
        source: "BYOK",
        status: "SUMMARIZED",
        title: "Beta launch planning",
        startedAt: new Date("2026-11-10T08:30:00Z"),
        endedAt: new Date("2026-11-10T09:02:00Z"),
        summary: sampleNotes(),
      },
    });
    await createMessage(workspaceId, askerId, "@nimbusbot hello there");

    await ask("@nimbusbot What did we decide on Tuesday's call?", {
      timeZone: "Asia/Kolkata",
      clockOverride: "2026-11-11T08:35:00Z",
    });

    expect(contextSent()).toContain('Meeting "Beta launch planning"');
  });

  it("does not recall the messages it already sends as history", async () => {
    const grace = await createUser("Grace Hopper");
    for (let i = 1; i <= 25; i += 1) {
      await createMessage(workspaceId, grace.id, `message-${i}`);
    }
    await ask("@nimbusbot what did I ask you today?", { timeZone: "UTC" });

    const recalled = contextSent();
    expect(recalled).toMatch(/Grace Hopper: message-1(\n|$)/);
    expect(recalled).toMatch(/Grace Hopper: message-6(\n|$)/);
    expect(recalled).not.toMatch(/message-7(\n|$)/);
    expect(recalled).not.toContain("what did I ask you today");
  });

  it("uses the real clock in production, whatever the request says", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_NOW", "2001-01-01");
    const before = new Date().toISOString().slice(0, 10);
    await ask("@nimbusbot hello", {
      timeZone: "UTC",
      clockOverride: "2020-02-02T10:00:00Z",
    });
    const after = new Date().toISOString().slice(0, 10);
    const line = contextSent().split("\n")[1]!;
    expect(line).not.toContain("2020-02-02");
    expect(line).not.toContain("2001-01-01");
    expect(
      [
        `Today is ${weekday(before)} ${before} (UTC). Time now: `,
        `Today is ${weekday(after)} ${after} (UTC). Time now: `,
      ].some((prefix) => line.startsWith(prefix)),
    ).toBe(true);
  });

  it("degrades to no recalled block when recall fails, logging only the error name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    recallMock.mockRejectedValueOnce(
      Object.assign(new TypeError("secret detail: postgres://u:p@host"), {}),
    );

    const result = await ask(
      "@nimbusbot What did we decide on Tuesday's call?",
      {
        clockOverride: "2026-11-11",
      },
    );

    expect(result).toEqual({ kind: "reply", content: "ok" });
    expect(contextSent()).toContain("No earlier history was recalled");
    expect(log).toHaveBeenCalledWith("Memory recall failed:", "TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail");
  });
});

/** The English weekday name of a YYYY-MM-DD date. */
function weekday(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}
