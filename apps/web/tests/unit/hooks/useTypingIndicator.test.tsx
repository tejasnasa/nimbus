/**
 * @module web/tests/unit/hooks/useTypingIndicator
 * @description The timer logic is exactly what regresses silently: a hook that
 * emits on every keystroke, or that never stops, or that ignores the same user
 * in a second tab, all look right until production. These tests drive the hook
 * with `vi.useFakeTimers` and a mocked socket so the four states — throttled
 * start, idle stop, stop-on-send, stop-on-empty, inbound TTL, and self-ignore —
 * are pinned to actual timer ticks rather than approximate wall-clock waits.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: never) => void;

const { socketMock } = vi.hoisted(() => {
  const listeners = new Map<string, Set<Handler>>();
  return {
    socketMock: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => {
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: Handler) => {
        listeners.get(event)?.delete(handler);
      }),
      __fire: (event: string, payload?: unknown) => {
        listeners.get(event)?.forEach((handler) => handler(payload as never));
      },
      __reset: () => listeners.clear(),
    },
  };
});

vi.mock("../../../lib/socket", () => ({ socket: socketMock }));

import { useTypingIndicator } from "../../../hooks/useTypingIndicator";

const WSID = "ws-1";
const SELF_ID = "user-self";

beforeEach(() => {
  vi.useFakeTimers();
  socketMock.__reset();
  socketMock.emit.mockReset();
  socketMock.on.mockClear();
  socketMock.off.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTypingIndicator — outbound", () => {
  it("emits typing:start on the first keystroke", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() => result.current.handleTypingInput());

    expect(socketMock.emit).toHaveBeenCalledWith("typing:start", WSID);
  });

  it("throttles typing:start to once per ~2s while typing", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    // Burst of keystrokes within the throttle window — only one start.
    act(() => {
      result.current.handleTypingInput();
      result.current.handleTypingInput();
      result.current.handleTypingInput();
    });
    expect(
      socketMock.emit.mock.calls.filter(([event]) => event === "typing:start"),
    ).toHaveLength(1);

    // After the throttle window, the next keystroke re-emits.
    act(() => {
      vi.advanceTimersByTime(2_001);
      result.current.handleTypingInput();
    });
    expect(
      socketMock.emit.mock.calls.filter(([event]) => event === "typing:start"),
    ).toHaveLength(2);
  });

  it("emits typing:stop after ~3s of idle", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() => result.current.handleTypingInput());
    socketMock.emit.mockClear();

    // Continuous typing within the throttle window — no stop yet.
    act(() => {
      vi.advanceTimersByTime(1_000);
      result.current.handleTypingInput();
      vi.advanceTimersByTime(1_500);
      result.current.handleTypingInput();
    });
    expect(socketMock.emit).not.toHaveBeenCalledWith(
      "typing:stop",
      expect.anything(),
    );

    // Idle: the 3s timer fires.
    act(() => {
      vi.advanceTimersByTime(3_001);
    });
    expect(socketMock.emit).toHaveBeenCalledWith("typing:stop", WSID);
  });

  it("stopTyping emits immediately and clears the timers", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() => result.current.handleTypingInput());
    socketMock.emit.mockClear();

    act(() => result.current.stopTyping());
    expect(socketMock.emit).toHaveBeenCalledWith("typing:stop", WSID);

    // Advancing time after the explicit stop does not emit another stop.
    act(() => vi.advanceTimersByTime(10_000));
    expect(
      socketMock.emit.mock.calls.filter(([event]) => event === "typing:stop"),
    ).toHaveLength(1);
  });

  it("emits typing:stop on unmount so a peer doesn't see a stale indicator", () => {
    const { result, unmount } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() => result.current.handleTypingInput());
    socketMock.emit.mockClear();

    unmount();

    expect(socketMock.emit).toHaveBeenCalledWith("typing:stop", WSID);
  });
});

describe("useTypingIndicator — inbound", () => {
  it("adds a typing peer on typing:start and removes on typing:stop", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() =>
      socketMock.__fire("typing:start", {
        userId: "user-other",
        name: "Ana",
      }),
    );
    expect(result.current.typingNames).toEqual(["Ana"]);

    act(() =>
      socketMock.__fire("typing:stop", {
        userId: "user-other",
        name: "Ana",
      }),
    );
    expect(result.current.typingNames).toEqual([]);
  });

  it("ignores typing:start for the current user's own id", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() =>
      socketMock.__fire("typing:start", {
        userId: SELF_ID,
        name: "Me",
      }),
    );

    expect(result.current.typingNames).toEqual([]);
  });

  it("expires a peer's typing entry via the ~5s TTL even without a stop", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() =>
      socketMock.__fire("typing:start", {
        userId: "user-other",
        name: "Ana",
      }),
    );
    expect(result.current.typingNames).toEqual(["Ana"]);

    // 4s in — still typing.
    act(() => vi.advanceTimersByTime(4_000));
    expect(result.current.typingNames).toEqual(["Ana"]);

    // Past the TTL — entry expires independently of any stop event.
    act(() => vi.advanceTimersByTime(1_500));
    expect(result.current.typingNames).toEqual([]);
  });

  it("restarts the TTL on each fresh typing:start from the same peer", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() =>
      socketMock.__fire("typing:start", {
        userId: "user-other",
        name: "Ana",
      }),
    );
    // 4s in, then another start — the TTL restarts.
    act(() => {
      vi.advanceTimersByTime(4_000);
      socketMock.__fire("typing:start", {
        userId: "user-other",
        name: "Ana",
      });
    });

    // 4s after the restart — still typing.
    act(() => vi.advanceTimersByTime(4_000));
    expect(result.current.typingNames).toEqual(["Ana"]);

    // Now past the second window.
    act(() => vi.advanceTimersByTime(1_500));
    expect(result.current.typingNames).toEqual([]);
  });

  it("tracks multiple peers independently", () => {
    const { result } = renderHook(() =>
      useTypingIndicator({ wsid: WSID, currentUserId: SELF_ID }),
    );

    act(() => {
      socketMock.__fire("typing:start", {
        userId: "user-a",
        name: "Ana",
      });
      socketMock.__fire("typing:start", {
        userId: "user-b",
        name: "Ben",
      });
    });
    expect(result.current.typingNames).toHaveLength(2);

    // Only Ana's stop arrives.
    act(() =>
      socketMock.__fire("typing:stop", {
        userId: "user-a",
        name: "Ana",
      }),
    );
    expect(result.current.typingNames).toEqual(["Ben"]);
  });

  it("rebinds inbound handlers when wsid changes", () => {
    const { result, rerender } = renderHook(
      ({ wsid }) => useTypingIndicator({ wsid, currentUserId: SELF_ID }),
      { initialProps: { wsid: WSID } },
    );

    // The initial render registered exactly one `typing:start` and one
    // `typing:stop` listener.
    const startOnBefore = socketMock.on.mock.calls.filter(
      ([e]) => e === "typing:start",
    ).length;
    expect(startOnBefore).toBe(1);

    rerender({ wsid: "ws-2" });

    // After rerender: the old wsid's listeners were detached (off called for
    // each event) and a fresh pair was attached.
    expect(socketMock.off).toHaveBeenCalledWith(
      "typing:start",
      expect.any(Function),
    );
    expect(socketMock.off).toHaveBeenCalledWith(
      "typing:stop",
      expect.any(Function),
    );
    const startOnAfter = socketMock.on.mock.calls.filter(
      ([e]) => e === "typing:start",
    ).length;
    expect(startOnAfter).toBeGreaterThan(startOnBefore);

    // And the new wiring handles inbound events from the new room.
    act(() =>
      socketMock.__fire("typing:start", {
        userId: "user-other",
        name: "Ana",
      }),
    );
    expect(result.current.typingNames).toEqual(["Ana"]);
  });
});
