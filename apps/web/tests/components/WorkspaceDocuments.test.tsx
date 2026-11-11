/**
 * @module web/tests/components/WorkspaceDocuments
 * @description The settings Documents tab beyond create and delete: inline
 * rename (pen, Enter, Escape, blur, validation, no-op, server refusal),
 * download buttons, keyword search with safe excerpts and opening a result, and
 * the list following `document:*` events live.
 */
import "./testUtils";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientDocument } from "../../api/document";
import {
  DocEditorRefProvider,
  useDocEditorRef,
} from "../../components/DocEditorRefContext";
import WorkspaceSettings from "../../components/WorkspaceSettings";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import { workspace } from "../msw/meetingFixtures";
import { server } from "../msw/server";
import { fakeSocket } from "./fakeSocket";
import { preflight } from "./testUtils";

vi.mock(
  "../../lib/socket",
  async () => (await import("./fakeSocket")).socketModule,
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

const exportToBlob = vi.hoisted(() =>
  vi.fn(async () => new Blob(["png-bytes"], { type: "image/png" })),
);
vi.mock("@excalidraw/excalidraw", () => ({ exportToBlob }));

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

function renderTab(onAddTab = vi.fn()) {
  function Bridge() {
    const ref = useDocEditorRef();
    useEffect(() => {
      ref.current = (doc) => onAddTab(doc);
      return () => {
        ref.current = null;
      };
    }, [ref]);
    return null;
  }
  const user = userEvent.setup();
  render(
    <DocEditorRefProvider>
      <Bridge />
      <WorkspaceSettings workspace={workspace} documents={[README, BOARD]} />
    </DocEditorRefProvider>,
  );
  return { user, onAddTab };
}

async function openDocuments(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Documents" }));
}

/** Records PATCH bodies to a document and answers with `respond`. */
function patchDocument(
  id: string,
  respond: (title: string) => Response = (title) => ok({ id, title }),
) {
  const bodies: Array<{ title: string }> = [];
  server.use(
    http.patch(`${BACKEND_URL}/api/document/${id}`, async ({ request }) => {
      const body = (await request.json()) as { title: string };
      bodies.push(body);
      return respond(body.title);
    }),
  );
  return bodies;
}

beforeEach(() => {
  fakeSocket.reset();
  exportToBlob.mockClear();
  server.use(preflight);
});

describe("Documents tab: rename", () => {
  it("turns the title into an input from the pen and saves on Enter", async () => {
    const bodies = patchDocument(README.id);
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Rename "Readme"' }));
    const input = screen.getByRole("textbox", { name: /Title of "Readme"/ });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "  Handbook {Enter}");

    await waitFor(() => expect(bodies).toEqual([{ title: "Handbook" }]));
    expect(await screen.findByText("Handbook")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'Rename "Handbook"' }),
    ).toBeInTheDocument();
  });

  it("saves when the field loses focus", async () => {
    const bodies = patchDocument(README.id);
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Rename "Readme"' }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Blurred");
    await user.tab();

    await waitFor(() => expect(bodies).toEqual([{ title: "Blurred" }]));
    expect(await screen.findByText("Blurred")).toBeInTheDocument();
  });

  it("cancels on Escape without a request, and the blur that follows does not save", async () => {
    const bodies = patchDocument(README.id);
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Rename "Readme"' }));
    await user.type(screen.getByRole("textbox"), "-edited{Escape}");
    await user.click(document.body);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Readme")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("does nothing when the title is unchanged", async () => {
    const bodies = patchDocument(README.id);
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Rename "Readme"' }));
    await user.type(screen.getByRole("textbox"), "{Enter}");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("refuses an empty title with a message and keeps the field open", async () => {
    const bodies = patchDocument(README.id);
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Rename "Readme"' }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "   {Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Title cannot be empty.",
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);

    // Typing again clears the message.
    await user.type(screen.getByRole("textbox"), "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses a title over 100 characters", async () => {
    const bodies = patchDocument(README.id);
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Rename "Readme"' }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.click(input);
    await user.paste("t".repeat(101));
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Title must be at most 100 characters.",
    );
    expect(bodies).toHaveLength(0);
  });

  it("shows the server's refusal inline and keeps the field open", async () => {
    patchDocument(README.id, () => fail(404, "Document not found"));
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Rename "Readme"' }));
    await user.type(screen.getByRole("textbox"), "2{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Document not found",
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

describe("Documents tab: download", () => {
  const saved: Array<{ name: string; blob: Blob | MediaSource }> = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    saved.length = 0;
    let lastBlob: Blob | MediaSource | null = null;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      lastBlob = blob;
      return "blob:fake";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ name: this.download, blob: lastBlob! });
    });
  });

  it("saves a markdown document as a .md file from the export", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/${README.id}/export`, () =>
        ok({ type: "MARKDOWN", title: "Readme", markdown: "# Hello\n" }),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Download "Readme"' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("Readme.md");
    expect(await (saved[0]!.blob as Blob).text()).toBe("# Hello\n");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("renders a canvas to a PNG and saves it", async () => {
    const elements = [{ id: "a", type: "rectangle", isDeleted: false }];
    server.use(
      http.get(`${BACKEND_URL}/api/document/${BOARD.id}/export`, () =>
        ok({ type: "CANVAS", title: "Board", elements }),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Download "Board"' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("Board.png");
    expect(exportToBlob).toHaveBeenCalledWith(
      expect.objectContaining({ elements, mimeType: "image/png" }),
    );
  });

  it("says so instead of saving an empty canvas", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/${BOARD.id}/export`, () =>
        ok({ type: "CANVAS", title: "Board", elements: [] }),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Download "Board"' }));

    expect(await screen.findByText(/nothing to download/i)).toBeInTheDocument();
    expect(saved).toHaveLength(0);
    expect(exportToBlob).not.toHaveBeenCalled();
  });

  it("shows the server's message when the export fails", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/${README.id}/export`, () =>
        fail(404, "Document not found"),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Download "Readme"' }));

    expect(await screen.findByText("Document not found")).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it("reports a canvas that cannot be rendered", async () => {
    exportToBlob.mockRejectedValueOnce(new Error("boom"));
    server.use(
      http.get(`${BACKEND_URL}/api/document/${BOARD.id}/export`, () =>
        ok({
          type: "CANVAS",
          title: "Board",
          elements: [{ id: "a", type: "rectangle" }],
        }),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Download "Board"' }));

    expect(
      await screen.findByText("The canvas could not be rendered."),
    ).toBeInTheDocument();
  });

  it("names the file from a title that cannot be used as one", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/${README.id}/export`, () =>
        ok({
          type: "MARKDOWN",
          title: '..\\evil/<path>: "x"?',
          markdown: "x",
        }),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.click(screen.getByRole("button", { name: 'Download "Readme"' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("evil path x.md");
  });
});

