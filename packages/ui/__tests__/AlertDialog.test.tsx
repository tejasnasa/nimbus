import { afterEach, describe, expect, it, vi } from "vitest";
import AlertDialog from "../src/components/AlertDialog";
import { cleanupDom, click, keyDown, query, queryAll, render } from "./testUtils";

afterEach(cleanupDom);

/** The dialog is portalled, so assertions read from `<body>`, not the container. */
const inBody = (selector: string) => query(document.body, selector);
const bodyMatches = (selector: string) => queryAll(document.body, selector);

const setup = () => {
  const onConfirm = vi.fn();
  const { container } = render(
    <AlertDialog trigger={<button data-testid="trigger">Delete</button>}>
      <div>
        <p>Are you sure?</p>
        <button data-alert-dialog-close>Cancel</button>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    </AlertDialog>,
  );
  return { container, onConfirm };
};

const open = (container: HTMLElement) => {
  click(query(container, "[data-testid='trigger']"));
};

describe("AlertDialog", () => {
  it("renders the trigger and nothing else while closed", () => {
    const { container } = setup();
    expect(query(container, "[data-testid='trigger']").textContent).toBe("Delete");
    expect(document.body.textContent).not.toContain("Are you sure?");
    expect(bodyMatches("div.fixed")).toHaveLength(0);
  });

  it("portals its content into document.body when the trigger is clicked", () => {
    const { container } = setup();
    open(container);

    expect(document.body.textContent).toContain("Are you sure?");
    const overlay = inBody("div.fixed.inset-0");
    expect(overlay.querySelector(".backdrop-blur-md")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const { container } = setup();
    open(container);
    expect(document.body.textContent).toContain("Are you sure?");

    keyDown("Escape");
    expect(document.body.textContent).not.toContain("Are you sure?");
  });

  it("ignores other keys", () => {
    const { container } = setup();
    open(container);
    keyDown("Enter");
    expect(document.body.textContent).toContain("Are you sure?");
  });

  it("closes when the backdrop is clicked", () => {
    const { container } = setup();
    open(container);
    const backdrop = inBody("div.absolute.inset-0");
    click(backdrop);
    expect(document.body.textContent).not.toContain("Are you sure?");
  });

  it("closes when an element marked data-alert-dialog-close is clicked", () => {
    const { container } = setup();
    open(container);
    click(inBody("[data-alert-dialog-close]"));
    expect(document.body.textContent).not.toContain("Are you sure?");
  });

  it("keeps the dialog open for ordinary content clicks", () => {
    const { container, onConfirm } = setup();
    open(container);
    click(inBody("p"));
    expect(document.body.textContent).toContain("Are you sure?");

    click(queryAll(document.body, "button").find((b) => b.textContent === "Confirm")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("stops listening for Escape once dismissed", () => {
    const { container } = setup();
    open(container);
    keyDown("Escape");
    expect(() => keyDown("Escape")).not.toThrow();
    expect(document.body.textContent).not.toContain("Are you sure?");
  });
});
