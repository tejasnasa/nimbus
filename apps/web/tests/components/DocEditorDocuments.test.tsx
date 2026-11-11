/**
 * @module web/tests/components/DocEditorDocuments
 * @description The tabbed editor following the workspace's documents live:
 * `document:created` adds a tab without taking the selection, `document:renamed`
 * retitles one, `document:deleted` replaces the editor of an open tab with a
 * clear notice, and a document announced both ways (`document:created` and
 * `doc:ai:complete`) ends up as exactly one tab.
 */
import "./testUtils";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientDocument } from "../../api/document";
import DocEditor from "../../components/DocEditor";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";
import { fakeSocket } from "./fakeSocket";

vi.mock(
  "../../lib/socket",
  async () => (await import("./fakeSocket")).socketModule,
);
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

const README: ClientDocument = {
  id: "cm_document_readme",
  label: "Readme",
  type: "MARKDOWN",
  elements: [],
  yjsState: null,
};
const BOARD: ClientDocument = {
  id: "cm_document_board",
  label: "Board",
  type: "CANVAS",
  elements: [],
  yjsState: null,
};

const summary = (id: string, title: string, type = "MARKDOWN") => ({
  id,
  title,
  type,
  workspaceId: "ws",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});

function renderEditor() {
  return render(
    <DocEditorRefProvider>
      <DocEditor
        documents={[README, BOARD]}
        user={{ id: "user-me", name: "Me", image: null }}
      />
    </DocEditorRefProvider>,
  );
}

const fire = (event: string, payload: unknown) =>
  act(() => fakeSocket.fire(event, payload));

beforeEach(() => fakeSocket.reset());

describe("DocEditor: document events", () => {
  it("adds a created document as a background tab, once", () => {
    renderEditor();

    fire("document:created", { document: summary("cm_new", "Fresh") });
    fire("document:created", { document: summary("cm_new", "Fresh") });

    expect(screen.getAllByText("Fresh")).toHaveLength(1);
    // The selection stays where it was.
    expect(screen.getByTestId("markdown")).toHaveTextContent(README.id);
  });

  it("retitles a tab when its document is renamed", () => {
    renderEditor();

    fire("document:renamed", { documentId: BOARD.id, title: "Whiteboard" });

    expect(screen.getByText("Whiteboard")).toBeInTheDocument();
    expect(screen.queryByText("Board")).not.toBeInTheDocument();
  });

  it("ignores a rename of a document with no tab", () => {
    renderEditor();

    fire("document:renamed", { documentId: "cm_other", title: "Nope" });

    expect(screen.queryByText("Nope")).not.toBeInTheDocument();
  });

  it("replaces the editor of the open tab when its document is deleted", () => {
    renderEditor();

    fire("document:deleted", {
      documentId: README.id,
      deletedById: "user-other",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This document was deleted",
    );
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
  });

  it("shows the notice when a deleted tab is selected later, and leaves others alone", async () => {
    const user = userEvent.setup();
    renderEditor();

    fire("document:deleted", {
      documentId: BOARD.id,
      deletedById: "user-other",
    });
    expect(screen.queryByTestId("document-deleted")).not.toBeInTheDocument();
    expect(screen.getByTestId("markdown")).toBeInTheDocument();

    await user.click(screen.getByText("Board"));

    expect(screen.getByTestId("document-deleted")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });

  it("simply closes the tab for the person who deleted it", () => {
    renderEditor();

    fire("document:deleted", { documentId: README.id, deletedById: "user-me" });

    expect(screen.queryByTestId("document-deleted")).not.toBeInTheDocument();
    expect(screen.queryByText("Readme")).not.toBeInTheDocument();
    expect(screen.getByText("Board")).toBeInTheDocument();
  });

  it("closes the deleted tab from the notice", async () => {
    const user = userEvent.setup();
    renderEditor();
    fire("document:deleted", {
      documentId: README.id,
      deletedById: "user-other",
    });

    await user.click(
      within(screen.getByTestId("document-deleted")).getByRole("button", {
        name: "Close tab",
      }),
    );

    expect(screen.queryByText("Readme")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toHaveTextContent(BOARD.id);
  });

  it("ends with one tab when a generated document is announced before it completes", async () => {
    renderEditor();

    fire("doc:ai:start", { type: "MARKDOWN", label: "Generated" });
    fire("document:created", { document: summary("cm_gen", "Generated") });
    fire("doc:ai:complete", {
      documentId: "cm_gen",
      label: "Generated",
      type: "MARKDOWN",
    });

    await waitFor(() =>
      expect(screen.getByTestId("markdown")).toHaveTextContent("cm_gen"),
    );
    expect(screen.getAllByText("Generated")).toHaveLength(1);
  });

  it("ends with one tab when the announcement lands after the generation completed", async () => {
    renderEditor();

    fire("doc:ai:start", { type: "MARKDOWN", label: "Generated" });
    fire("doc:ai:complete", {
      documentId: "cm_gen",
      label: "Generated",
      type: "MARKDOWN",
    });
    await waitFor(() =>
      expect(screen.getByTestId("markdown")).toHaveTextContent("cm_gen"),
    );
    fire("document:created", { document: summary("cm_gen", "Generated") });

    expect(screen.getAllByText("Generated")).toHaveLength(1);
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = renderEditor();
    expect(fakeSocket.listenerCount("document:deleted")).toBe(1);

    unmount();

    expect(fakeSocket.listenerCount("document:deleted")).toBe(0);
    expect(fakeSocket.listenerCount("document:created")).toBe(0);
    expect(fakeSocket.listenerCount("document:renamed")).toBe(0);
  });
});
