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

describe("Canvas presence", () => {
  const me = { id: "u_me", name: "Me Myself", image: null };

  const ada = {
    userId: "u_ada",
    name: "Ada",
    color: "#34d399",
    image: null,
  };

  /** A relayed pointer, shaped like the server's `canvas:pointer`. */
  const pointer = (over: Record<string, unknown> = {}) => ({
    canvasId: documentId,
    socketId: "sock-ada",
    user: ada,
    x: 10,
    y: 20,
    ...over,
  });

  /** Gives the component an Excalidraw API that records `updateScene` calls. */
  function attachApi() {
    const api = { updateScene: vi.fn() };
    act(() => {
      (excalidraw.props?.excalidrawAPI as (api: unknown) => void)(api);
    });
    return api;
  }

  /** Collaborator maps passed to `updateScene`, in order. */
  const sceneCollaborators = (api: { updateScene: ReturnType<typeof vi.fn> }) =>
    api.updateScene.mock.calls
      .map(([scene]) => scene as { collaborators?: Map<string, unknown> })
      .filter((scene) => scene.collaborators)
      .map((scene) => scene.collaborators!);

  /** Emitted `canvas:pointer` payloads, in order. */
  const pointerEmits = () =>
    socket.emit.mock.calls
      .filter(([event]) => event === "canvas:pointer")
      .map(([, payload]) => payload as Record<string, unknown>);

  /** Reports a local pointer move the way Excalidraw does. */
  const movePointer = (x: number, y: number, button: "up" | "down" = "up") => {
    act(() => {
      (excalidraw.props?.onPointerUpdate as (p: unknown) => void)({
        pointer: { x, y, tool: "pointer" },
        button,
      });
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  describe("sending the local pointer", () => {
    it("emits the pointer with the current selection", () => {
      render(<Canvas initialElements={[]} documentId={documentId} user={me} />);
      landState();
      act(() => {
        (excalidraw.props?.onChange as (e: unknown, a: unknown) => void)([], {
          selectedElementIds: { "el-1": true, "el-2": true },
        });
      });

      movePointer(5, 6, "down");

      expect(pointerEmits()).toEqual([
        {
          canvasId: documentId,
          x: 5,
          y: 6,
          tool: "pointer",
          button: "down",
          selectedElementIds: ["el-1", "el-2"],
        },
      ]);
    });

    it("sends nothing before the authoritative state has landed", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);

      movePointer(1, 1);

      expect(pointerEmits()).toHaveLength(0);
    });

    it("throttles a burst to about 20 a second and keeps the latest position", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      landState();

      for (let i = 1; i <= 10; i++) movePointer(i, i);
      expect(pointerEmits()).toHaveLength(1);
      expect(pointerEmits()[0]).toMatchObject({ x: 1, y: 1 });

      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(pointerEmits()).toHaveLength(2);
      expect(pointerEmits()[1]).toMatchObject({ x: 10, y: 10 });
    });

    it("sends nothing once the canvas has been left", () => {
      const { unmount } = render(
        <Canvas initialElements={[]} documentId={documentId} />,
      );
      landState();
      movePointer(1, 1);
      movePointer(2, 2);
      const onPointerUpdate = excalidraw.props?.onPointerUpdate as (
        p: unknown,
      ) => void;

      unmount();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      onPointerUpdate({
        pointer: { x: 3, y: 3, tool: "pointer" },
        button: "up",
      });

      // The trailing call for (2, 2) was cancelled and the throttle detached.
      expect(pointerEmits()).toHaveLength(1);
    });
  });

  describe("drawing other people's pointers", () => {
    it("builds Excalidraw collaborators from pointer events", () => {
      render(<Canvas initialElements={[]} documentId={documentId} user={me} />);
      const api = attachApi();

      serverEvent(
        "canvas:pointer",
        pointer({ tool: "laser", button: "down", selectedElementIds: ["a"] }),
      );

      const [collaborators] = sceneCollaborators(api).slice(-1);
      expect(collaborators?.get("sock-ada")).toMatchObject({
        username: "Ada",
        id: "u_ada",
        socketId: "sock-ada",
        button: "down",
        pointer: { x: 10, y: 20, tool: "laser" },
        selectedElementIds: { a: true },
        color: { background: "#34d399" },
      });
    });

    it("keeps one collaborator per socket and moves it", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      const api = attachApi();

      serverEvent("canvas:pointer", pointer());
      serverEvent("canvas:pointer", pointer({ x: 99, y: 98 }));
      serverEvent(
        "canvas:pointer",
        pointer({
          socketId: "sock-grace",
          user: { ...ada, userId: "u_grace", name: "Grace" },
        }),
      );

      const latest = sceneCollaborators(api).at(-1)!;
      expect([...latest.keys()].sort()).toEqual(["sock-ada", "sock-grace"]);
      expect(latest.get("sock-ada")).toMatchObject({
        pointer: { x: 99, y: 98 },
      });
    });

    it("ignores pointers for another canvas", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      const api = attachApi();

      serverEvent("canvas:pointer", pointer({ canvasId: "somewhere-else" }));

      expect(sceneCollaborators(api)).toHaveLength(0);
    });

    it("drops a collaborator that has been silent for ten seconds", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      const api = attachApi();
      serverEvent("canvas:pointer", pointer());

      act(() => {
        vi.advanceTimersByTime(8_000);
      });
      expect(sceneCollaborators(api).at(-1)?.size).toBe(1);

      act(() => {
        vi.advanceTimersByTime(4_000);
      });
      expect(sceneCollaborators(api).at(-1)?.size).toBe(0);
    });

    it("keeps a collaborator that keeps moving", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      const api = attachApi();

      for (let i = 0; i < 4; i++) {
        serverEvent("canvas:pointer", pointer({ x: i }));
        act(() => {
          vi.advanceTimersByTime(6_000);
        });
      }

      expect(sceneCollaborators(api).at(-1)?.size).toBe(1);
    });

    it("removes a collaborator when the server says they left", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      const api = attachApi();
      serverEvent("canvas:pointer", pointer());

      serverEvent("canvas:pointer-leave", {
        canvasId: documentId,
        socketId: "sock-ada",
      });

      expect(sceneCollaborators(api).at(-1)?.size).toBe(0);
    });

    it("ignores a leave for another canvas", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      const api = attachApi();
      serverEvent("canvas:pointer", pointer());
      const before = sceneCollaborators(api).length;

      serverEvent("canvas:pointer-leave", {
        canvasId: "somewhere-else",
        socketId: "sock-ada",
      });

      expect(sceneCollaborators(api)).toHaveLength(before);
    });

    it("stops listening for pointers on unmount", () => {
      const { unmount } = render(
        <Canvas initialElements={[]} documentId={documentId} />,
      );

      unmount();

      const unsubscribed = socket.off.mock.calls.map(([event]) => event);
      expect(unsubscribed).toEqual(
        expect.arrayContaining(["canvas:pointer", "canvas:pointer-leave"]),
      );
    });
  });

  describe("reporting who is on the canvas", () => {
    it("lists other people once, by user, and not the signed-in user", () => {
      const onPeersChange = vi.fn();
      render(
        <Canvas
          initialElements={[]}
          documentId={documentId}
          user={me}
          onPeersChange={onPeersChange}
        />,
      );

      serverEvent("canvas:pointer", pointer());
      serverEvent("canvas:pointer", pointer({ socketId: "sock-ada-2" }));
      serverEvent(
        "canvas:pointer",
        pointer({
          socketId: "sock-me",
          user: { ...ada, userId: "u_me", name: "Me Myself" },
        }),
      );

      expect(onPeersChange).toHaveBeenLastCalledWith([
        { userId: "u_ada", name: "Ada", color: "#34d399", image: null },
      ]);
    });

    it("keeps a quiet person listed after their pointer fades, until they leave", () => {
      const onPeersChange = vi.fn();
      render(
        <Canvas
          initialElements={[]}
          documentId={documentId}
          onPeersChange={onPeersChange}
        />,
      );
      attachApi();
      serverEvent("canvas:pointer", pointer());

      act(() => {
        vi.advanceTimersByTime(12_000);
      });
      expect(onPeersChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ userId: "u_ada" }),
      ]);

      serverEvent("canvas:pointer-leave", {
        canvasId: documentId,
        socketId: "sock-ada",
      });
      expect(onPeersChange).toHaveBeenLastCalledWith([]);
    });

    it("clears the list on unmount", () => {
      const onPeersChange = vi.fn();
      const { unmount } = render(
        <Canvas
          initialElements={[]}
          documentId={documentId}
          onPeersChange={onPeersChange}
        />,
      );
      serverEvent("canvas:pointer", pointer());

      unmount();

      expect(onPeersChange).toHaveBeenLastCalledWith([]);
    });
  });

  describe("telling pointers apart from edits", () => {
    it("does not re-send the canvas when only a collaborator changed", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      landState([element("a")]);
      settleRemoteGuard();

      // Excalidraw calls onChange for the collaborator update too.
      draw([element("a")]);
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(canvasUpdates()).toHaveLength(0);
    });

    it("still sends a real edit", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      landState([element("a")]);
      settleRemoteGuard();

      draw([element("a"), element("b")]);
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(canvasUpdates()).toHaveLength(1);
    });

    it("does not send back what a peer just sent", () => {
      render(<Canvas initialElements={[]} documentId={documentId} />);
      landState();
      serverEvent("canvas:update", {
        documentId,
        elements: [element("peer")],
      });
      settleRemoteGuard();

      draw([element("peer")]);
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(canvasUpdates()).toHaveLength(0);
    });
  });
});
