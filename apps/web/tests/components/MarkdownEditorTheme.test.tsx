/**
 * @module web/tests/components/MarkdownEditorTheme
 * @description Integration coverage for the editor's *styling* wiring — the one
 * thing the stubbed-Milkdown tests beside this file cannot see.
 *
 * `MarkdownEditor.test.tsx` replaces `@milkdown/react`, so the real
 * `Editor.make().config(...)` chain never runs and nothing there can observe the
 * editor's ProseMirror attributes. That blind spot is how an `editorViewOptionsCtx`
 * regression shipped: the theme stopped applying and headings silently rendered
 * at body size. These tests build the genuine editor and read its real DOM.
 *
 * @important The nord theme scopes every typographic rule to the
 *            `milkdown-theme-nord` class it contributes to the editor's
 *            `attributes`, through the same `editorViewOptionsCtx` slice the
 *            component writes its read-only lock into. Assert on the class, not
 *            on computed font sizes: happy-dom does not cascade the theme's
 *            stylesheet, so a size assertion here would pass against a broken
 *            editor.
 */
import "./testUtils";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { MarkdownEditor } from "../../components/MarkdownEditor";

/** Socket double that records listeners so a `doc:state` can be replayed. */
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

/**
 * Renders the editor and waits for Milkdown to attach its ProseMirror view.
 *
 * Building the real editor is asynchronous — `useEditor` reports `loading` until
 * the plugin chain has run — so every query has to wait for the surface rather
 * than assume it exists after `render`.
 */
async function renderEditor() {
  const view = render(<MarkdownEditor documentId={documentId} />);
  const surface = await waitFor(
    () => {
      const element = view.container.querySelector(".ProseMirror");
      expect(element).toBeTruthy();
      return element as HTMLElement;
    },
    { timeout: 10_000 },
  );
  return { ...view, surface };
}

/** Replays a server event to every listener the component registered. */
function serverEvent(event: string, payload: unknown) {
  const handlers = socket.listeners.get(event) ?? [];
  act(() => {
    handlers.forEach((handler) => handler(payload));
  });
}

/** A valid, empty Yjs state — the payload a `doc:state` for an empty doc carries. */
const emptyState = () => Array.from(Y.encodeStateAsUpdate(new Y.Doc()));

describe("MarkdownEditor theming", () => {
  it("keeps the theme's classes on the editable surface", async () => {
    const { surface } = await renderEditor();

    // The theme's own reset would otherwise leave headings at `font-size: inherit`.
    expect(surface.classList.contains("milkdown-theme-nord")).toBe(true);
    expect(surface.classList.contains("prose")).toBe(true);
  });

  /**
   * Unlocking the view must not cost the theme its classes.
   *
   * `setProps` merges into the props the view was built with, so the attributes
   * the theme contributed survive it — but only because they arrived at
   * construction time. Writing a fresh options object before the view exists is
   * what loses them, and this is the assertion that would have caught it.
   */
  it("keeps the theme's classes once the collaboration binding unlocks the view", async () => {
    const { surface } = await renderEditor();

    serverEvent("doc:state", emptyState());

    await waitFor(() =>
      expect(surface.getAttribute("contenteditable")).toBe("true"),
    );
    expect(surface.classList.contains("milkdown-theme-nord")).toBe(true);
  });
});
