/**
 * @module web/tests/components/MarkdownEditor
 * @description Contract coverage for the collaborative Markdown editor. Milkdown
 * and its ProseMirror runtime are stubbed — the point is not to drive a real
 * editing session but to prove the component owns the document room correctly:
 * join on mount, subscribe to the Yjs state/update channels, leave the room on
 * unmount, and — the part that used to be wrong — keep one session per mount
 * rather than tearing it down on every render.
 *
 * @important The `useEditor` mock returns a *fresh* `get` closure on every
 *            call, exactly like `@milkdown/react` does. A stable mock would
 *            hide the defect these tests exist to pin.
 */
import "./testUtils";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { editorViewCtx } from "@milkdown/kit/core";
import { MarkdownEditor } from "../../components/MarkdownEditor";

/** Minimal stand-in for the Milkdown collab service. */
const collabService = vi.hoisted(() => ({
  bindDoc: vi.fn(),
  setAwareness: vi.fn(),
  applyTemplate: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

/**
 * Minimal stand-in for the ProseMirror view. The component reaches for it only
 * to change editability, which is the invariant the tests below pin.
 */
const editorView = vi.hoisted(() => ({ setProps: vi.fn() }));

/**
 * Lets a test force the editor subtree to re-render.
 *
 * `useEditor` subscribes to this and re-renders itself when it fires, which is
 * how a real re-render (an AI token, a tab highlight) reaches the component.
 */
const rerenderStore = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    bump: () => listeners.forEach((fn) => fn()),
  };
});

