import { afterEach, describe, expect, it } from "vitest";
import SettingTabs from "../src/components/SettingTabs";
import { cleanupDom, click, query, queryAll, render } from "./testUtils";

afterEach(cleanupDom);

const tabs = [
  { label: "General", content: <p>general-panel</p> },
  { label: "Members", content: <p>members-panel</p> },
  { label: "Danger", content: <p>danger-panel</p> },
];

describe("SettingTabs", () => {
  it("renders every tab label", () => {
    const { container } = render(<SettingTabs tabs={tabs} />);
    expect(queryAll(container, "button").map((b) => b.textContent)).toEqual([
      "General",
      "Members",
      "Danger",
    ]);
  });

  it("renders only the first panel initially", () => {
    const { container } = render(<SettingTabs tabs={tabs} />);
    expect(container.textContent).toContain("general-panel");
    expect(container.textContent).not.toContain("members-panel");
    expect(container.textContent).not.toContain("danger-panel");
  });

  it("swaps the panel and the highlighted tab on click", () => {
    const { container } = render(<SettingTabs tabs={tabs} />);
    click(queryAll(container, "button")[1]!);

    expect(container.textContent).toContain("members-panel");
    expect(container.textContent).not.toContain("general-panel");

    const buttons = queryAll<HTMLButtonElement>(container, "button");
    expect(buttons[1]!.className).toContain("bg-(--surface-4)");
    expect(buttons[1]!.className).toContain("font-semibold");
    expect(buttons[1]!.getAttribute("aria-current")).toBe("page");
    expect(buttons[0]!.className).not.toContain("bg-(--surface-4)");
    expect(buttons[0]!.getAttribute("aria-current")).toBeNull();
    expect(buttons[0]!.className).toContain("text-(--muted-foreground)");
  });

  it("opens on the tab named by defaultTab", () => {
    const { container } = render(<SettingTabs tabs={tabs} defaultTab="Members" />);
    expect(container.textContent).toContain("members-panel");
    expect(container.textContent).not.toContain("general-panel");
  });

  it("falls back to the first tab when defaultTab names none", () => {
    const { container } = render(<SettingTabs tabs={tabs} defaultTab="Missing" />);
    expect(container.textContent).toContain("general-panel");
  });

  it("renders an empty panel area for an empty tab list", () => {
    const { container } = render(<SettingTabs tabs={[]} />);
    expect(container.textContent).toBe("");
  });

  it("degrades to an empty panel when the tab list shrinks below the active index", () => {
    const { container, rerender } = render(<SettingTabs tabs={tabs} />);
    click(queryAll(container, "button")[2]!);
    expect(container.textContent).toContain("danger-panel");

    rerender(<SettingTabs tabs={[tabs[0]!]} />);
    expect(queryAll(container, "button").map((b) => b.textContent)).toEqual([
      "General",
    ]);
    expect(container.textContent).not.toContain("danger-panel");
  });

  it("shows the active tab's title and description with the heading and action", () => {
    const { container } = render(
      <SettingTabs
        tabs={[
          { label: "General", content: <p>general-panel</p>, description: "Name and description." },
          { label: "Members", content: <p>members-panel</p>, nested: true },
        ]}
        heading={<span>Studio</span>}
        headerAction={<button type="button">Close</button>}
      />,
    );
    expect(query(container, "h2").textContent).toBe("General");
    expect(container.textContent).toContain("Name and description.");
    expect(container.textContent).toContain("Studio");
    expect(container.textContent).toContain("Close");

    click(queryAll(container, "nav button")[1]!);
    expect(query(container, "h2").textContent).toBe("Members");
    expect(container.textContent).not.toContain("Name and description.");
  });
});
