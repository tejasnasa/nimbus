/**
 * @module web/tests/components/DocEditor
 * @description Smoke coverage for the tabbed editor shell. The two editors it
 * hosts are stubbed so the test does not drag in Excalidraw or Milkdown; what is
 * asserted is the shell's own wiring: the tab strip reflects the documents it
 * was handed, and the NimbusBot socket events drive the generating pseudo-tab
 * and its overlay.
 */
import "./testUtils";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { ClientDocument } from "../../api/document";
import DocEditor from "../../components/DocEditor";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import { server } from "../msw/server";

/** Props the shell handed to the stubbed editors, so tests can drive them. */
const editorProps = vi.hoisted(() => ({
  canvas: null as null | {
    user?: unknown;
    onPeersChange?: (peers: unknown[]) => void;
  },
  markdown: null as null | {
    user?: unknown;
    onPeersChange?: (peers: unknown[]) => void;
  },
}));

vi.mock("../../components/Canvas", () => ({
  default: (props: { documentId: string }) => {
    editorProps.canvas = props as never;
    return <div data-testid="canvas">{props.documentId}</div>;
  },
}));

vi.mock("../../components/MarkdownEditor", () => ({
  MarkdownEditor: (props: { documentId: string }) => {
    editorProps.markdown = props as never;
    return <div data-testid="markdown">{props.documentId}</div>;
  },
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

/**
 * The close button for the tab at `index`, in strip order.
 *
 * @param index - Position of the tab in the strip.
 */
function closeButtonAt(index: number): HTMLElement {
  const button = screen.getAllByTitle("Close tab")[index];
  if (!button) throw new Error(`no close button at index ${index}`);
  return button;
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

  /**
   * Tab list and selection live in one state object so no setter is ever called
   * from inside another's updater — React may run an updater more than once,
   * and a selection change buried in one would fire twice or be dropped.
   */
  it("moves the selection to the previous tab when the active one closes", async () => {
    const user = userEvent.setup();
    renderEditor();

    // Roadmap (index 1) is active; closing it must fall back to Readme (0).
    await user.click(screen.getByText("Roadmap"));
    await user.click(closeButtonAt(1));

    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "cm_document_00000000000001",
    );
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });

  it("keeps the active document selected when an earlier tab closes", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByText("Roadmap"));
    await user.click(closeButtonAt(0));

    // The selection must follow the document, not the index it used to sit at.
    expect(screen.getByTestId("canvas")).toHaveTextContent(
      "cm_document_00000000000002",
    );
  });

  it("clears the generating overlay when its tab is closed", async () => {
    const user = userEvent.setup();
    renderEditor();

    serverEvent("doc:ai:start", { type: "MARKDOWN", label: "Sprint Notes" });
    expect(
      screen.getByRole("heading", { name: 'Creating "Sprint Notes"' }),
    ).toBeInTheDocument();

    // The generating tab is appended last.
    await user.click(
      closeButtonAt(screen.getAllByTitle("Close tab").length - 1),
    );

    expect(
      screen.queryByRole("heading", { name: 'Creating "Sprint Notes"' }),
    ).not.toBeInTheDocument();
  });
});

describe("DocEditor: meeting notes", () => {
  const notes = {
    id: "cm_document_notes0000000001",
    title: "Meeting notes: Launch sync",
    type: "MARKDOWN",
    canvasData: null,
    yjsState: null,
  };

  it("adds the notes document as a tab without taking the selection", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/${notes.id}`, () => ok(notes)),
    );
    renderEditor();
    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "cm_document_00000000000001",
    );

    serverEvent("meeting:notes-ready", {
      meetingId: "m-1",
      documentId: notes.id,
    });

    expect(
      await screen.findByText("Meeting notes: Launch sync"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "cm_document_00000000000001",
    );
  });

  it("does not add the same notes twice", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/${notes.id}`, () => ok(notes)),
    );
    renderEditor();

    serverEvent("meeting:notes-ready", {
      meetingId: "m-1",
      documentId: notes.id,
    });
    await screen.findByText("Meeting notes: Launch sync");
    serverEvent("meeting:notes-ready", {
      meetingId: "m-1",
      documentId: notes.id,
    });
    await waitFor(() =>
      expect(screen.getAllByText("Meeting notes: Launch sync")).toHaveLength(1),
    );
  });

  it("leaves the tabs alone when the notes cannot be read", async () => {
    let asked = false;
    server.use(
      http.get(`${BACKEND_URL}/api/document/${notes.id}`, () => {
        asked = true;
        return fail(403, "Not a member");
      }),
    );
    renderEditor();

    serverEvent("meeting:notes-ready", {
      meetingId: "m-1",
      documentId: notes.id,
    });

    await waitFor(() => expect(asked).toBe(true));
    expect(screen.getAllByTitle("Close tab")).toHaveLength(2);
  });
});

