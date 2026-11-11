/**
 * @module web/tests/components/ChatDocLinks
 * @description Document links in chat: `[label](nimbus-doc:<id>)` in someone
 * else's message becomes a button that opens that document through the editor's
 * add-tab bridge (fetching it first), while everything else in the message, HTML
 * and other link schemes included, stays plain text.
 */
import "./testUtils";
import type { Message } from "@nimbus/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientDocument } from "../../api/document";
import Chat from "../../components/Chat";
import ChatMessageText, { hasDocLink } from "../../components/ChatMessageText";
import {
  DocEditorRefProvider,
  useDocEditorRef,
} from "../../components/DocEditorRefContext";
import { WorkspaceSettingsProvider } from "../../components/WorkspaceSettingsContext";
import { aiStatus } from "../msw/aiFixtures";
import { BACKEND_URL, fail, ok } from "../msw/handlers";
import { workspace } from "../msw/meetingFixtures";
import { server } from "../msw/server";
import { fakeSocket } from "./fakeSocket";

vi.mock("@nimbus/ui/icons/Chat", () => ({
  default: () => <div data-testid="icon-chat" />,
}));
vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => ({
    isConnected: false,
    isMuted: false,
    isDeafened: false,
    voiceUsers: [],
    participants: [],
    speakingUsers: new Set<string>(),
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    isJoining: false,
    connectionState: "disconnected",
    error: null,
    canRejoin: false,
    localUser: { userId: "user-1", name: "Ada", image: null },
  }),
}));
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

const message = (over: Partial<Message> = {}): Message => ({
  id: "m-1",
  userId: "user-2",
  workspaceId: "ws-1",
  name: "NimbusBot",
  content: "",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

const NOTES =
  "Notes from the call are ready: Launch sync.\n[Meeting notes: Launch sync (1 Nov)](nimbus-doc:doc-notes_1)";

function AddTabProbe({ onAdd }: { onAdd: (doc: ClientDocument) => void }) {
  const ref = useDocEditorRef();
  ref.current = onAdd;
  return null;
}

function renderChat(
  messages: Message[],
  onAdd: (doc: ClientDocument) => void = () => {},
) {
  return render(
    <DocEditorRefProvider>
      <AddTabProbe onAdd={onAdd} />
      <WorkspaceSettingsProvider workspace={workspace} documents={[]}>
        <Chat
          userId="user-1"
          messages={messages}
          wsid="ws-1"
          initialAiStatus={aiStatus()}
        />
      </WorkspaceSettingsProvider>
    </DocEditorRefProvider>,
  );
}

beforeEach(() => {
  fakeSocket.reset();
  server.resetHandlers();
});

describe("Chat: document links", () => {
  it("shows the label as a button, keeps the surrounding text, and opens the document", async () => {
    const opened: ClientDocument[] = [];
    server.use(
      http.get(`${BACKEND_URL}/api/document/doc-notes_1`, () =>
        ok({
          id: "doc-notes_1",
          title: "Meeting notes: Launch sync (1 Nov)",
          type: "MARKDOWN",
          canvasData: null,
          yjsState: null,
        }),
      ),
    );
    renderChat([message({ content: NOTES })], (doc) => opened.push(doc));
    const user = userEvent.setup();

    expect(
      screen.getByText("Notes from the call are ready: Launch sync.", {
        exact: false,
      }),
    ).toBeInTheDocument();
    const link = screen.getByRole("button", {
      name: "Meeting notes: Launch sync (1 Nov)",
    });
    expect(screen.queryByText(/nimbus-doc:/)).not.toBeInTheDocument();

    await user.click(link);

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatchObject({
      id: "doc-notes_1",
      label: "Meeting notes: Launch sync (1 Nov)",
      type: "MARKDOWN",
    });
  });

  it("says so when the document cannot be opened", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/document/doc-notes_1`, () =>
        fail(403, "Not a member"),
      ),
    );
    const opened: ClientDocument[] = [];
    renderChat([message({ content: NOTES })], (doc) => opened.push(doc));
    const user = userEvent.setup();

    await user.click(screen.getByTestId("chat-doc-link"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That document could not be opened.",
    );
    expect(opened).toHaveLength(0);
  });

  it("renders other messages as plain text", () => {
    renderChat([message({ content: "just a regular message" })]);

    expect(screen.getByText("just a regular message")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-doc-link")).not.toBeInTheDocument();
  });
});

describe("ChatMessageText", () => {
  const open = vi.fn();
  beforeEach(() => open.mockClear());

  it("never turns text into markup", () => {
    const { container } = render(
      <ChatMessageText
        text={
          '<img src=x onerror="alert(1)"> <b>bold</b> **x** [a](javascript:alert(1)) [b](https://example.com)'
        }
        onOpenDocument={open}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container).toHaveTextContent("<img src=x");
    expect(container).toHaveTextContent("[a](javascript:alert(1))");
  });

  it("does not make a link of HTML inside a label", () => {
    const { container } = render(
      <ChatMessageText
        text="[<img src=x onerror=alert(1)>](nimbus-doc:abc)"
        onOpenDocument={open}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("chat-doc-link")).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("only links ids made of safe characters", () => {
    const { container } = render(
      <ChatMessageText
        text="[x](nimbus-doc:../secret) [y](nimbus-doc:a b) [z](nimbus-doc:)"
        onOpenDocument={open}
      />,
    );

    expect(container.querySelector("button")).toBeNull();
  });

  it("opens each link with its own id and keeps the text between them", async () => {
    render(
      <ChatMessageText
        text="First [one](nimbus-doc:a1) then [two](nimbus-doc:b2) done"
        onOpenDocument={open}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "two" }));
    await user.click(screen.getByRole("button", { name: "one" }));

    expect(open.mock.calls).toEqual([["b2"], ["a1"]]);
    expect(document.body).toHaveTextContent("First one then two done");
  });

  it("detects whether a message holds a link", () => {
    expect(hasDocLink("see [x](nimbus-doc:abc)")).toBe(true);
    expect(hasDocLink("see [x](https://example.com)")).toBe(false);
    expect(hasDocLink("nimbus-doc:abc")).toBe(false);
  });
});
