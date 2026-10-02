/**
 * @module web/tests/components/TypingIndicator
 * @description Renders the typing label for one, two, and three-plus peers and
 * renders nothing beyond the dots + reserved height when no one is typing.
 * The label form is observable to screen-readers, so a name is asserted on
 * the rendered text rather than on an internal state shape.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TypingIndicator from "../../components/TypingIndicator";

describe("TypingIndicator", () => {
  it("renders no label when nobody is typing", () => {
    const { container } = render(<TypingIndicator names={[]} />);

    // The line is always present (reserved height), but the text content is
    // empty — the user does not see a misleading label.
    expect(container.querySelector("[aria-live='polite']")?.textContent).toBe(
      "",
    );
  });

  it("renders a single name in the singular form", () => {
    render(<TypingIndicator names={["Ana"]} />);

    expect(screen.getByText("Ana is typing…")).toBeInTheDocument();
  });

  it("renders two names joined with 'and'", () => {
    render(<TypingIndicator names={["Ana", "Ben"]} />);

    expect(screen.getByText("Ana and Ben are typing…")).toBeInTheDocument();
  });

  it("collapses three-plus names to a count", () => {
    render(<TypingIndicator names={["Ana", "Ben", "Cam"]} />);

    expect(screen.getByText("3 people are typing…")).toBeInTheDocument();
  });

  it("renders three animated dots for the visual treatment", () => {
    const { container } = render(<TypingIndicator names={["Ana"]} />);

    // The three pulsing dots are `aria-hidden`; their count is part of the
    // visual contract, but only as `span` siblings under the line.
    const dots = container.querySelectorAll("[aria-hidden='true'] > span");
    expect(dots.length).toBe(3);
  });

  /**
   * The reserved-height placeholder is the *line*, not the animation. Dots
   * rendered unconditionally leave a permanent "someone is typing" pulse on
   * screen even when the label is empty — the text assertion above cannot see
   * it, because dots carry no text.
   */
  it("renders no animated dots when nobody is typing", () => {
    const { container } = render(<TypingIndicator names={[]} />);

    expect(
      container.querySelectorAll("[aria-hidden='true'] > span"),
    ).toHaveLength(0);
  });

  it("keeps the reserved height when nobody is typing", () => {
    const { container } = render(<TypingIndicator names={[]} />);

    // The line must still occupy its height, or the composer jumps as the
    // indicator appears and disappears.
    expect(container.querySelector("[aria-live='polite']")?.className).toContain(
      "h-5",
    );
  });
});
