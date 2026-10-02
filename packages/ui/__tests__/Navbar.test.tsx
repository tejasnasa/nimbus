import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupDom, click, query, queryAll, render } from "./testUtils";

// See WorkspaceCard.test.tsx — the real Link needs the App Router context.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: Record<string, unknown> & { href: string }) =>
    createElement(
      "a",
      { href: typeof href === "string" ? href : String(href), ...rest },
      children as React.ReactNode,
    ),
}));

import Navbar from "../src/components/Navbar";

afterEach(cleanupDom);

const setup = (
  avatar?: string | null,
  options: { onSettings?: () => void; onContact?: () => void } = {},
) => {
  const logout = vi.fn();
  const onSettings = options.onSettings ?? vi.fn();
  const onContact = options.onContact ?? vi.fn();
  const mounted = render(
    <Navbar
      logout={logout}
      onSettings={onSettings}
      onContact={onContact}
      avatar={avatar}
      id="user-1"
      name="Ada Lovelace"
    />,
  );
  return { ...mounted, logout, onSettings, onContact };
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

  it("lists the name, Settings, Contact and Sign Out in the menu", () => {
    const { container } = setup();
    expect(openMenu(container).map((b) => b.textContent)).toEqual([
      "Ada Lovelace",
      "Settings",
      "Contact",
      "Sign Out",
    ]);
  });

  it("renders the name as a non-interactive menu header", () => {
    const { container } = setup();
    expect(openMenu(container)[0]!.disabled).toBe(true);
  });

  it("signs out from the menu", () => {
    const { container, logout } = setup();
    const signOut = openMenu(container)[3]!;
    click(signOut);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("calls onSettings when the Settings menu item is clicked", () => {
    const { container, onSettings } = setup(null, { onSettings: vi.fn() });
    const settings = openMenu(container)[1]!;
    click(settings);
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("calls onContact when the Contact menu item is clicked", () => {
    const { container, onContact } = setup(null, { onContact: vi.fn() });
    const contact = openMenu(container)[2]!;
    click(contact);
    expect(onContact).toHaveBeenCalledTimes(1);
  });

  it("still renders with the optional handlers omitted", () => {
    // `onSettings` and `onContact` are optional — without them their menu items
    // are still listed (visual parity with all other consumers) but do nothing
    // on click. `OptionMenu` invokes `item.onClick?.()` and closes the menu
    // either way, so the contract here is "does not throw and the menu still
    // closes".
    const { container } = render(
      <Navbar logout={vi.fn()} avatar={null} id="user-1" name="Ada Lovelace" />,
    );
    const items = openMenu(container);
    expect(items.map((b) => b.textContent)).toEqual([
      "Ada Lovelace",
      "Settings",
      "Contact",
      "Sign Out",
    ]);
    expect(() => click(items[1]!)).not.toThrow();
    expect(() => click(items[2]!)).not.toThrow();
    // The menu still closes — `OptionMenu` calls `setOpen(false)` whether or
    // not a handler was supplied. We check by querying directly rather than
    // via `openMenu`, which would re-open the menu.
    expect(queryAll(container, "div.absolute button")).toHaveLength(0);
  });
});
