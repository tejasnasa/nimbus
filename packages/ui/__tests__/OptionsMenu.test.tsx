import { afterEach, describe, expect, it, vi } from "vitest";
import OptionMenu from "../src/components/OptionsMenu";
import { cleanupDom, click, mouseDown, queryAll, query, render } from "./testUtils";

afterEach(cleanupDom);

const setup = (overrides: Partial<Parameters<typeof OptionMenu>[0]> = {}) => {
  const onSettings = vi.fn();
  const onDelete = vi.fn();
  const { container } = render(
    <OptionMenu
      trigger={<button data-testid="trigger">Open</button>}
      items={[
        { label: "Account", disabled: true },
        { label: "Settings", onClick: onSettings },
        { label: "Delete", destructive: true, onClick: onDelete },
      ]}
      size="lg"
      direction="left"
      className="w-44"
      {...overrides}
    />,
  );
  const trigger = query<HTMLButtonElement>(container, "[data-testid='trigger']");
  /** The menu's own item buttons, excluding the trigger. */
  const items = () => queryAll<HTMLButtonElement>(container, "div.absolute button");
  return { container, trigger, items, onSettings, onDelete };
};

describe("OptionMenu", () => {
  it("keeps the menu closed until the trigger is clicked", () => {
    const { items } = setup();
    expect(items()).toHaveLength(0);
  });

  it("opens the menu on trigger click and toggles it closed again", () => {
    const { trigger, items } = setup();
    click(trigger);
    expect(items().map((b) => b.textContent)).toEqual([
      "Account",
      "Settings",
      "Delete",
    ]);

    click(trigger);
    expect(items()).toHaveLength(0);
  });

  it("invokes the item handler and closes the menu", () => {
    const { trigger, items, onSettings } = setup();
    click(trigger);
    click(items()[1]!);

    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(0);
  });

  it("marks disabled rows as disabled headers that never fire", () => {
    const { trigger, items } = setup();
    click(trigger);
    const account = items()[0]!;
    expect(account.disabled).toBe(true);
    expect(account.className).toContain("disabled:opacity-40");

    // A disabled row is inert: the menu stays open and nothing is reported.
    click(account);
    expect(items()).toHaveLength(3);
  });

  it("tints destructive rows differently from normal ones", () => {
    const { trigger, items } = setup();
    click(trigger);
    expect(items()[2]!.className).toContain("text-(--destructive)");
    expect(items()[1]!.className).not.toContain("text-(--destructive)");
  });

  it("applies the direction and caller classes to the panel", () => {
    const { container, trigger, items } = setup();
    click(trigger);
    const panel = query(container, "div.absolute");
    expect(panel.className).toContain("right-0");
    expect(panel.className).toContain("w-44");
    expect(items()[1]!.className).toContain("text-sm");
  });

  it("aligns the panel to the left when direction is right", () => {
    const { container, trigger, items } = setup({ direction: "right", size: "sm" });
    click(trigger);
    const panel = query(container, "div.absolute");
    expect(panel.className).toContain("left-0");
    expect(panel.className).not.toContain("right-0");
    expect(items()[1]!.className).toContain("text-xs");
  });

  it("closes when a mousedown lands outside the component", () => {
    const { trigger, items } = setup();
    click(trigger);
    expect(items()).toHaveLength(3);

    mouseDown(document.body);
    expect(items()).toHaveLength(0);
  });

  it("stays open when the mousedown lands inside the component", () => {
    const { trigger, items } = setup();
    click(trigger);
    mouseDown(trigger);
    expect(items()).toHaveLength(3);
  });

  it("renders item icons when provided", () => {
    const { container, trigger } = setup({
      items: [{ label: "With icon", icon: <svg data-testid="icon" /> }],
    });
    click(trigger);
    expect(query(container, "[data-testid='icon']")).toBeTruthy();
  });

  it("tolerates items without a click handler", () => {
    const { trigger, items } = setup({ items: [{ label: "Inert" }] });
    click(trigger);
    expect(() => click(items()[0]!)).not.toThrow();
    expect(items()).toHaveLength(0);
  });
});
