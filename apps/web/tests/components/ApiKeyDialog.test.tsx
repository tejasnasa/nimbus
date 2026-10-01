/**
 * @module web/tests/components/ApiKeyDialog
 * @description Add-or-replace-key modal.
 *
 * The dialog is controlled (the parent owns open state) because it is opened
 * from multiple places — the disabled composer and the AI settings panel —
 * and must survive a failed submit. Backdrop and Escape call
 * `onOpenChange(false)`; the dialog clears the plaintext key from state on
 * both successful submit and close.
 *
 * @important The dialog must never render the plaintext key back. Tests assert
 *            this by reading the input's `value` attribute (browser autofill
 *            or React rerender) is empty after success and after close.
 */
import "./testUtils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ApiKeyDialog from "../../components/ApiKeyDialog";

/** The shape of the `onSave` prop the dialog expects. */
type DialogSave = React.ComponentProps<typeof ApiKeyDialog>["onSave"];

/**
 * Wraps the dialog in a tiny harness that owns the open state, so the test
 * exercises the controlled-mode `AlertDialog` rather than a one-shot button.
 */
function ControlledHarness({ onSave }: { onSave: DialogSave }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button data-testid="open" onClick={() => setOpen(true)}>
        open
      </button>
      <ApiKeyDialog open={open} onOpenChange={setOpen} onSave={onSave} />
    </>
  );
}

describe("ApiKeyDialog", () => {
  it("renders the form with provider, key, and label fields when open", () => {
    render(
      <ControlledHarness onSave={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    expect(screen.getByLabelText("add-api-key-form")).toBeInTheDocument();
    expect(screen.getByTestId("api-key-provider")).toBeInTheDocument();
    expect(screen.getByTestId("api-key-input")).toBeInTheDocument();
    expect(screen.getByTestId("api-key-label")).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    function Harness() {
      const [open] = useState(false);
      return (
        <ApiKeyDialog open={open} onOpenChange={() => {}} onSave={vi.fn()} />
      );
    }
    render(<Harness />);
    expect(screen.queryByLabelText("add-api-key-form")).not.toBeInTheDocument();
  });

  it("never renders the plaintext key back after a successful save", async () => {
    const onSave = vi
      .fn()
      .mockImplementation(
        async () =>
          new Promise<{ ok: true }>((res) =>
            setTimeout(() => res({ ok: true }), 0),
          ),
      );

    const user = userEvent.setup();
    render(<ControlledHarness onSave={onSave} />);

    const input = screen.getByTestId("api-key-input");
    await user.type(input, "sk-secret-key-1234567890");

    await user.click(screen.getByTestId("api-key-save"));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "openai",
          apiKey: "sk-secret-key-1234567890",
        }),
      ),
    );

    // After success, the input must NOT carry the typed value back.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("clears the key from the input when the dialog is closed via Cancel", async () => {
    const user = userEvent.setup();
    render(
      <ControlledHarness onSave={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    const input = screen.getByTestId("api-key-input");
    await user.type(input, "sk-another-secret");

    expect((input as HTMLInputElement).value).toBe("sk-another-secret");

    await user.click(screen.getByTestId("api-key-cancel"));

    // The harness flips `open` to false, so the dialog unmounts. Re-opening
    // it through the external button gives us a fresh input with the cleared
    // value.
    await user.click(screen.getByTestId("open"));

    const freshInput = screen.getByTestId("api-key-input");
    expect((freshInput as HTMLInputElement).value).toBe("");
  });

  it("renders server-side errors inline and keeps the dialog open", async () => {
    const onSave = vi.fn().mockResolvedValue({
      ok: false,
      message: "Incorrect API key",
    });

    const user = userEvent.setup();
    render(<ControlledHarness onSave={onSave} />);

    await user.type(screen.getByTestId("api-key-input"), "sk-bad-key");
    await user.click(screen.getByTestId("api-key-save"));

    await waitFor(() =>
      expect(screen.getByTestId("api-key-error")).toHaveTextContent(
        "Incorrect API key",
      ),
    );
    // The form is still open because the user must be able to type a fix.
    expect(screen.getByLabelText("add-api-key-form")).toBeInTheDocument();
    // The key was NOT cleared on failure — the user needs it to resubmit.
    expect(
      (screen.getByTestId("api-key-input") as HTMLInputElement).value,
    ).toBe("sk-bad-key");
  });

  it("renders Zod validation errors inline and blocks submit", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ControlledHarness onSave={onSave} />);

    // Submit with the apiKey left empty.
    await user.click(screen.getByTestId("api-key-save"));

    await waitFor(() =>
      expect(screen.getByTestId("api-key-error")).toBeInTheDocument(),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("typing in the input updates the visible value", async () => {
    const user = userEvent.setup();
    render(
      <ControlledHarness onSave={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    const input = screen.getByTestId("api-key-input");
    await user.type(input, "sk-typed");
    expect((input as HTMLInputElement).value).toBe("sk-typed");
  });

  it("uses type=password and autoComplete=off so the key is not autofilled", () => {
    render(
      <ControlledHarness onSave={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    const input = screen.getByTestId("api-key-input") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.autocomplete).toBe("off");
  });

  it("focuses the first focusable element when the dialog opens", async () => {
    render(
      <ControlledHarness onSave={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    // The dialog opens on mount. The provider select is the first focusable.
    // The focus effect runs after commit, so we wait for it to land.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId("api-key-provider"),
      ),
    );
  });
});
