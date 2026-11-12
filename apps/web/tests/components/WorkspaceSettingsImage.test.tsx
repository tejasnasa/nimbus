/**
 * @module web/tests/components/WorkspaceSettingsImage
 * @description The add-document dialog's "From an image…" shortcut: it uploads
 * the picked picture and posts the same `@nimbusbot turn this into a diagram`
 * chat message a member would type, with the image attached. There is no
 * second code path, so the test pins exactly the `message:send` it produces.
 *
 * The upload hook and the socket are stubbed; their own behaviour has its own
 * suites.
 */
import "./testUtils";
import type { Workspace } from "@nimbus/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceSettings from "../../components/WorkspaceSettings";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock("../../lib/socket", () => ({
  socket: { emit, on: vi.fn(), off: vi.fn() },
}));

const upload = vi.hoisted(() => ({
  state: { status: "idle" } as
    | { status: "idle" }
    | { status: "uploading"; progress: number; previewUrl: string }
    | { status: "error"; message: string },
  upload: vi.fn(),
  reset: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../../hooks/useChatImageUpload", () => ({
  CHAT_IMAGE_ACCEPT: "image/jpeg,image/png",
  useChatImageUpload: () => ({
    state: upload.state,
    upload: upload.upload,
    reset: upload.reset,
    cancel: upload.cancel,
  }),
}));

const workspace: Workspace = {
  id: "cm_workspace_0000000000000",
  name: "Design Guild",
  description: "Shared drafts",
  slug: "design-guild",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members: [{ id: "user-1", name: "Ada", image: null, role: "OWNER" }],
};

const IMAGE =
  "https://res.cloudinary.com/demo/image/upload/v1/nimbus/chat/ws/pic.jpg";

async function openDialog() {
  const user = userEvent.setup();
  render(
    <DocEditorRefProvider>
      <WorkspaceSettings workspace={workspace} documents={[]} />
    </DocEditorRefProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Documents" }));
  await user.click(screen.getByRole("button", { name: "+ Add Document" }));
  return user;
}

const png = () =>
  new File([new Uint8Array(8)], "board.png", { type: "image/png" });

beforeEach(() => {
  emit.mockReset();
  upload.state = { status: "idle" };
  upload.upload.mockReset();
  upload.reset.mockReset();
});

describe("Add document: from an image", () => {
  it("uploads the picture and asks NimbusBot to diagram it", async () => {
    upload.upload.mockResolvedValue(IMAGE);
    const user = await openDialog();

    await user.upload(screen.getByTestId("doc-image-input"), png());

    await waitFor(() =>
      expect(emit).toHaveBeenCalledWith("message:send", {
        workspaceId: workspace.id,
        content: "@nimbusbot turn this into a diagram",
        imageUrl: IMAGE,
        timeZone: expect.any(String),
      }),
    );
    expect(upload.upload).toHaveBeenCalledTimes(1);
    expect(upload.reset).toHaveBeenCalled();
  });

  it("opens the file picker from the button", async () => {
    const user = await openDialog();
    const input = screen.getByTestId("doc-image-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    await user.click(screen.getByTestId("doc-from-image"));

    expect(click).toHaveBeenCalled();
  });

  it("posts nothing when the upload fails", async () => {
    upload.upload.mockResolvedValue(null);
    const user = await openDialog();

    await user.upload(screen.getByTestId("doc-image-input"), png());

    await waitFor(() => expect(upload.upload).toHaveBeenCalled());
    expect(emit).not.toHaveBeenCalled();
  });

  it("shows why an upload failed", async () => {
    upload.state = { status: "error", message: "Image must be at most 10 MB." };
    await openDialog();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Image must be at most 10 MB.",
    );
  });
});
