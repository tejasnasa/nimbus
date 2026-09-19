/**
 * @module web/tests/components/MarkdownEditor
 * @description Smoke coverage for the collaborative Markdown editor. Milkdown
 * and its ProseMirror runtime are stubbed — the point is not to drive a real
 * editing session but to prove the component mounts its provider tree without
 * throwing and owns the document room contract: join on mount, subscribe to the
 * Yjs state/update channels, and leave the room on unmount.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "../../components/MarkdownEditor";

/** Minimal stand-in for the Milkdown collab service. */
const collabService = vi.hoisted(() => ({
  bindDoc: vi.fn(),
  setAwareness: vi.fn(),
  applyTemplate: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@milkdown/react", () => ({
  MilkdownProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  Milkdown: () => <div data-testid="milkdown" />,
  useEditor: () => ({
    loading: false,
    get: () => ({
      action: (run: (ctx: { get: () => unknown }) => void) =>
        run({ get: () => collabService }),
    }),
  }),
}));

const socket = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock("../../lib/socket", () => ({ socket }));

const documentId = "cm_document_00000000000001";

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
});
