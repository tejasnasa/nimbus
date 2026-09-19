import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocTabs from "../src/components/DocTabs";
import { cleanupDom, click, dragEvent, queryAll, render } from "./testUtils";

afterEach(cleanupDom);

type Tab = { id: string; label: string; type?: string };

const THREE: Tab[] = [
  { id: "1", label: "Alpha", type: "MARKDOWN" },
  { id: "2", label: "Beta", type: "CANVAS" },
  { id: "3", label: "Gamma", type: "MARKDOWN" },
];

/**
 * Stateful host so the drag assertions can read the real post-drop order and
 * the real remapped active index straight out of the DOM.
 */
function Harness({
  initial = THREE,
  highlightTabId,
  onCloseTab,
}: {
  initial?: Tab[];
  highlightTabId?: string | null;
  onCloseTab?: (id: string) => void;
}) {
  const [tabs, setTabs] = useState<Tab[]>(initial);
  const [active, setActive] = useState(0);
  return (
    <DocTabs
      tabs={tabs}
      setTabs={setTabs}
      active={active}
      setActive={setActive}
      highlightTabId={highlightTabId}
      onCloseTab={onCloseTab}
    />
  );
}

/** Tab row elements in DOM order (the close button lives inside a row). */
const rows = (container: HTMLElement) =>
  queryAll<HTMLDivElement>(container, "div[draggable]");

const rowOrder = (container: HTMLElement) =>
  rows(container).map((row) => row.querySelector("span.truncate")!.textContent);

const activeRow = (container: HTMLElement) =>
  rows(container).find((row) => row.className.includes("border-(--primary) text-(--foreground)"))
    ?.querySelector("span.truncate")?.textContent ?? null;

const drag = (container: HTMLElement, from: number, to: number) => {
  const row = rows(container);
  dragEvent("dragstart", row[from]!);
  dragEvent("dragover", row[to]!);
  dragEvent("drop", row[to]!);
};

describe("DocTabs", () => {
  it("renders one row per tab and selects the first by default", () => {
    const { container } = render(<Harness />);
    expect(rowOrder(container)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(activeRow(container)).toBe("Alpha");
  });

  it("selects a tab on click", () => {
    const { container } = render(<Harness />);
    click(rows(container)[2]!);
    expect(activeRow(container)).toBe("Gamma");
  });

  it("hides the close button when no close handler is supplied", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector("button[title='Close tab']")).toBeNull();
  });

  it("reports the closed tab id without changing the selection", () => {
    const onCloseTab = vi.fn();
    const { container } = render(<Harness onCloseTab={onCloseTab} />);
    click(rows(container)[1]!.querySelector("button[title='Close tab']")!);

    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab).toHaveBeenCalledWith("2");
    expect(activeRow(container)).toBe("Alpha");
  });

  it("marks a tab as generating by type or by id prefix", () => {
    const { container } = render(
      <Harness
        initial={[
          { id: "1", label: "Alpha" },
          { id: "2", label: "Beta", type: "GENERATING" },
          { id: "generating:3", label: "Gamma" },
        ]}
      />,
    );
    const indicators = rows(container).map(
      (row) => row.querySelectorAll("span.animate-ping").length,
    );
    expect(indicators).toEqual([0, 1, 1]);
  });

  it("applies the highlight class only to the highlighted tab", () => {
    const { container } = render(<Harness highlightTabId="2" />);
    const classes = rows(container).map((row) =>
      row.className.includes("animate-border-glow"),
    );
    expect(classes).toEqual([false, true, false]);
  });

  describe("drag to reorder", () => {
    it("moves a tab forward and keeps the dragged tab selected", () => {
      const { container } = render(<Harness />);
      click(rows(container)[0]!);

      drag(container, 0, 2);

      expect(rowOrder(container)).toEqual(["Beta", "Gamma", "Alpha"]);
      expect(activeRow(container)).toBe("Alpha");
    });

    it("moves a tab backward and keeps the dragged tab selected", () => {
      const { container } = render(<Harness />);
      click(rows(container)[2]!);

      drag(container, 2, 0);

      expect(rowOrder(container)).toEqual(["Gamma", "Alpha", "Beta"]);
      expect(activeRow(container)).toBe("Gamma");
    });

    it("remaps the active index when the selection shifts left", () => {
      const { container } = render(<Harness />);
      click(rows(container)[1]!);

      drag(container, 0, 2);

      expect(rowOrder(container)).toEqual(["Beta", "Gamma", "Alpha"]);
      expect(activeRow(container)).toBe("Beta");
    });

    it("remaps the active index when the selection shifts right", () => {
      const { container } = render(<Harness />);
      click(rows(container)[1]!);

      drag(container, 2, 0);

      expect(rowOrder(container)).toEqual(["Gamma", "Alpha", "Beta"]);
      expect(activeRow(container)).toBe("Beta");
    });

    it("leaves the selection alone when a later tab is dragged past it", () => {
      const { container } = render(<Harness />);
      click(rows(container)[2]!);

      drag(container, 0, 1);

      expect(rowOrder(container)).toEqual(["Beta", "Alpha", "Gamma"]);
      expect(activeRow(container)).toBe("Gamma");
    });

    it("is a no-op when a tab is dropped on itself", () => {
      const { container } = render(<Harness />);
      drag(container, 1, 1);
      expect(rowOrder(container)).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(activeRow(container)).toBe("Alpha");
    });

    it("is a no-op when the drop has no matching dragstart", () => {
      const { container } = render(<Harness />);
      dragEvent("drop", rows(container)[2]!);
      expect(rowOrder(container)).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("clears the drag styling once the drag ends", () => {
      const { container } = render(<Harness />);
      const row = rows(container)[1]!;
      dragEvent("dragstart", row);
      dragEvent("dragover", row);
      expect(row.className).toContain("opacity-50");

      dragEvent("dragend", row);
      expect(rows(container)[1]!.className).not.toContain("opacity-50");
    });
  });
});
