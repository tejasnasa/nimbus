/**
 * @module api/__tests__/unit/botTyping
 * @description The typing signal's counting and safety timer, against a
 * recording broadcaster and fake timers. No database or network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_TYPING_TIMEOUT_MS, createBotTyping } from "../../lib/botTyping";

const recorder = () => {
  const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
        return true;
      },
    }),
  } as never;
  return { io, emitted };
};

describe("createBotTyping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces typing on start and its end on stop, to the workspace room", () => {
    const { io, emitted } = recorder();
    const typing = createBotTyping(io, "ws-solo");

    typing.start();
    typing.stop();

    expect(emitted).toEqual([
      {
        room: "ws-solo",
        event: "bot:typing",
        payload: { workspaceId: "ws-solo", typing: true },
      },
      {
        room: "ws-solo",
        event: "bot:typing",
        payload: { workspaceId: "ws-solo", typing: false },
      },
    ]);
  });

  it("does nothing on stop without a start, and ignores repeated calls", () => {
    const { io, emitted } = recorder();
    const typing = createBotTyping(io, "ws-repeat");

    typing.stop();
    expect(emitted).toEqual([]);

    typing.start();
    typing.start();
    typing.stop();
    typing.stop();
    expect(
      emitted.map((e) => (e.payload as { typing: boolean }).typing),
    ).toEqual([true, false]);
  });

  it("does not restart a handle that has finished", () => {
    const { io, emitted } = recorder();
    const typing = createBotTyping(io, "ws-done");

    typing.start();
    typing.stop();
    typing.start();

    expect(emitted).toHaveLength(2);
  });

  it("counts overlapping mentions: on at the first start, off at the last stop", () => {
    const { io, emitted } = recorder();
    const first = createBotTyping(io, "ws-many");
    const second = createBotTyping(io, "ws-many");

    first.start();
    second.start();
    expect(emitted).toHaveLength(1);

    first.stop();
    expect(emitted).toHaveLength(1);

    second.stop();
    expect(
      emitted.map((e) => (e.payload as { typing: boolean }).typing),
    ).toEqual([true, false]);
  });

  it("keeps workspaces apart", () => {
    const { io, emitted } = recorder();
    const a = createBotTyping(io, "ws-a");
    const b = createBotTyping(io, "ws-b");

    a.start();
    b.start();
    a.stop();

    expect(
      emitted.map((e) => [e.room, (e.payload as { typing: boolean }).typing]),
    ).toEqual([
      ["ws-a", true],
      ["ws-b", true],
      ["ws-a", false],
    ]);
    b.stop();
  });

  it("ends a mention that never reports back after the safety timeout", () => {
    const { io, emitted } = recorder();
    const typing = createBotTyping(io, "ws-stuck");

    typing.start();
    vi.advanceTimersByTime(BOT_TYPING_TIMEOUT_MS - 1);
    expect(emitted).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(
      emitted.map((e) => (e.payload as { typing: boolean }).typing),
    ).toEqual([true, false]);

    // A late stop from the work that outlived the timer changes nothing.
    typing.stop();
    expect(emitted).toHaveLength(2);
  });

  it("lets a stuck mention time out without cutting short one still running", () => {
    const { io, emitted } = recorder();
    const stuck = createBotTyping(io, "ws-mixed", 1000);
    stuck.start();
    vi.advanceTimersByTime(600);
    const live = createBotTyping(io, "ws-mixed", 1000);
    live.start();

    vi.advanceTimersByTime(500);
    // The first timer fired, but the second mention is still being answered.
    expect(emitted).toHaveLength(1);

    live.stop();
    expect(
      emitted.map((e) => (e.payload as { typing: boolean }).typing),
    ).toEqual([true, false]);
  });

  it("stops the timer when the mention ends normally", () => {
    const { io, emitted } = recorder();
    const typing = createBotTyping(io, "ws-clean");

    typing.start();
    typing.stop();
    vi.advanceTimersByTime(BOT_TYPING_TIMEOUT_MS * 2);

    expect(emitted).toHaveLength(2);
  });

  it("survives a broadcaster that throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const io = {
      to: () => ({
        emit: () => {
          throw new Error("adapter down");
        },
      }),
    } as never;
    const typing = createBotTyping(io, "ws-throw");

    expect(() => {
      typing.start();
      typing.stop();
    }).not.toThrow();
    errorSpy.mockRestore();
  });
});
