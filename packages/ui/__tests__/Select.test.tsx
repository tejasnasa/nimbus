/**
 * @module ui/__tests__/Select
 * @description Behavioural contract for the custom combobox/listbox replacing
 * the native `<select>`. The component is small in code but dense in keyboard
 * semantics, so the tests pin every branch the combobox pattern requires:
 *
 * - closed by default; trigger toggles open/close
 * - current value rendered on the trigger; placeholder when empty
 * - options rendered as `role="option"` rows with `aria-selected`
 * - arrow keys open, navigate, and skip disabled rows
 * - Enter/Space commit; Tab closes without committing
 * - outside click closes
 * - ARIA combobox wiring: `aria-expanded`, `aria-controls`,
 *   `aria-activedescendant`
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import Select, { type SelectOption } from "../src/components/Select";
import {
  cleanupDom,
  click,
  mouseDown,
  query,
  queryAll,
  render,
} from "./testUtils";

afterEach(cleanupDom);

/** Focuses an element so its React keyboard handler fires. */
function focus(el: Element): void {
  act(() => {
    (el as HTMLElement).focus();
  });
}

/**
 * Dispatches a keydown on the trigger. React 19 delegates events to the root
 * container rather than `document`, so the shared `keyDown` helper -- which
 * fires on `document` -- does not reach the combobox button. Dispatching on
 * the button itself, with bubbling, gets through.
 */
