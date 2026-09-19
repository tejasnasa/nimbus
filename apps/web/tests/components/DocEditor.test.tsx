/**
 * @module web/tests/components/DocEditor
 * @description Smoke coverage for the tabbed editor shell. The two editors it
 * hosts are stubbed so the test does not drag in Excalidraw or Milkdown; what is
 * asserted is the shell's own wiring: the tab strip reflects the documents it
 * was handed, and the NimbusBot socket events drive the generating pseudo-tab
 * and its overlay.
 */
import "./testUtils";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ClientDocument } from "../../api/document";
import DocEditor from "../../components/DocEditor";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";

vi.mock("../../components/Canvas", () => ({
  default: ({ documentId }: { documentId: string }) => (
    <div data-testid="canvas">{documentId}</div>
  ),
}));

vi.mock("../../components/MarkdownEditor", () => ({
  MarkdownEditor: ({ documentId }: { documentId: string }) => (
    <div data-testid="markdown">{documentId}</div>
  ),
}));

/** Socket double that records listeners so server events can be replayed. */
const socket = vi.hoisted(() => {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  return {
    listeners,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    }),
    off: vi.fn(),
  };
});

vi.mock("../../lib/socket", () => ({ socket }));

const documents: ClientDocument[] = [
  {
    id: "cm_document_00000000000001",
    label: "Readme",
    type: "MARKDOWN",
    elements: [],
    yjsState: null,
  },
  {
    id: "cm_document_00000000000002",
    label: "Roadmap",
    type: "CANVAS",
    elements: [],
    yjsState: null,
  },
];

/** Replays a server event to every listener DocEditor registered. */
function serverEvent(event: string, payload: unknown) {
  const handlers = socket.listeners.get(event) ?? [];
  act(() => {
    handlers.forEach((handler) => handler(payload));
  });
}

function renderEditor() {
  return render(
    <DocEditorRefProvider>
      <DocEditor documents={documents} />
    </DocEditorRefProvider>,
  );
}

describe("DocEditor", () => {
  it("mounts a tab per document and opens the first one", () => {
    renderEditor();

    expect(screen.getByText("Readme")).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "cm_document_00000000000001",
    );
  });

  it("swaps the editor when another tab is selected", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByText("Roadmap"));

    expect(screen.getByTestId("canvas")).toHaveTextContent(
      "cm_document_00000000000002",
    );
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
  });

  it("subscribes to the NimbusBot generation events", () => {
    renderEditor();

    expect(socket.on).toHaveBeenCalledWith(
      "doc:ai:start",
      expect.any(Function),
    );
    expect(socket.on).toHaveBeenCalledWith(
      "doc:ai:complete",
      expect.any(Function),
    );
    expect(socket.on).toHaveBeenCalledWith(
      "doc:ai:error",
      expect.any(Function),
    );
  });

  it("shows a generating tab and overlay while the bot works", () => {
    renderEditor();

    serverEvent("doc:ai:start", { type: "MARKDOWN", label: "Sprint Notes" });

    expect(
      screen.getByRole("heading", { name: 'Creating "Sprint Notes"' }),
    ).toBeInTheDocument();
  });

  it("surfaces a generation failure and clears it on dismissal", async () => {
    const user = userEvent.setup();
    renderEditor();

    serverEvent("doc:ai:start", { type: "MARKDOWN", label: "Sprint Notes" });
    serverEvent("doc:ai:error", { message: "Groq timed out" });

    expect(screen.getByText("Groq timed out")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText("Groq timed out")).not.toBeInTheDocument();
  });
});