vi.mock("@milkdown/react", async () => {
  const React = await import("react");
  return {
    MilkdownProvider: ({ children }: { children: ReactNode }) =>
      React.createElement("div", null, children),
    Milkdown: () => React.createElement("div", { "data-testid": "milkdown" }),
    useEditor: () => {
      const [, force] = React.useReducer((n: number) => n + 1, 0);
      React.useEffect(() => rerenderStore.subscribe(force), []);
      // `ctx.get` is routed by slice: the component reads the collab service
      // and the editor view from the same context, and a double that answered
      // both with the collab service would hide a mis-routed lookup.
      const get = (slice: unknown) =>
        slice === editorViewCtx ? editorView : collabService;

      return {
        loading: false,
        get: () => ({ action: (run: (ctx: { get: typeof get }) => void) => run({ get }) }),
      };
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

/** Replays a server event to every listener the component registered. */
function serverEvent(event: string, payload: unknown) {
  const handlers = socket.listeners.get(event) ?? [];
  act(() => {
    handlers.forEach((handler) => handler(payload));
  });
}

/** A valid, empty Yjs state — the payload a `doc:state` for an empty doc carries. */
const emptyState = () => Array.from(Y.encodeStateAsUpdate(new Y.Doc()));

/** Counts how many times an event was emitted. */
const emitCount = (event: string) =>
  socket.emit.mock.calls.filter(([name]) => name === event).length;

beforeEach(() => {
  socket.listeners.clear();
  socket.emit.mockClear();
  socket.on.mockClear();
  socket.off.mockClear();
  collabService.bindDoc.mockClear();
  collabService.setAwareness.mockClear();
  collabService.applyTemplate.mockClear();
  collabService.connect.mockClear();
  collabService.disconnect.mockClear();
  editorView.setProps.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MarkdownEditor", () => {
  it("mounts its editor container without throwing", () => {
    render(<MarkdownEditor documentId={documentId} />);

    expect(screen.getByTestId("milkdown")).toBeInTheDocument();
  });

  it("joins the document's room on mount", () => {
    render(<MarkdownEditor documentId={documentId} />);

    expect(socket.emit).toHaveBeenCalledWith("doc:join", documentId);
  });

  it("subscribes to the Yjs state and update channels", () => {
    render(<MarkdownEditor documentId={documentId} />);

    const subscribed = socket.on.mock.calls.map(([event]) => event);
    expect(subscribed).toEqual(
      expect.arrayContaining(["doc:state", "doc:update"]),
    );
  });

  it("leaves the room and drops its listeners on unmount", () => {
    const { unmount } = render(<MarkdownEditor documentId={documentId} />);

    unmount();

    expect(socket.emit).toHaveBeenCalledWith("doc:leave", documentId);
    const unsubscribed = socket.off.mock.calls.map(([event]) => event);
    expect(unsubscribed).toEqual(
      expect.arrayContaining(["doc:state", "doc:update"]),
    );
  });

  /**
   * The defect this file exists for: `useEditor().get` is a new closure every
   * render, so listing it as an effect dependency destroyed and recreated the
   * Yjs doc, the awareness instance and the socket room on every re-render —
   * and any DocEditor state change (an AI token, a tab highlight) re-renders
   * the editor subtree.
   */
  it("keeps one session when the editor re-renders", () => {
    render(<MarkdownEditor documentId={documentId} />);
    expect(emitCount("doc:join")).toBe(1);

    act(() => {
      rerenderStore.bump();
      rerenderStore.bump();
    });

    expect(emitCount("doc:join")).toBe(1);
    expect(emitCount("doc:leave")).toBe(0);
    expect(collabService.disconnect).not.toHaveBeenCalled();
  });

  it("re-joins the room when the socket reconnects", () => {
    render(<MarkdownEditor documentId={documentId} />);
    expect(emitCount("doc:join")).toBe(1);

    // A reconnect gives the server a brand-new socket with no rooms; without a
    // re-join every later update is rejected and peers' edits never arrive.
    serverEvent("connect", undefined);

    expect(emitCount("doc:join")).toBe(2);
  });

  it("binds the collab service when state arrives with no content", () => {
    render(<MarkdownEditor documentId={documentId} />);

    expect(collabService.connect).not.toHaveBeenCalled();

    serverEvent("doc:state", emptyState());

    expect(collabService.bindDoc).toHaveBeenCalledTimes(1);
    expect(collabService.connect).toHaveBeenCalledTimes(1);
  });

  /**
   * The editor is locked at construction, and released only once the binding
   * has rendered the Y.Doc into the view.
   *
   * Binding REPLACES the view's contents with the doc's, so an editor released
   * before it accepts keystrokes that render then overwrites. Those keystrokes
   * are in no Yjs update — nothing emits them, nothing persists them, and a
   * reload shows the document empty. The window is the join round-trip, so it
   * is invisible against a local API and seconds against a remote one.
   */
  it("stays read-only until the binding has rendered the document", () => {
    render(<MarkdownEditor documentId={documentId} />);

    // Locking is a view option applied when the view is built, so mount must
    // not be reaching for the view at all.
    expect(editorView.setProps).not.toHaveBeenCalled();

    serverEvent("doc:state", emptyState());

    expect(editorView.setProps).toHaveBeenCalledWith({ editable: undefined });

    // Order is the point. Sentinels rather than a bare index: an absent call
    // must fail this rather than compare as `undefined`, and these place a
    // missing `connect` after every real call and a missing unlock before it.
    const boundAt =
      collabService.connect.mock.invocationCallOrder[0] ?? Infinity;
    const unlockedAt =
      editorView.setProps.mock.invocationCallOrder[0] ?? -Infinity;

    expect(unlockedAt).toBeGreaterThan(boundAt);
  });

  it("re-locks the view when the session tears down", () => {
    const { unmount } = render(<MarkdownEditor documentId={documentId} />);
    serverEvent("doc:state", emptyState());

    unmount();

    // Unbinding without re-locking would leave an editable view with nothing
    // left to sync it.
    expect(editorView.setProps).toHaveBeenLastCalledWith({
      editable: expect.any(Function),
    });
    expect(collabService.disconnect).toHaveBeenCalled();
  });

  /**
   * State slower than the fallback window used to leave the editor inert: the
   * timer had already run, and the content-gated connect refused to bind an
   * empty document, so typing did nothing at all.
   */
  it("still binds when state arrives after the fallback window", () => {
    vi.useFakeTimers();
    render(<MarkdownEditor documentId={documentId} />);

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(collabService.connect).not.toHaveBeenCalled();

    serverEvent("doc:state", emptyState());

    expect(collabService.connect).toHaveBeenCalledTimes(1);
  });

  it("seeds AI content delivered in the state's metadata", () => {
    render(<MarkdownEditor documentId={documentId} />);

    const seeded = new Y.Doc();
    seeded.getMap("metadata").set("initialContent", "# Generated");

    serverEvent("doc:state", Array.from(Y.encodeStateAsUpdate(seeded)));

    expect(collabService.applyTemplate).toHaveBeenCalledWith("# Generated");
  });

  it("retries the join when no state ever arrives", () => {
    vi.useFakeTimers();
    render(<MarkdownEditor documentId={documentId} />);
    expect(emitCount("doc:join")).toBe(1);

    act(() => {
      vi.advanceTimersByTime(2_500);
    });

    expect(emitCount("doc:join")).toBe(2);
  });
});
