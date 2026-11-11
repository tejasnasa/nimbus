/**
 * @module web/tests/components/PresenceAvatars
 * @description The "who's here" strip: nothing when alone, an avatar per other
 * person with a name on hover, a `+N` overflow past four, and one accessible
 * label naming everyone.
 */
import "./testUtils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PresenceAvatars from "../../components/PresenceAvatars";
import type { PresencePeer } from "../../lib/presence";

const peer = (name: string, image: string | null = null): PresencePeer => ({
  userId: `u_${name.toLowerCase()}`,
  name,
  color: "#34d399",
  image,
});

describe("PresenceAvatars", () => {
  it("renders nothing when nobody else is in the document", () => {
    const { container } = render(<PresenceAvatars peers={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows an avatar per person with their name as the hover title", () => {
    render(<PresenceAvatars peers={[peer("Ada"), peer("Grace")]} />);

    const avatars = screen.getAllByTestId("presence-avatar");
    expect(avatars.map((a) => a.getAttribute("title"))).toEqual([
      "Ada",
      "Grace",
    ]);
    expect(screen.queryByTestId("presence-overflow")).not.toBeInTheDocument();
  });

  it("labels the group for assistive technology", () => {
    render(<PresenceAvatars peers={[peer("Ada"), peer("Grace")]} />);

    expect(
      screen.getByRole("group", { name: "Also editing: Ada, Grace" }),
    ).toBeInTheDocument();
  });

  it("uses the person's image when they have one", () => {
    render(<PresenceAvatars peers={[peer("Ada", "https://i/ada.png")]} />);

    expect(screen.getByAltText("Ada")).toHaveAttribute(
      "src",
      "https://i/ada.png",
    );
  });

  it("falls back to the deterministic avatar when they have none", () => {
    render(<PresenceAvatars peers={[peer("Ada")]} />);

    expect(screen.getByAltText("Ada").getAttribute("src")).toBeTruthy();
  });

  it("rings each avatar in the person's cursor colour", () => {
    render(<PresenceAvatars peers={[peer("Ada")]} />);

    expect(screen.getByTestId("presence-avatar").style.boxShadow).toContain(
      "#34d399",
    );
  });

  it("collapses everyone past four into +N, naming them on hover and in the label", () => {
    const names = ["Ada", "Bo", "Cy", "Di", "Ed", "Flo"];
    render(<PresenceAvatars peers={names.map((n) => peer(n))} />);

    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(4);
    const overflow = screen.getByTestId("presence-overflow");
    expect(overflow).toHaveTextContent("+2");
    expect(overflow).toHaveAttribute("title", "Ed, Flo");
    expect(screen.getByRole("group")).toHaveAttribute(
      "aria-label",
      "Also editing: Ada, Bo, Cy, Di, Ed, Flo",
    );
  });

  it("shows exactly four with no overflow chip", () => {
    render(
      <PresenceAvatars peers={["Ada", "Bo", "Cy", "Di"].map((n) => peer(n))} />,
    );

    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(4);
    expect(screen.queryByTestId("presence-overflow")).not.toBeInTheDocument();
  });
});
