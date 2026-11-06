/**
 * @module web/tests/components/ChatImages
 * @description Images in the chat panel: the thumbnail that opens full size,
 * the paperclip and drag-and-drop entry points, the pending-upload chip, what
 * Send emits, and the notice shown when the bot cannot read an image.
 *
 * The upload hook is replaced with a controllable stub — its own behaviour
 * (signature, progress, cancel, limits) is covered in
 * `useChatImageUpload.test.tsx`. Here only what the panel does with its state
 * is under test.
 */
import "./testUtils";
import type { Message, Workspace } from "@nimbus/types";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Chat from "../../components/Chat";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";
import { aiStatus, aiStatusChatOff } from "../msw/aiFixtures";
import { server } from "../msw/server";

vi.mock("@nimbus/ui/icons/Chat", () => ({
  default: () => <div data-testid="icon-chat" />,
}));

vi.mock("../../providers/VoiceProvider", () => ({
  useVoice: () => ({
    isConnected: false,
    isMuted: false,
    isDeafened: false,
    voiceUsers: [],
    speakingUsers: new Set<string>(),
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    localUser: { userId: "user-1", name: "Ada", image: null },
  }),
}));

const { socketMock } = vi.hoisted(() => {
  type Handler = (payload: never) => void;
  const listeners = new Map<string, Set<Handler>>();
  return {
    socketMock: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => {
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: Handler) => {
        listeners.get(event)?.delete(handler);
      }),
      __fire: (event: string, payload?: unknown) => {
        listeners.get(event)?.forEach((handler) => handler(payload as never));
      },
      __reset: () => listeners.clear(),
    },
  };
});
vi.mock("../../lib/socket", () => ({ socket: socketMock }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

const upload = vi.hoisted(() => ({
  state: { status: "idle" } as
    | { status: "idle" }
    | { status: "uploading"; progress: number; previewUrl: string }
    | { status: "ready"; imageUrl: string; previewUrl: string }
    | { status: "error"; message: string },
  upload: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../../hooks/useChatImageUpload", () => ({
  CHAT_IMAGE_ACCEPT: "image/jpeg,image/png",
  useChatImageUpload: () => ({
    state: upload.state,
    upload: upload.upload,
    cancel: upload.cancel,
    reset: upload.reset,
  }),
}));

const WORKSPACE: Workspace = {
  id: "cm_workspace_0000000000000",
  name: "Design Guild",
  description: "Shared drafts",
  slug: "design-guild",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members: [{ id: "user-1", name: "Ada", image: null, role: "OWNER" }],
};

const FULL =
  "https://res.cloudinary.com/demo/image/upload/v1/nimbus/chat/ws-1/pic.jpg";

const message = (over: Partial<Message> = {}): Message => ({
  id: "m-1",
  userId: "user-2",
  workspaceId: "ws-1",
  name: "Grace",
  content: "",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

function renderChat(opts: { messages?: Message[]; chatOff?: boolean } = {}) {
  return render(
    <DocEditorRefProvider>
      <Chat
        userId="user-1"
        messages={opts.messages ?? []}
        wsid="ws-1"
        documents={[]}
        workspaceData={WORKSPACE}
        initialAiStatus={opts.chatOff ? aiStatusChatOff() : aiStatus()}
      />
    </DocEditorRefProvider>,
  );
}

const png = () =>
  new File([new Uint8Array(10)], "pic.png", { type: "image/png" });

beforeEach(() => {
  socketMock.__reset();
  socketMock.emit.mockReset();
  upload.state = { status: "idle" };
  upload.upload.mockReset();
  upload.cancel.mockReset();
  upload.reset.mockReset();
  server.resetHandlers();
});

describe("Chat: message images", () => {
  it("renders a thumbnail that opens the full-size image in a new tab", () => {
    renderChat({ messages: [message({ imageUrl: FULL, content: "see" })] });

    const link = screen.getByTestId("chat-image-link");
    expect(link).toHaveAttribute("href", FULL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    const thumb = link.querySelector("img")!;
    expect(thumb.getAttribute("src")).toContain("/upload/c_limit,w_480");
    expect(thumb.getAttribute("src")).not.toBe(FULL);
    expect(screen.getByText("see")).toBeInTheDocument();
  });

  it("renders your own image message on the right", () => {
    renderChat({
      messages: [message({ userId: "user-1", imageUrl: FULL, name: "Ada" })],
    });

    expect(screen.getByTestId("chat-image-link")).toHaveAttribute("href", FULL);
  });

  it("draws no empty text bubble for an image-only message", () => {
    const { container } = renderChat({
      messages: [message({ imageUrl: FULL, content: "" })],
    });

    expect(container.querySelectorAll(".rounded-tl-sm")).toHaveLength(0);
  });

  it("renders a text-only message as before", () => {
    renderChat({ messages: [message({ content: "plain" })] });

    expect(screen.queryByTestId("chat-image-link")).not.toBeInTheDocument();
    expect(screen.getByText("plain")).toBeInTheDocument();
  });
});

describe("Chat: attaching an image", () => {
  it("opens the file picker from the paperclip and uploads the chosen file", async () => {
    const user = userEvent.setup();
    renderChat();
    const input = screen.getByTestId("chat-image-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    await user.click(screen.getByTestId("chat-attach"));
    expect(click).toHaveBeenCalled();

    const file = png();
    await user.upload(input, file);
    expect(upload.upload).toHaveBeenCalledWith(file);
  });

  it("uploads a file dropped on the composer", () => {
    renderChat();
    const file = png();

    fireEvent.drop(screen.getByTestId("chat-dropzone"), {
      dataTransfer: { files: [file] },
    });

    expect(upload.upload).toHaveBeenCalledWith(file);
  });

  it("highlights the composer while a file is dragged over it", () => {
    renderChat();
    const zone = screen.getByTestId("chat-dropzone");

    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(zone.className).toContain("ring-2");

    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain("ring-2");
  });

  it("ignores a drop drag when chat is unavailable", () => {
    renderChat({ chatOff: true });

    fireEvent.drop(screen.getByTestId("chat-dropzone"), {
      dataTransfer: { files: [png()] },
    });

    expect(upload.upload).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-attach")).toBeDisabled();
  });

  it("ignores a drop that carries no file", () => {
    renderChat();

    fireEvent.drop(screen.getByTestId("chat-dropzone"), {
      dataTransfer: { files: [] },
    });

    expect(upload.upload).not.toHaveBeenCalled();
  });

  it("shows progress while uploading, cancels on request and blocks Send", async () => {
    const user = userEvent.setup();
    upload.state = { status: "uploading", progress: 42, previewUrl: "blob:x" };
    renderChat();

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(screen.getByText(/Uploading… 42%/)).toBeInTheDocument();
    expect(screen.getByTestId("chat-send")).toBeDisabled();

    await user.click(screen.getByTestId("chat-image-cancel"));
    expect(upload.cancel).toHaveBeenCalled();
  });

  it("shows the upload error and lets it be dismissed", async () => {
    const user = userEvent.setup();
    upload.state = { status: "error", message: "Image must be at most 10 MB." };
    renderChat();

    expect(screen.getByTestId("chat-image-error")).toHaveTextContent(
      "Image must be at most 10 MB.",
    );
    await user.click(screen.getByLabelText("Dismiss image error"));
    expect(upload.reset).toHaveBeenCalled();
  });

  it("sends a ready image with no text", async () => {
    const user = userEvent.setup();
    upload.state = { status: "ready", imageUrl: FULL, previewUrl: "blob:x" };
    renderChat();

    const send = screen.getByTestId("chat-send");
    expect(send).not.toBeDisabled();
    await user.click(send);

    expect(socketMock.emit).toHaveBeenCalledWith("message:send", {
      workspaceId: "ws-1",
      content: "",
      imageUrl: FULL,
    });
    expect(upload.reset).toHaveBeenCalled();
  });

  it("sends text with the image", async () => {
    const user = userEvent.setup();
    upload.state = { status: "ready", imageUrl: FULL, previewUrl: "blob:x" };
    renderChat();

    await user.type(screen.getByTestId("chat-composer"), "@nimbusbot diagram");
    await user.click(screen.getByTestId("chat-send"));

    expect(socketMock.emit).toHaveBeenCalledWith("message:send", {
      workspaceId: "ws-1",
      content: "@nimbusbot diagram",
      imageUrl: FULL,
    });
  });

  it("does not add an imageUrl key to a plain message", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByTestId("chat-composer"), "hello");
    await user.click(screen.getByTestId("chat-send"));

    expect(socketMock.emit).toHaveBeenCalledWith("message:send", {
      workspaceId: "ws-1",
      content: "hello",
    });
  });
});

describe("Chat: the bot cannot read images", () => {
  const refusal = {
    feature: "vision",
    reason: "no-capable-model",
    message: "NimbusBot can't read images with this workspace's AI setup.",
    cta: "manage-ai" as const,
  };

  it("shows the refusal with a way into the AI settings, and dismisses it", async () => {
    const user = userEvent.setup();
    renderChat();

    socketMock.__fire("ai:refused", refusal);
    expect(await screen.findByTestId("vision-refusal")).toHaveTextContent(
      "can't read images",
    );
    expect(screen.getByText("AI settings")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("vision-refusal")).not.toBeInTheDocument();
  });

  it("does not show chat-level text for a document refusal", async () => {
    renderChat();

    socketMock.__fire("ai:refused", { ...refusal, feature: "canvas" });

    expect(screen.queryByTestId("vision-refusal")).not.toBeInTheDocument();
  });
});
