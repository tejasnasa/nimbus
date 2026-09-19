import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDom, click, query, queryAll, render } from "./testUtils";

// `next/link` is stubbed: the real one renders through the App Router context,
// which these unit tests do not provide.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: Record<string, unknown> & { href: string }) =>
    createElement(
      "a",
      { href: typeof href === "string" ? href : String(href), ...rest },
      children as React.ReactNode,
    ),
}));

import WorkspaceCard from "../src/components/WorkspaceCard";

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(cleanupDom);

const workspace = {
  id: "ws_cuid",
  slugId: 42,
  name: "Ada's Dev Lounge",
  description: "A place to build things",
  inviteCode: "INVITE-42",
  updatedAt: new Date(),
  members: [
    { id: "u1", image: "/u1.png", online: true },
    { id: "u2", image: "", online: false },
  ],
} as unknown as Parameters<typeof WorkspaceCard>[0]["workspace"];

const setup = (
  deleteWorkspace: (workspaceId: string) => Promise<void> = vi
    .fn()
    .mockResolvedValue(undefined),
) => {
  const mounted = render(
    <WorkspaceCard workspace={workspace} deleteWorkspace={deleteWorkspace} />,
  );
  return { ...mounted, deleteWorkspace };
};

const menuItems = (container: HTMLElement) => {
  click(query(container, "button"));
  return queryAll<HTMLButtonElement>(container, "div.absolute button");
};

describe("WorkspaceCard", () => {
  it("links to the workspace route using slugId, not the cuid", () => {
    const { container } = setup();
    const link = query<HTMLAnchorElement>(container, "a");
    expect(link.getAttribute("href")).toBe("/workspace/42");
    expect(link.getAttribute("id")).toBe("42");
  });

  it("renders the name and description", () => {
    const { container } = setup();
    expect(query(container, "h2").textContent).toBe("Ada's Dev Lounge");
    expect(container.textContent).toContain("A place to build things");
  });

  it("renders a relative update time from timeAgo", () => {
    const { container } = setup();
    expect(container.textContent).toContain("just now");
  });

  it("renders one stacked avatar per member", () => {
    const { container } = setup();
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(query<HTMLImageElement>(container, "img").getAttribute("src")).toBe("/u1.png");
  });

  it("renders an empty avatar stack when the workspace has no members", () => {
    const mounted = render(
      <WorkspaceCard
        workspace={{ ...(workspace as object), members: [] } as typeof workspace}
        deleteWorkspace={vi.fn()}
      />,
    );
    expect(mounted.container.querySelectorAll("img")).toHaveLength(0);
  });

  it("copies the invite code from the menu", () => {
    const { container } = setup();
    const copy = menuItems(container)[0]!;
    expect(copy.textContent).toContain("Copy Invite Code");
    click(copy);
    expect(writeText).toHaveBeenCalledWith("INVITE-42");
  });

  it("keeps the not-yet-implemented duplicate action disabled", () => {
    const { container, deleteWorkspace } = setup();
    const duplicate = menuItems(container)[1]!;
    expect(duplicate.textContent).toContain("Duplicate");
    expect(duplicate.disabled).toBe(true);
    click(duplicate);
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  it("deletes the workspace by id from the menu", () => {
    const deleteWorkspace = vi.fn().mockResolvedValue(undefined);
    const { container } = setup(deleteWorkspace);
    const remove = menuItems(container)[2]!;
    expect(remove.textContent).toContain("Delete");
    click(remove);
    expect(deleteWorkspace).toHaveBeenCalledWith("ws_cuid");
  });
});
