/**
 * @module web/tests/components/Canvas
 * @description Contract coverage for the Excalidraw whiteboard. The whiteboard
 * itself is not exercised (that would be simulating collaborative editing);
 * what is asserted is the sync contract the component owns: joining the room,
 * staying read-only until the authoritative state lands, emitting
 * `initialized` so the server can tell "not loaded" from "cleared", flushing a
 * pending debounce on unmount, and re-joining after a reconnect.
 */
import "./testUtils";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Canvas from "../../components/Canvas";

/**
 * Excalidraw double that records the props it was rendered with and lets a
 * test drive `onChange`, which is how local edits reach the component.
 */
const excalidraw = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("@excalidraw/excalidraw", async () => {
  const React = await import("react");
  return {
    Excalidraw: (props: Record<string, unknown>) => {
      excalidraw.props = props;
      return React.createElement("div", { "data-testid": "excalidraw" });
    },
  };
});

/** Socket double that records listeners so server events can be replayed. */
const socket = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    listeners,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== handler),
      );
    }),
  };
});

vi.mock("../../lib/socket", () => ({ socket }));

const documentId = "cm_document_00000000000001";
const element = (id: string) => ({ id, type: "rectangle", version: 1 });

/** Replays a server event to every listener the component registered. */
function serverEvent(event: string, payload: unknown) {
  const handlers = socket.listeners.get(event) ?? [];
  act(() => {
    handlers.forEach((handler) => handler(payload));
  });
}

/** Delivers the authoritative state that unblocks editing. */
function landState(elements: unknown[] = []) {
  serverEvent("canvas:state", { documentId, elements });
}

/** Drives the local-edit callback Excalidraw was rendered with. */
function draw(elements: unknown[]) {
  act(() => {
    (excalidraw.props?.onChange as (e: unknown) => void)?.(elements);
  });
}

/**
 * Advances past the guard that suppresses `onChange` while a remote
 * `updateScene` is in flight, so a subsequent local edit is treated as local.
 */
function settleRemoteGuard() {
  act(() => {
    vi.advanceTimersByTime(250);
  });
}

/** Emitted `canvas:update` payloads, in order. */
const canvasUpdates = () =>
  socket.emit.mock.calls
    .filter(([event]) => event === "canvas:update")
    .map(([, payload]) => payload as Record<string, unknown>);

beforeEach(() => {
  socket.listeners.clear();
  socket.emit.mockClear();
  socket.on.mockClear();
  socket.off.mockClear();
  excalidraw.props = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Canvas", () => {
  it("mounts its whiteboard without throwing", async () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);

    expect(await screen.findByTestId("excalidraw")).toBeInTheDocument();
  });

  it("joins the document's canvas room on mount", () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);

    expect(socket.emit).toHaveBeenCalledWith("canvas:join", documentId);
  });

  it("subscribes to the room's state and update events", () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);

    const subscribed = socket.on.mock.calls.map(([event]) => event);
    expect(subscribed).toEqual(
      expect.arrayContaining(["canvas:state", "canvas:update"]),
    );
  });

  it("leaves the room and drops its listeners on unmount", () => {
    const { unmount } = render(
      <Canvas initialElements={[]} documentId={documentId} />,
    );

    unmount();

    expect(socket.emit).toHaveBeenCalledWith("canvas:leave", documentId);
    const unsubscribed = socket.off.mock.calls.map(([event]) => event);
    expect(unsubscribed).toEqual(
      expect.arrayContaining(["canvas:state", "canvas:update"]),
    );
  });

  it("does not join a room when it has no document to join", () => {
    render(<Canvas initialElements={[]} documentId="" />);

    expect(socket.emit).not.toHaveBeenCalledWith("canvas:join", "");
  });

  /**
   * Excalidraw paints local edits immediately even when the component drops
   * their emission, so an editable pre-state board shows strokes that the
   * joining `updateScene` then silently erases. The board is locked instead.
   */
  it("keeps the board read-only until the authoritative state lands", () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);
    expect(excalidraw.props?.viewModeEnabled).toBe(true);

    landState([element("server-1")]);

    expect(excalidraw.props?.viewModeEnabled).toBe(false);
  });

  it("does not emit edits made before the state lands", () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);

    draw([element("premature")]);

    expect(canvasUpdates()).toHaveLength(0);
  });

  it("emits local edits with initialized set once the state has landed", () => {
    vi.useFakeTimers();
    render(<Canvas initialElements={[]} documentId={documentId} />);
    landState();
    settleRemoteGuard();

    draw([element("drawn-1")]);
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(canvasUpdates()).toEqual([
      { documentId, elements: [element("drawn-1")], initialized: true },
    ]);
  });

  /**
   * The `initialized` flag is what makes an intentional clear expressible: the
   * server drops an empty array from a client that has not loaded, and accepts
   * it from one that has.
   */
  it("emits an intentional clear as an initialized empty update", () => {
    vi.useFakeTimers();
    render(<Canvas initialElements={[]} documentId={documentId} />);
    landState([element("server-1")]);
    settleRemoteGuard();

    draw([]);
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(canvasUpdates()).toEqual([
      { documentId, elements: [], initialized: true },
    ]);
  });

  /**
   * A pending debounce used to be cleared on unmount without being flushed, so
   * the last 300ms of strokes died with the tab switch.
   */
  it("flushes a pending update before leaving the room on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Canvas initialElements={[]} documentId={documentId} />,
    );
    landState();
    settleRemoteGuard();

    draw([element("last-stroke")]);
    unmount();

    const updates = canvasUpdates();
    expect(updates).toEqual([
      { documentId, elements: [element("last-stroke")], initialized: true },
    ]);

    // The flush must come before the leave, or the server has already dropped
    // the room by the time the update arrives.
    const events = socket.emit.mock.calls.map(([event]) => event);
    expect(events.indexOf("canvas:update")).toBeLessThan(
      events.indexOf("canvas:leave"),
    );
  });

  it("re-joins the room when the socket reconnects", () => {
    render(<Canvas initialElements={[]} documentId={documentId} />);

    serverEvent("connect", undefined);

    const joins = socket.emit.mock.calls.filter(
      ([event]) => event === "canvas:join",
    );
    expect(joins).toHaveLength(2);
  });

  it("ignores remote updates addressed to a different document", () => {
    vi.useFakeTimers();
    render(<Canvas initialElements={[]} documentId={documentId} />);

    serverEvent("canvas:state", {
      documentId: "some-other-document",
      elements: [element("not-mine")],
    });

    // The foreign state must not have unlocked the board.
    expect(excalidraw.props?.viewModeEnabled).toBe(true);
  });
});