function keyDownOn(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

const OPTIONS: readonly SelectOption[] = [
  { value: "openai", label: "OpenAI" },
  { value: "groq", label: "Groq" },
  { value: "deepseek", label: "DeepSeek", disabled: true },
  { value: "openrouter", label: "OpenRouter" },
];

const setup = (
  overrides: Partial<Parameters<typeof Select>[0]> = {},
  onChange = vi.fn(),
) => {
  const { container } = render(
    <Select
      id="provider"
      label="Provider"
      value=""
      onChange={onChange}
      options={OPTIONS}
      {...overrides}
    />,
  );
  const trigger = query<HTMLButtonElement>(container, "[role='combobox']");
  /** Returns the listbox element or `null` when the list is closed. */
  const listbox = (): HTMLUListElement | null =>
    container.querySelector<HTMLUListElement>("[role='listbox']");
  const rows = () => queryAll<HTMLLIElement>(container, "[role='option']");
  return { container, trigger, listbox, rows, onChange };
};

describe("Select", () => {
  it("renders the label and the trigger, and stays closed by default", () => {
    const { container, trigger, listbox } = setup();
    expect(container.querySelector("#provider-label")?.textContent).toBe(
      "Provider",
    );
    expect(trigger.id).toBe("provider");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(listbox()).toBeNull();
  });

  it("shows the placeholder when nothing is selected", () => {
    const { trigger } = setup({ placeholder: "Choose one" });
    expect(trigger.textContent).toContain("Choose one");
  });

  it("shows the matching label when a value is selected", () => {
    setup({ value: "groq" });
    const trigger = query<HTMLButtonElement>(
      document.body.lastElementChild!,
      "[role='combobox']",
    );
    expect(trigger.textContent).toContain("Groq");
  });

  it("uses the muted placeholder colour for the trigger text when no value is selected", () => {
    const { trigger } = setup({ placeholder: "Pick one" });
    const textSpan = trigger.querySelector("span")!;
    expect(textSpan.className).toContain("text-(--muted-foreground)");
  });

  it("opens on trigger click and renders every option", () => {
    const { trigger, listbox, rows } = setup();
    expect(listbox()).toBeNull();

    click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(listbox()).not.toBeNull();
    expect(rows().map((o) => o.textContent)).toEqual([
      "OpenAI",
      "Groq",
      "DeepSeek",
      "OpenRouter",
    ]);
  });

  it("toggles the list closed on a second click of the trigger", () => {
    const { trigger, listbox } = setup();
    click(trigger);
    expect(listbox()).not.toBeNull();

    click(trigger);
    expect(listbox()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("marks the currently selected row with aria-selected", () => {
    const { trigger, rows } = setup({ value: "groq" });
    click(trigger);

    const options = rows();
    expect(options[0]!.getAttribute("aria-selected")).toBe("false");
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(options[2]!.getAttribute("aria-selected")).toBe("false");
    expect(options[3]!.getAttribute("aria-selected")).toBe("false");
  });

  it("renders a check icon on the currently-selected row", () => {
    const { trigger, rows } = setup({ value: "groq" });
    click(trigger);

    const options = rows();
    expect(options[1]!.querySelector("svg")).not.toBeNull();
    expect(options[0]!.querySelector("svg")).toBeNull();
  });

  it("marks disabled rows with aria-disabled and renders them non-interactive", () => {
    const { trigger, rows } = setup();
    click(trigger);

    const deepseek = rows()[2]!;
    expect(deepseek.getAttribute("aria-disabled")).toBe("true");
    expect(deepseek.className).toContain("cursor-not-allowed");
  });

  it("commits a click on an option, fires onChange, and closes the list", () => {
    const { trigger, listbox, rows, onChange } = setup();
    click(trigger);

    click(rows()[0]!); // OpenAI

    expect(onChange).toHaveBeenCalledWith("openai");
    expect(listbox()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not commit a click on a disabled option", () => {
    const { trigger, listbox, rows, onChange } = setup();
    click(trigger);
    click(rows()[2]!); // DeepSeek (disabled)

    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).not.toBeNull();
  });

  it("opens the list when ArrowDown is pressed on a closed trigger", () => {
    const { trigger, listbox } = setup();
    focus(trigger);

    keyDownOn(trigger, "ArrowDown");
    expect(listbox()).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("ArrowDown navigates options and skips disabled rows", () => {
    const { trigger, listbox } = setup();
    focus(trigger);

    keyDownOn(trigger, "ArrowDown"); // open + highlight first non-disabled (OpenAI)
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      "provider-option-0",
    );
    expect(listbox()).not.toBeNull();

    keyDownOn(trigger, "ArrowDown"); // -> Groq (index 1)
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      "provider-option-1",
    );

    // Past Groq would land on DeepSeek (disabled) -- the highlight skips it
    // and wraps to OpenRouter (index 3, the only remaining enabled row).
    keyDownOn(trigger, "ArrowDown");
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      "provider-option-3",
    );
  });

  it("ArrowUp navigates options in reverse and skips disabled rows", () => {
    const { trigger } = setup({ value: "groq" });
    focus(trigger);

    keyDownOn(trigger, "ArrowDown"); // open; current (Groq) is highlighted
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      "provider-option-1",
    );

    keyDownOn(trigger, "ArrowUp"); // -> OpenAI (skips disabled DeepSeek)
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      "provider-option-0",
    );
  });

  it("Enter commits the highlighted option", () => {
    const { trigger, onChange, listbox } = setup();
    focus(trigger);

    keyDownOn(trigger, "ArrowDown"); // open
    keyDownOn(trigger, "ArrowDown"); // Groq
    keyDownOn(trigger, "Enter");

    expect(onChange).toHaveBeenCalledWith("groq");
    expect(listbox()).toBeNull();
  });

  it("Space commits the highlighted option", () => {
    const { trigger, onChange } = setup();
    focus(trigger);

    keyDownOn(trigger, "ArrowDown"); // open + OpenAI
    keyDownOn(trigger, " ");

    expect(onChange).toHaveBeenCalledWith("openai");
  });

  it("Escape closes without committing", () => {
    const { trigger, listbox, onChange } = setup({ value: "openai" });
    focus(trigger);

    keyDownOn(trigger, "ArrowDown"); // open
    keyDownOn(trigger, "ArrowDown"); // Groq (would commit if Enter)
    expect(listbox()).not.toBeNull();

    keyDownOn(trigger, "Escape");
    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Tab closes without committing", () => {
    const { trigger, listbox, onChange } = setup({ value: "openai" });
    focus(trigger);

    keyDownOn(trigger, "ArrowDown"); // open
    keyDownOn(trigger, "ArrowDown"); // Groq
    keyDownOn(trigger, "Tab");

    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Home jumps to the first non-disabled option", () => {
    const { trigger } = setup();
    focus(trigger);

    keyDownOn(trigger, "ArrowDown"); // open
    keyDownOn(trigger, "End"); // last
    keyDownOn(trigger, "Home"); // back to first

    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      "provider-option-0",
    );
  });

  it("End jumps to the last non-disabled option", () => {
    const { trigger } = setup();
    focus(trigger);

    keyDownOn(trigger, "ArrowDown"); // open + OpenAI
    keyDownOn(trigger, "End"); // OpenRouter (index 3; DeepSeek at 2 is disabled)

    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      "provider-option-3",
    );
  });

  it("closes on a mousedown outside the wrapper", () => {
    const { trigger, listbox } = setup();
    click(trigger);
    expect(listbox()).not.toBeNull();

    mouseDown(document.body);
    expect(listbox()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open when a mousedown lands inside the wrapper", () => {
    const { trigger, listbox } = setup();
    click(trigger);

    mouseDown(trigger);
    expect(listbox()).not.toBeNull();
  });

  it("wires aria-controls to the listbox id", () => {
    const { trigger, listbox } = setup();
    expect(trigger.getAttribute("aria-controls")).toBe("provider-listbox");

    click(trigger);
    expect(listbox()!.id).toBe("provider-listbox");
  });

  it("renders a hidden input carrying the current value when `name` is provided", () => {
    const { container } = setup({ name: "providerId", value: "groq" });
    const hidden = query<HTMLInputElement>(container, "input[type='hidden']");
    expect(hidden.name).toBe("providerId");
    expect(hidden.value).toBe("groq");
  });

  it("does not render a hidden input when `name` is omitted", () => {
    const { container } = setup();
    expect(container.querySelector("input[type='hidden']")).toBeNull();
  });

  it("applies a destructive border and aria-invalid when `invalid` is set", () => {
    const { trigger } = setup({ invalid: true });
    expect(trigger.className).toContain("border-(--destructive)");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
  });

  it("disables interaction when `disabled` is set", () => {
    const { trigger, listbox } = setup({ disabled: true });
    expect(trigger.disabled).toBe(true);

    click(trigger);
    expect(listbox()).toBeNull();
  });
});
