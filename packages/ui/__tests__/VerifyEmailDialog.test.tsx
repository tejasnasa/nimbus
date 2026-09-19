import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupDom, click, keyDown, query, queryAll, render } from "./testUtils";
import VerifyEmailDialog from "../src/components/VerifyEmailDialog";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

// The dialog navigates after closing, so the App Router hook is stubbed out.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => push.mockClear());
afterEach(cleanupDom);

const setup = (open = true) => {
  const onClose = vi.fn();
  const mounted = render(
    <VerifyEmailDialog open={open} email="ada@example.com" onClose={onClose} />,
  );
  return { ...mounted, onClose };
};

describe("VerifyEmailDialog", () => {
  it("renders nothing while closed", () => {
    setup(false);
    expect(document.body.textContent).not.toContain("Check your email");
    expect(queryAll(document.body, "div.fixed")).toHaveLength(0);
  });

  it("portals the prompt with the address the link was sent to", () => {
    setup();
    expect(document.body.textContent).toContain("Check your email");
    expect(document.body.textContent).toContain("ada@example.com");
    expect(document.body.textContent).toContain("Please verify before logging in.");
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    keyDown("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not listen for Escape while closed", () => {
    const { onClose } = setup(false);
    keyDown("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    const { onClose } = setup();
    click(query(document.body, "div.absolute.inset-0"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes and routes to /login from the call to action", () => {
    const { onClose } = setup();
    const cta = queryAll<HTMLButtonElement>(document.body, "button").find((b) =>
      b.textContent?.includes("Go To Login"),
    );
    click(cta!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("keeps the dialog open for clicks inside the panel body", () => {
    const { onClose } = setup();
    click(query(document.body, "h2"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
