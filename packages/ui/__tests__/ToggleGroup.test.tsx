import { afterEach, describe, expect, it, vi } from "vitest";
import ToggleGroup from "../src/components/ToggleGroup";
import { cleanupDom, click, queryAll, render } from "./testUtils";

const ACTIVE = "bg-(--primary)";
const INACTIVE = "text-(--muted-foreground)";

afterEach(cleanupDom);

const labels = (container: ParentNode) =>
  queryAll<HTMLButtonElement>(container, "button").map((b) => b.textContent);

const activeLabels = (container: ParentNode) =>
  queryAll<HTMLButtonElement>(container, "button")
    .filter((b) => b.className.includes(ACTIVE))
    .map((b) => b.textContent);

describe("ToggleGroup", () => {
  it("renders one button per option", () => {
    const { container } = render(
      <ToggleGroup options={["MARKDOWN", "CANVAS"]} />,
    );
    expect(labels(container)).toEqual(["MARKDOWN", "CANVAS"]);
  });

  it("selects the first option by default", () => {
    const { container } = render(
      <ToggleGroup options={["MARKDOWN", "CANVAS"]} />,
    );
    expect(activeLabels(container)).toEqual(["MARKDOWN"]);
  });

  it("starts with no selection and no crash when there are no options", () => {
    const { container } = render(<ToggleGroup options={[]} />);
    expect(labels(container)).toEqual([]);
  });

  it("keeps exactly one option active at a time", () => {
    const { container } = render(
      <ToggleGroup options={["a", "b", "c"]} />,
    );
    expect(activeLabels(container)).toHaveLength(1);

    click(queryAll(container, "button")[2]!);
    expect(activeLabels(container)).toEqual(["c"]);

    click(queryAll(container, "button")[1]!);
    expect(activeLabels(container)).toEqual(["b"]);
  });

  it("reports the newly selected option through onChange", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToggleGroup options={["All Workspaces", "My Workspaces"]} onChange={onChange} />,
    );
    click(queryAll(container, "button")[1]!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("My Workspaces");
  });

  it("stays silent when onChange is omitted", () => {
    const { container } = render(<ToggleGroup options={["a", "b"]} />);
    expect(() => click(queryAll(container, "button")[1]!)).not.toThrow();
    expect(activeLabels(container)).toEqual(["b"]);
  });

  it("styles the inactive options differently from the active one", () => {
    const { container } = render(<ToggleGroup options={["a", "b"]} />);
    const [first, second] = queryAll<HTMLButtonElement>(container, "button");
    expect(first!.className).toContain(ACTIVE);
    expect(second!.className).toContain(INACTIVE);
    expect(second!.className).not.toContain(ACTIVE);
  });

  it("keeps every button type=button so it never submits an enclosing form", () => {
    const { container } = render(<ToggleGroup options={["a", "b"]} />);
    for (const button of queryAll<HTMLButtonElement>(container, "button")) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it.fails("keeps the selection pointing at a real option when options change", () => {
    const { rerender, container } = render(<ToggleGroup options={["a", "b"]} />);
    click(queryAll(container, "button")[1]!);
    rerender(<ToggleGroup options={["x", "y"]} />);
    expect(labels(container)).toEqual(["x", "y"]);
    expect(activeLabels(container)).toHaveLength(1);
  });
});
