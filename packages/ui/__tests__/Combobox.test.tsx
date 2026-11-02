/**
 * @module ui/__tests__/Combobox
 * @description Behavioural contract for the searchable combobox: filtering,
 * keyboard navigation, `aria-activedescendant` wiring, the empty state, the
 * always-visible footer action, and dismissal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import Combobox, {
  type ComboboxOption,
} from "../src/components/Combobox";
import { cleanupDom, click, mouseDown, query, queryAll, render } from "./testUtils";

afterEach(cleanupDom);

const OPTIONS: readonly ComboboxOption[] = [
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini", description: "openai/gpt-4o-mini" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini", description: "openai/gpt-5-mini" },
  { value: "deepseek/v4", label: "DeepSeek V4", description: "deepseek/v4", disabled: true },
  { value: "anthropic/haiku", label: "Claude Haiku", description: "anthropic/haiku" },
];

function keyDownOn(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

/** Types into the controlled input the way a browser does: set value, fire input. */
function type(input: HTMLInputElement, text: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const setup = (
  overrides: Partial<Parameters<typeof Combobox>[0]> = {},
  onChange = vi.fn(),
) => {
  const mounted = render(
    <Combobox
      id="model"
      label="Model"
      value=""
      onChange={onChange}
      options={OPTIONS}
      {...overrides}
    />,
  );
  const input = query<HTMLInputElement>(mounted.container, "#model");
  return { ...mounted, input, onChange };
};

const rows = (container: HTMLElement) =>
  queryAll<HTMLElement>(container, '[role="option"]');

describe("Combobox: opening and display", () => {
  it("is closed by default and opens on click", () => {
    const { container, input } = setup();

    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    click(input);

    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(rows(container)).toHaveLength(4);
  });

  it("shows the selected label while closed", () => {
    const { input } = setup({ value: "openai/gpt-5-mini" });

    expect(input.value).toBe("GPT-5 Mini");
  });

  it("uses the placeholder when nothing is selected", () => {
    const { input } = setup({ placeholder: "Choose a model" });

    expect(input.placeholder).toBe("Choose a model");
  });

  it("does not open when disabled", () => {
    const { container, input } = setup({ disabled: true });

    click(input);
    keyDownOn(input, "ArrowDown");

    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("labels the input and wires the listbox", () => {
    const { container, input } = setup();
    click(input);

    const listbox = query<HTMLElement>(container, '[role="listbox"]');
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(query(container, "label").getAttribute("for")).toBe("model");
  });
});

describe("Combobox: filtering", () => {
  it("filters by label", () => {
    const { container, input } = setup();
    click(input);

    type(input, "haiku");

    expect(rows(container).map((r) => r.textContent)).toEqual([
      expect.stringContaining("Claude Haiku"),
    ]);
  });

  it("filters by the secondary text, case-insensitively", () => {
    const { container, input } = setup();
    click(input);

    type(input, "OPENAI/");

    expect(rows(container)).toHaveLength(2);
  });

  it("shows the empty state when nothing matches", () => {
    const { container, input } = setup({ emptyText: "No models found" });
    click(input);

    type(input, "zzzz");

    expect(rows(container)).toHaveLength(0);
    expect(query(container, '[data-testid="model-empty"]').textContent).toBe(
      "No models found",
    );
  });

  it("keeps the footer action visible whatever the filter says", () => {
    const { container, input } = setup({
      footerAction: { label: "Use a custom model id", onSelect: vi.fn() },
    });
    click(input);

    type(input, "zzzz");

    expect(query(container, '[data-testid="model-footer"]').textContent).toBe(
      "Use a custom model id",
    );
  });

  it("clears the query when the list closes", () => {
    const { container, input } = setup();
    click(input);
    type(input, "haiku");

    keyDownOn(input, "Escape");
    click(input);

    expect(rows(container)).toHaveLength(4);
  });
});

describe("Combobox: keyboard", () => {
  it("opens with ArrowDown and highlights the first enabled row", () => {
    const { container, input } = setup();

    keyDownOn(input, "ArrowDown");

    const first = rows(container)[0]!;
    expect(input.getAttribute("aria-activedescendant")).toBe(first.id);
  });

  it("moves with the arrows, skipping disabled rows and wrapping", () => {
    const { container, input } = setup();
    click(input);
    const all = rows(container);

    keyDownOn(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(all[1]!.id);

    // Row 2 is disabled, so the next stop is row 3.
    keyDownOn(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(all[3]!.id);

    keyDownOn(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(all[0]!.id);

    keyDownOn(input, "ArrowUp");
    expect(input.getAttribute("aria-activedescendant")).toBe(all[3]!.id);
  });

  it("starts on the selected row when opened", () => {
    const { container, input } = setup({ value: "anthropic/haiku" });
    click(input);

    expect(input.getAttribute("aria-activedescendant")).toBe(
      rows(container)[3]!.id,
    );
  });

  it("commits the highlighted row on Enter and closes", () => {
    const { container, input, onChange } = setup();
    click(input);
    keyDownOn(input, "ArrowDown");

    keyDownOn(input, "Enter");

    expect(onChange).toHaveBeenCalledWith("openai/gpt-5-mini");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("commits the first match after typing, then Enter", () => {
    const { input, onChange } = setup();
    click(input);

    type(input, "haiku");
    keyDownOn(input, "Enter");

    expect(onChange).toHaveBeenCalledWith("anthropic/haiku");
  });

  it("closes on Escape without choosing", () => {
    const { container, input, onChange } = setup();
    click(input);

    keyDownOn(input, "Escape");

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("closes on Tab without committing the highlight", () => {
    const { container, input, onChange } = setup();
    click(input);

    keyDownOn(input, "Tab");

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("does nothing on Enter when no row is highlighted", () => {
    const { input, onChange } = setup();
    click(input);
    type(input, "zzzz");

    keyDownOn(input, "Enter");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("reaches the footer action by arrow and runs it on Enter", () => {
    const onSelect = vi.fn();
    const { container, input } = setup({
      options: [OPTIONS[0]!],
      footerAction: { label: "Use a custom model id", onSelect },
    });
    click(input);

    keyDownOn(input, "ArrowDown");
    const footer = query<HTMLElement>(container, '[data-testid="model-footer"]');
    expect(input.getAttribute("aria-activedescendant")).toBe(footer.id);

    keyDownOn(input, "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("Combobox: pointer", () => {
  it("chooses a row on click", () => {
    const { container, input, onChange } = setup();
    click(input);

    click(rows(container)[3]!);

    expect(onChange).toHaveBeenCalledWith("anthropic/haiku");
  });

  it("ignores a click on a disabled row", () => {
    const { container, input, onChange } = setup();
    click(input);

    click(rows(container)[2]!);

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("closes on a press outside", () => {
    const { container, input } = setup();
    click(input);

    mouseDown(document.body);

    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("marks the selected row", () => {
    const { container, input } = setup({ value: "openai/gpt-4o-mini" });
    click(input);

    const selected = rows(container).filter(
      (r) => r.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toContain("GPT-4o mini");
  });

  it("renders custom row content when asked", () => {
    const { container, input } = setup({
      renderOption: (o) => <span data-testid={`row-${o.value}`}>{o.label}!</span>,
    });
    click(input);

    expect(query(container, '[data-testid="row-anthropic/haiku"]').textContent).toBe(
      "Claude Haiku!",
    );
  });

  it("reddens the field when invalid", () => {
    const { input } = setup({ invalid: true });

    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});

/** React derives `onMouseEnter` from `mouseover`, so that is what is dispatched. */
function hover(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

describe("Combobox: hover and edge cases", () => {
  it("highlights the row under the pointer, but not a disabled one", () => {
    const { container, input } = setup();
    click(input);
    const all = rows(container);

    hover(all[3]!);
    expect(input.getAttribute("aria-activedescendant")).toBe(all[3]!.id);

    hover(all[2]!);
    expect(input.getAttribute("aria-activedescendant")).toBe(all[3]!.id);
  });

  it("highlights and runs the footer action under the pointer", () => {
    const onSelect = vi.fn();
    const { container, input } = setup({
      footerAction: { label: "Use a custom model id", onSelect },
    });
    click(input);
    const footer = query<HTMLElement>(container, '[data-testid="model-footer"]');

    hover(footer);
    expect(input.getAttribute("aria-activedescendant")).toBe(footer.id);

    click(footer);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("keeps focus on the input when a row is pressed", () => {
    const { container, input } = setup();
    click(input);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });

    act(() => {
      rows(container)[0]!.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it("highlights nothing when every option is disabled", () => {
    const { input } = setup({
      options: OPTIONS.map((o) => ({ ...o, disabled: true })),
    });
    click(input);

    keyDownOn(input, "ArrowDown");

    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("reopens when the user types after closing with Escape", () => {
    const { container, input } = setup();
    click(input);
    keyDownOn(input, "Escape");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    type(input, "gpt");

    expect(rows(container).length).toBeGreaterThan(0);
  });
});

describe("Combobox: remaining branches", () => {
  it("filters options that have no description", () => {
    const { container, input } = setup({
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    });
    click(input);

    type(input, "zeta");
    expect(rows(container)).toHaveLength(0);

    type(input, "bet");
    expect(rows(container)).toHaveLength(1);
  });

  it("does nothing on arrows when there are no options at all", () => {
    const { container, input } = setup({ options: [] });
    click(input);

    keyDownOn(input, "ArrowDown");

    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(rows(container)).toHaveLength(0);
  });

  it("opens on ArrowUp as well, and ignores other keys while closed", () => {
    const { container, input } = setup();

    keyDownOn(input, "a");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    keyDownOn(input, "ArrowUp");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("styles the selected row differently while it is the highlighted one", () => {
    const { container, input } = setup({ value: "openai/gpt-4o-mini" });
    click(input);

    const selected = rows(container)[0]!;
    expect(input.getAttribute("aria-activedescendant")).toBe(selected.id);
    expect(selected.querySelector("svg")!.getAttribute("class")).toContain(
      "text-(--primary)",
    );

    hover(rows(container)[1]!);
    expect(selected.querySelector("svg")!.getAttribute("class")).toContain(
      "text-(--muted-foreground)",
    );
  });
});