describe("DocEditor presence", () => {
  const signedIn = { id: "u_me", name: "Me Myself", image: null };
  const peer = (name: string) => ({
    userId: `u_${name.toLowerCase()}`,
    name,
    color: "#34d399",
    image: null,
  });

  function renderWithUser() {
    return render(
      <DocEditorRefProvider>
        <DocEditor documents={documents} user={signedIn} />
      </DocEditorRefProvider>,
    );
  }

  it("hands the signed-in user to the markdown editor", () => {
    renderWithUser();

    expect(editorProps.markdown?.user).toEqual({
      id: "u_me",
      name: "Me Myself",
      image: null,
    });
  });

  it("hands the signed-in user to the canvas", async () => {
    const user = userEvent.setup();
    renderWithUser();

    await user.click(screen.getByText("Roadmap"));

    expect(editorProps.canvas?.user).toMatchObject({ id: "u_me" });
  });

  it("shows nobody until the editor reports someone", () => {
    renderWithUser();

    expect(screen.queryByTestId("presence-avatars")).not.toBeInTheDocument();
  });

  it("shows the people the open editor reports, labelled", () => {
    renderWithUser();

    act(() => {
      editorProps.markdown?.onPeersChange?.([peer("Ada"), peer("Grace")]);
    });

    expect(
      screen.getByRole("group", { name: "Also editing: Ada, Grace" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(2);
  });

  it("collapses more than four people into +N", () => {
    renderWithUser();

    act(() => {
      editorProps.markdown?.onPeersChange?.(
        ["Ada", "Bo", "Cy", "Di", "Ed", "Flo"].map(peer),
      );
    });

    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(4);
    expect(screen.getByTestId("presence-overflow")).toHaveTextContent("+2");
  });

  it("shows canvas collaborators the same way", async () => {
    const user = userEvent.setup();
    renderWithUser();
    await user.click(screen.getByText("Roadmap"));

    act(() => {
      editorProps.canvas?.onPeersChange?.([peer("Grace")]);
    });

    expect(
      screen.getByRole("group", { name: "Also editing: Grace" }),
    ).toBeInTheDocument();
  });

  it("removes the strip when the editor reports nobody", () => {
    renderWithUser();
    act(() => {
      editorProps.markdown?.onPeersChange?.([peer("Ada")]);
    });
    expect(screen.getByTestId("presence-avatars")).toBeInTheDocument();

    act(() => {
      editorProps.markdown?.onPeersChange?.([]);
    });

    expect(screen.queryByTestId("presence-avatars")).not.toBeInTheDocument();
  });

  it("does not re-render for an identical list", () => {
    renderWithUser();
    act(() => {
      editorProps.markdown?.onPeersChange?.([peer("Ada")]);
    });
    const strip = screen.getByTestId("presence-avatars");

    act(() => {
      editorProps.markdown?.onPeersChange?.([peer("Ada")]);
    });

    expect(screen.getByTestId("presence-avatars")).toBe(strip);
  });

  it("still renders the editors when no user is given", () => {
    renderEditor();

    expect(editorProps.markdown?.user).toBeUndefined();
    expect(screen.getByTestId("markdown")).toBeInTheDocument();
  });
});
