import { afterEach, describe, expect, it, vi } from "vitest";
import Button from "../src/components/Button";
import { cleanupDom, click, query, render } from "./testUtils";

afterEach(cleanupDom);

describe("Button", () => {
  it("renders its children inside a button element", () => {
    const { container } = render(<Button>Save</Button>);
    const button = query<HTMLButtonElement>(container, "button");
    expect(button.textContent).toBe("Save");
    expect(button.type).toBe("submit");
  });

  it("applies the base and default (md) size classes", () => {
    const { container } = render(<Button>Save</Button>);
    const className = query(container, "button").className;
    expect(className).toContain("bg-(--primary)");
    expect(className).toContain("h-11 px-5 text-sm");
  });

  it.each([
    ["xs", "px-2.5 py-1 text-xs"],
    ["sm", "px-4 py-2 text-sm"],
    ["md", "h-11 px-5 text-sm"],
    ["lg", "h-12 px-6 text-base"],
  ] as const)("applies the %s size preset", (size, expected) => {
    const { container } = render(<Button size={size}>Save</Button>);
    expect(query(container, "button").className).toContain(expected);
  });

  it("forwards native button attributes", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button type="button" name="save" aria-label="Save document" onClick={onClick}>
        Save
      </Button>,
    );
    const button = query<HTMLButtonElement>(container, "button");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("name")).toBe("save");
    expect(button.getAttribute("aria-label")).toBe("Save document");
    click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("appends caller classes after the preset ones", () => {
    const { container } = render(<Button className="mt-4">Save</Button>);
    const className = query(container, "button").className;
    expect(className.endsWith("mt-4")).toBe(true);
  });

  it("locks the aspect ratio and drops horizontal padding when ratio is set", () => {
    const { container } = render(<Button ratio={1}>X</Button>);
    const button = query<HTMLButtonElement>(container, "button");
    // happy-dom serialises the ratio as "1 / 1" rather than "1".
    expect(button.style.aspectRatio).toMatch(/^1(\s*\/\s*1)?$/);
    expect(button.className).toContain("px-0");
  });

  it("merges caller styles with the aspect-ratio lock", () => {
    const { container } = render(
      <Button ratio={2} style={{ marginTop: 8 }}>
        X
      </Button>,
    );
    const button = query<HTMLButtonElement>(container, "button");
    expect(button.style.aspectRatio).toMatch(/^2(\s*\/\s*1)?$/);
    expect(button.style.marginTop).toBe("8px");
  });

  it("shows a spinner and disables itself while loading", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = query<HTMLButtonElement>(container, "button");
    expect(button.disabled).toBe(true);
    const spinner = query<SVGSVGElement>(container, "svg");
    expect(spinner.getAttribute("class")).toContain("animate-spin");
    expect(spinner.getAttribute("class")).toContain("h-4 w-4");
    click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("scales the spinner with the size preset", () => {
    const { container } = render(
      <Button size="lg" loading>
        Save
      </Button>,
    );
    expect(query(container, "svg").getAttribute("class")).toContain("h-5 w-5");
  });

  it("stays disabled when disabled is passed without loading", () => {
    const { container } = render(<Button disabled>Save</Button>);
    expect(query<HTMLButtonElement>(container, "button").disabled).toBe(true);
    expect(container.querySelector("svg")).toBeNull();
  });
});
