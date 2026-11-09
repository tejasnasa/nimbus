/**
 * @module web/tests/components/CaptionSettingsPanel
 * @description The settings Captions tab and the preference hook behind it:
 * size, contrast and line count changed from the tab, saved per user, shown in
 * the preview, carried live to every other instance of the hook (a captions
 * bar already on screen), and still usable when storage refuses writes.
 */
import "./testUtils";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CaptionSettingsPanel from "../../components/CaptionSettingsPanel";
import { DocEditorRefProvider } from "../../components/DocEditorRefContext";
import WorkspaceSettings from "../../components/WorkspaceSettings";
import {
  DEFAULT_CAPTION_PREFS,
  prefsKey,
  readPrefs,
  useCaptionPrefs,
} from "../../hooks/useCaptionPrefs";
import type { Workspace } from "@nimbus/types";
import { aiStatus } from "../msw/aiFixtures";
import { BACKEND_URL, ok } from "../msw/handlers";
import { server } from "../msw/server";
import { preflight } from "./testUtils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/workspace/1",
  useParams: () => ({ slugId: "1" }),
  useSearchParams: () => new URLSearchParams(),
}));

const WS = "cm_workspace_0000000000000";
const workspace: Workspace = {
  id: WS,
  name: "Design Guild",
  description: "Shared drafts",
  slug: "design-guild",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members: [{ id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" }],
};

const stored = (userId: string) =>
  JSON.parse(window.localStorage.getItem(prefsKey(userId))!);

beforeEach(() => {
  window.localStorage.clear();
  server.resetHandlers();
  server.use(preflight);
});

describe("CaptionSettingsPanel", () => {
  it("starts from the defaults with a three-line preview", () => {
    render(<CaptionSettingsPanel userId="u1" />);

    expect(screen.getByTestId("caption-size-m")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("caption-high-contrast")).not.toBeChecked();
    expect(screen.getAllByTestId("caption-preview-line")).toHaveLength(3);
    expect(screen.getByTestId("caption-preview").className).not.toContain(
      "bg-black",
    );
  });

  it("changes size, contrast and lines, saving them for this user", async () => {
    render(<CaptionSettingsPanel userId="u1" />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("caption-size-l"));
    await user.click(screen.getByTestId("caption-high-contrast"));
    await user.click(screen.getByTestId("caption-lines"));
    await user.click(screen.getByRole("option", { name: "6 lines" }));

    expect(screen.getByTestId("caption-size-l")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByTestId("caption-preview-line")).toHaveLength(6);
    const preview = screen.getByTestId("caption-preview");
    expect(preview.className).toContain("bg-black");
    expect(preview.firstElementChild!.className).toContain("text-lg");
    expect(stored("u1")).toEqual({ size: "l", highContrast: true, lines: 6 });
    expect(window.localStorage.getItem(prefsKey("u2"))).toBeNull();
  });

  it("opens with what the user chose before", () => {
    window.localStorage.setItem(
      prefsKey("u1"),
      JSON.stringify({ size: "s", highContrast: true, lines: 6 }),
    );
    render(<CaptionSettingsPanel userId="u1" />);

    expect(screen.getByTestId("caption-size-s")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("caption-high-contrast")).toBeChecked();
    expect(screen.getAllByTestId("caption-preview-line")).toHaveLength(6);
  });

  it("still applies a change when storage refuses to be written", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    render(<CaptionSettingsPanel userId="u1" />);

    fireEvent.click(screen.getByTestId("caption-size-s"));

    expect(screen.getByTestId("caption-size-s")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    setItem.mockRestore();
  });
});

describe("useCaptionPrefs", () => {
  it("carries a change to every other instance for the same user only", async () => {
    const editor = renderHook(() => useCaptionPrefs("u1"));
    const sameUser = renderHook(() => useCaptionPrefs("u1"));
    const otherUser = renderHook(() => useCaptionPrefs("u2"));

    act(() => editor.result.current.update({ size: "l", lines: 6 }));

    await waitFor(() =>
      expect(sameUser.result.current.prefs).toEqual({
        size: "l",
        highContrast: false,
        lines: 6,
      }),
    );
    expect(otherUser.result.current.prefs).toEqual(DEFAULT_CAPTION_PREFS);
  });

  it("keys anonymous viewers separately", () => {
    expect(prefsKey(undefined)).toBe("nimbus:captions:anonymous");
  });

  it("falls back to defaults when storage cannot be read", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(readPrefs(prefsKey("u1"))).toEqual(DEFAULT_CAPTION_PREFS);
    getItem.mockRestore();
  });
});

describe("WorkspaceSettings: Captions tab", () => {
  const renderSettings = (userId?: string) => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/workspaces/${WS}/status`, () =>
        ok(aiStatus({ canManage: false })),
      ),
    );
    return render(
      <DocEditorRefProvider>
        <WorkspaceSettings
          workspace={workspace}
          documents={[]}
          initialAiStatus={aiStatus({ canManage: false })}
          userId={userId}
        />
      </DocEditorRefProvider>,
    );
  };

  it("offers the signed-in user their caption settings", async () => {
    renderSettings("u1");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Captions" }));

    expect(screen.getByTestId("caption-settings-panel")).toBeInTheDocument();
  });

  it("leaves the tab out when no user is given", () => {
    renderSettings();

    expect(
      screen.queryByRole("button", { name: "Captions" }),
    ).not.toBeInTheDocument();
  });
});
