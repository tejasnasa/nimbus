/**
 * @module web/tests/components/AiRefusalBanner
 * @description The composer-adjacent refusal banner: the message it renders,
 * the label its CTA takes for each of the two CTAs, and that the CTA is
 * disabled while an action is already in flight.
 *
 * The `manage-ai` CTA has no producer today — nothing emits that reason yet —
 * but it is part of the component's contract, so it is pinned here rather than
 * left to be discovered the first time a refusal needs it.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AiRefusalBanner from "../../components/AiRefusalBanner";

describe("AiRefusalBanner", () => {
  it("renders the refusal message and an add-key CTA", () => {
    render(
      <AiRefusalBanner
        message="Add your API key to chat with @NimbusBot."
        cta="add-key"
        onCtaClickAction={() => {}}
      />,
    );

    expect(
      screen.getByText("Add your API key to chat with @NimbusBot."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ai-refusal-cta")).toHaveTextContent(
      "Add API key",
    );
  });

  it("labels the CTA for the manage-ai affordance", () => {
    render(
      <AiRefusalBanner
        message="No available model supports this feature."
        cta="manage-ai"
        onCtaClickAction={() => {}}
      />,
    );

    expect(screen.getByTestId("ai-refusal-cta")).toHaveTextContent("Manage AI");
  });

  it("disables the CTA while another action is in flight", () => {
    render(
      <AiRefusalBanner
        message="Add your API key to chat with @NimbusBot."
        cta="add-key"
        onCtaClickAction={() => {}}
        ctaDisabled
      />,
    );

    expect(screen.getByTestId("ai-refusal-cta")).toBeDisabled();
  });

  it("surfaces the banner as an alert for assistive technology", () => {
    render(
      <AiRefusalBanner
        message="Add your API key to chat with @NimbusBot."
        cta="add-key"
        onCtaClickAction={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add your API key to chat with @NimbusBot.",
    );
  });
});
