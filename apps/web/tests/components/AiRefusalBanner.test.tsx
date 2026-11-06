/**
 * @module web/tests/components/AiRefusalBanner
 * @description The composer-adjacent refusal banner: the message it renders,
 * the label its CTA takes for each of the two CTAs, and that the CTA is
 * disabled while an action is already in flight.
 *
 * The `manage-ai` CTA is used for a spent monthly cap, which a new key does not
 * fix. Members cannot act on any refusal, so for them the button is replaced
 * by a line telling them to ask a workspace admin.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

  it("labels the manage CTA for a spent monthly cap", () => {
    render(
      <AiRefusalBanner
        message="This workspace has reached its monthly AI spend cap."
        cta="manage-ai"
        reason="spend-cap-reached"
        onCtaClickAction={() => {}}
      />,
    );

    expect(screen.getByTestId("ai-refusal-cta")).toHaveTextContent(
      "Raise the cap",
    );
  });

  it("calls the handler when the CTA is used", async () => {
    const onCta = vi.fn();
    render(
      <AiRefusalBanner message="m" cta="add-key" onCtaClickAction={onCta} />,
    );

    await userEvent.setup().click(screen.getByTestId("ai-refusal-cta"));
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it("tells a member to ask an admin and offers no button", () => {
    render(
      <AiRefusalBanner
        message="This workspace has no AI key yet."
        cta="add-key"
        canManage={false}
        onCtaClickAction={() => {}}
      />,
    );

    expect(screen.queryByTestId("ai-refusal-cta")).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-refusal-ask-admin")).toHaveTextContent(
      "Ask a workspace admin",
    );
  });

  it("does not show the ask-an-admin line to someone who can manage", () => {
    render(
      <AiRefusalBanner message="m" cta="add-key" onCtaClickAction={() => {}} />,
    );

    expect(
      screen.queryByTestId("ai-refusal-ask-admin"),
    ).not.toBeInTheDocument();
  });
});
