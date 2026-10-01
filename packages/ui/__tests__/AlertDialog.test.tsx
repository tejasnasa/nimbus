import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import AlertDialog from "../src/components/AlertDialog";
import {
  cleanupDom,
  click,
  keyDown,
  query,
  queryAll,
  render,
} from "./testUtils";

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

/** A controlled dialog wired to its own boolean, with a sibling button. */
function ControlledHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid="external" onClick={() => setOpen(true)}>
        open externally
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <div>
          <p>controlled content</p>
          <button data-testid="first-focusable">First</button>
          <button data-testid="middle" data-alert-dialog-close>
            Close
          </button>
          <button data-testid="last-focusable">Last</button>
        </div>
      </AlertDialog>
    </>
  );
}

describe("AlertDialog", () => {
  it("renders the trigger and nothing else while closed", () => {
    const { container } = setup();
    expect(query(container, "[data-testid='trigger']").textContent).toBe(
      "Delete",
    );
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

    click(
      queryAll(document.body, "button").find(
        (b) => b.textContent === "Confirm",
      )!,
    );
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

describe("AlertDialog a11y", () => {
  it("renders the panel with role=dialog and aria-modal=true", () => {
    const { container } = setup();
    open(container);

    const panel = inBody("[role='dialog']");
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("aria-modal")).toBe("true");
  });

  it("locks body scroll while open and restores it on close", () => {
    const { container } = setup();
    const original = document.body.style.overflow;
    open(container);
    expect(document.body.style.overflow).toBe("hidden");

    keyDown("Escape");
    expect(document.body.style.overflow).toBe(original);
  });

  it("focuses the first focusable element when the dialog opens", () => {
    const { container } = setup();
    open(container);

    // First focusable inside the panel: the Cancel button (it appears before
    // Confirm in the test markup). Confirm has no special priority order
    // beyond DOM order.
    const focused = document.activeElement as HTMLElement | null;
    expect(focused?.textContent).toBe("Cancel");
  });

  it("traps Tab at the bottom of the focusable set, cycling to the top", () => {
    const { container } = setup();
    open(container);

    const last = inBody(
      "button:not([data-alert-dialog-close]):not([data-testid='trigger'])",
    );
    // The Confirm button is last in DOM order.
    expect(last.textContent).toBe("Confirm");
    last.focus();

    keyDown("Tab");
    expect((document.activeElement as HTMLElement).textContent).toBe("Cancel");
  });

  it("traps Shift+Tab at the top of the focusable set, cycling to the bottom", () => {
    const { container } = setup();
    open(container);

    // Move focus to the first element explicitly.
    const cancel = queryAll(document.body, "button").find(
      (b) => b.textContent === "Cancel",
    )!;
    cancel.focus();
    expect(document.activeElement).toBe(cancel);

    // Shift+Tab from the first element should wrap to the last.
    keyDown("Tab", { shiftKey: true });
    expect((document.activeElement as HTMLElement).textContent).toBe("Confirm");
  });

  it("falls back to focusing the panel when it has no focusable children", () => {
    // An empty panel exercises the wrap-around fallback: Tab from anywhere
    // inside lands on the panel itself, with no other focusable targets.
    function EmptyHarness() {
      const [open, setOpen] = useState(true);
      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <div aria-label="empty-panel">No focusable children here.</div>
        </AlertDialog>
      );
    }
    render(<EmptyHarness />);

    const panel = inBody("[role='dialog']") as HTMLElement;
    expect(panel).toBeTruthy();

    // Tab on an empty panel: the handler preventDefaults and focuses the
    // panel, so focus is held inside.
    keyDown("Tab");
    expect(document.activeElement).toBe(panel);
  });

  it("restores focus to the trigger when the dialog closes", () => {
    const { container } = setup();
    const trigger = query(container, "[data-testid='trigger']");
    trigger.focus();

    open(container);
    // While open, focus moves into the dialog.
    expect(document.activeElement).not.toBe(trigger);

    keyDown("Escape");
    // After close, focus returns to the trigger.
    expect(document.activeElement).toBe(trigger);
  });
});

describe("AlertDialog controlled mode", () => {
  it("opens when the controlled `open` prop flips to true", () => {
    const { container } = render(<ControlledHarness />);

    expect(document.body.textContent).not.toContain("controlled content");

    click(query(container, "[data-testid='external']"));
    expect(document.body.textContent).toContain("controlled content");
  });

  it("calls onOpenChange(false) on Escape without unmounting the parent state", () => {
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="external" onClick={() => setOpen(true)}>
            open
          </button>
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              onOpenChange(next);
              setOpen(next);
            }}
          >
            <div>
              <button data-alert-dialog-close>close me</button>
            </div>
          </AlertDialog>
        </>
      );
    }
    const { container } = render(<Harness />);
    click(query(container, "[data-testid='external']"));

    expect(document.body.textContent).toContain("close me");

    keyDown("Escape");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.body.textContent).not.toContain("close me");
  });

  it("calls onOpenChange(false) when the backdrop is clicked", () => {
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <AlertDialog
          open={open}
          onOpenChange={(n) => {
            onOpenChange(n);
            setOpen(n);
          }}
        >
          <div>
            <p>controlled</p>
          </div>
        </AlertDialog>
      );
    }
    render(<Harness />);

    click(inBody("div.absolute.inset-0"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores the `trigger` prop entirely in controlled mode", () => {
    // The dialog is open via the prop, but no internal trigger wraps
    // anything — `trigger` is not forwarded, so no extra wrapper renders.
    function Harness() {
      return (
        <AlertDialog open onOpenChange={() => {}}>
          <div>
            <p>controlled, no trigger</p>
          </div>
        </AlertDialog>
      );
    }
    render(<Harness />);
    expect(document.body.textContent).toContain("controlled, no trigger");
    // No "inline-flex" wrapper for a trigger — the dialog opened via prop.
    expect(bodyMatches(".inline-flex")).toHaveLength(0);
  });
});
