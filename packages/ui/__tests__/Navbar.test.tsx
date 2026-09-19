import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupDom, click, query, queryAll, render } from "./testUtils";


// See WorkspaceCard.test.tsx — the real Link needs the App Router context.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: Record<string, unknown> & { href: string }) =>
    createElement(
      "a",
      { href: typeof href === "string" ? href : String(href), ...rest },
      children as React.ReactNode,
    ),
}));

import Navbar from "../src/components/Navbar";

afterEach(cleanupDom);

const setup = (avatar?: string | null) => {
  const logout = vi.fn();
  const mounted = render(
    <Navbar logout={logout} avatar={avatar} id="user-1" name="Ada Lovelace" />,
  );
  return { ...mounted, logout };
};

/** The avatar itself is the menu trigger — there is no button element. */
const openMenu = (container: HTMLElement) => {
  click(query(container, "div.relative.inline-block > div"));
  return queryAll<HTMLButtonElement>(container, "div.absolute button");
};

describe("Navbar", () => {
  it("renders the brand link home", () => {
    const { container } = setup();
    const brand = query<HTMLAnchorElement>(container, "a[href='/']");
    expect(brand.textContent).toContain("Nimbus");
    expect(brand.querySelector("svg")).toBeTruthy();
  });

  it("shows the user avatar with the display name as alt text", () => {
    const { container } = setup("/ada.png");
    expect(query<HTMLImageElement>(container, "img").getAttribute("src")).toBe(
      "/ada.png",
    );
    expect(query<HTMLImageElement>(container, "img").getAttribute("alt")).toBe(
      "Ada Lovelace",
    );
  });

  it("falls back to a generated avatar when the user has no image", () => {
    const { container } = setup(null);
    const src = query<HTMLImageElement>(container, "img").getAttribute("src");
    expect(src).not.toBe("null");
  });

  it("lists the name, Settings and Sign Out in the menu", () => {
    const { container } = setup();
    expect(openMenu(container).map((b) => b.textContent)).toEqual([
      "Ada Lovelace",
      "Settings",
      "Sign Out",
    ]);
  });

  it("renders the name as a non-interactive menu header", () => {
    const { container } = setup();
    expect(openMenu(container)[0]!.disabled).toBe(true);
  });

  it("signs out from the menu", () => {
    const { container, logout } = setup();
    const signOut = openMenu(container)[2]!;
    click(signOut);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