describe("Documents tab: search", () => {
  const hit = (over: Record<string, unknown> = {}) => ({
    documentId: README.id,
    title: "Readme",
    type: "MARKDOWN",
    updatedAt: "2026-11-01T00:00:00.000Z",
    snippet: "restart the <mark>pump</mark> first",
    ...over,
  });

  it("searches on submit and shows title, type and a highlighted excerpt", async () => {
    const queries: string[] = [];
    server.use(
      http.get(`${BACKEND_URL}/api/document/search`, ({ request }) => {
        const url = new URL(request.url);
        queries.push(
          `${url.searchParams.get("workspaceId")}|${url.searchParams.get("q")}`,
        );
        return ok({ hits: [hit()] });
      }),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.type(
      screen.getByRole("searchbox", { name: "Search documents" }),
      "pump{Enter}",
    );

    const result = await screen.findByTestId("document-hit");
    expect(queries).toEqual([`${workspace.id}|pump`]);
    expect(within(result).getByText("Readme")).toBeInTheDocument();
    expect(within(result).getByText("MARKDOWN")).toBeInTheDocument();
    expect(result.querySelector("mark")).toHaveTextContent("pump");
    expect(result).toHaveTextContent("restart the pump first");
  });

  it("renders document text as text, never as markup", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/search`, () =>
        ok({
          hits: [
            hit({
              snippet:
                '<img src=x onerror="alert(1)"> and <mark>pump</mark><script>boom()</script>',
            }),
          ],
        }),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.type(screen.getByRole("searchbox"), "pump{Enter}");

    const result = await screen.findByTestId("document-hit");
    expect(result.querySelector("img")).toBeNull();
    expect(result.querySelector("script")).toBeNull();
    expect(result.querySelectorAll("mark")).toHaveLength(1);
    expect(result).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  it("opens the chosen document through the add-tab bridge", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/search`, () =>
        ok({ hits: [hit()] }),
      ),
      http.get(`${BACKEND_URL}/api/document/${README.id}`, () =>
        ok({
          id: README.id,
          title: "Readme",
          type: "MARKDOWN",
          canvasData: null,
          yjsState: null,
        }),
      ),
    );
    const { user, onAddTab } = renderTab();
    await openDocuments(user);
    await user.type(screen.getByRole("searchbox"), "pump{Enter}");

    await user.click(await screen.findByTestId("document-hit"));

    await waitFor(() =>
      expect(onAddTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: README.id, label: "Readme" }),
      ),
    );
  });

  it("says when nothing matches, and Clear returns to the list", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/search`, () => ok({ hits: [] })),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.type(screen.getByRole("searchbox"), "zzz{Enter}");
    expect(await screen.findByText(/No documents match/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/No documents match/)).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("shows the failure message", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/search`, () =>
        fail(404, "Workspace not found"),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.type(screen.getByRole("searchbox"), "x{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Workspace not found",
    );
  });

  it("reports a result that cannot be opened", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/search`, () =>
        ok({ hits: [hit()] }),
      ),
      http.get(`${BACKEND_URL}/api/document/${README.id}`, () =>
        HttpResponse.json({ success: false }, { status: 404 }),
      ),
    );
    const { user } = renderTab();
    await openDocuments(user);
    await user.type(screen.getByRole("searchbox"), "pump{Enter}");

    await user.click(await screen.findByTestId("document-hit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That document could not be opened.",
    );
  });

  it("ignores a result that lands after the search was cleared", async () => {
    let release: () => void = () => {};
    server.use(
      http.get(`${BACKEND_URL}/api/document/search`, async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return ok({ hits: [hit()] });
      }),
    );
    const { user } = renderTab();
    await openDocuments(user);

    await user.type(screen.getByRole("searchbox"), "pump{Enter}");
    await screen.findByText("Searching…");
    await user.clear(screen.getByRole("searchbox"));
    release();

    await waitFor(() =>
      expect(screen.queryByText("Searching…")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("document-hit")).not.toBeInTheDocument();
  });
});

describe("Documents tab: live updates", () => {
  it("adds, retitles and removes rows as the server announces them", async () => {
    const { user } = renderTab();
    await openDocuments(user);

    act(() =>
      fakeSocket.fire("document:created", {
        document: {
          id: "cm_document_new",
          title: "Fresh",
          type: "CANVAS",
          workspaceId: workspace.id,
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      }),
    );
    expect(await screen.findByText("Fresh")).toBeInTheDocument();

    // The same announcement again does not add a second row.
    act(() =>
      fakeSocket.fire("document:created", {
        document: {
          id: "cm_document_new",
          title: "Fresh",
          type: "CANVAS",
          workspaceId: workspace.id,
          createdAt: "x",
          updatedAt: "x",
        },
      }),
    );
    expect(screen.getAllByText("Fresh")).toHaveLength(1);

    act(() =>
      fakeSocket.fire("document:renamed", {
        documentId: README.id,
        title: "Renamed elsewhere",
      }),
    );
    expect(await screen.findByText("Renamed elsewhere")).toBeInTheDocument();
    expect(screen.queryByText("Readme")).not.toBeInTheDocument();

    act(() =>
      fakeSocket.fire("document:deleted", {
        documentId: BOARD.id,
        deletedById: "someone",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Board")).not.toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("document-row")).toHaveLength(2);
  });
});
