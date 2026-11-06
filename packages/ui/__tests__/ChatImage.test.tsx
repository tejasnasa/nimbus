import { describe, expect, it } from "vitest";
import ChatImage, { chatImageThumbnailUrl } from "../src/components/ChatImage";
import ChatMsgA from "../src/components/ChatMsgA";
import ChatMsgB from "../src/components/ChatMsgB";
import { render } from "./testUtils";

const FULL =
  "https://res.cloudinary.com/demo/image/upload/v1700000000/nimbus/chat/ws/pic.jpg";

describe("chatImageThumbnailUrl", () => {
  it("inserts a downscaling transformation after /upload/", () => {
    expect(chatImageThumbnailUrl(FULL)).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_limit,w_480,h_320,q_auto,f_auto/v1700000000/nimbus/chat/ws/pic.jpg",
    );
  });

  it("leaves a URL without /upload/ untouched", () => {
    expect(chatImageThumbnailUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
  });
});

describe("ChatImage", () => {
  it("links the thumbnail to the original in a new tab", () => {
    const { container } = render(<ChatImage url={FULL} />);

    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(FULL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.querySelector("img")!.getAttribute("src")).toContain("c_limit");
    expect(link.querySelector("img")!.getAttribute("alt")).toBe(
      "Attached image",
    );
  });

  it("right-aligns when asked", () => {
    const { container } = render(<ChatImage url={FULL} alignEnd />);

    expect(container.querySelector("a")!.className).toContain("ml-auto");
  });
});

describe("chat bubbles with an image", () => {
  const base = { name: "Ada", image: "/a.png", time: "12:00" };

  it("ChatMsgA shows the image above the text", () => {
    const { container } = render(
      <ChatMsgA {...base} message="look" imageUrl={FULL} />,
    );

    expect(container.querySelector("a")!.getAttribute("href")).toBe(FULL);
    expect(container.textContent).toContain("look");
  });

  it("ChatMsgA drops the empty text bubble for an image-only message", () => {
    const { container } = render(
      <ChatMsgA {...base} message="" imageUrl={FULL} />,
    );

    expect(container.querySelector("a")).not.toBeNull();
    expect(container.querySelector(".rounded-tl-sm")).toBeNull();
  });

  it("ChatMsgA keeps its bubble for an empty text-only message", () => {
    const { container } = render(<ChatMsgA {...base} message="" />);

    expect(container.querySelector(".rounded-tl-sm")).not.toBeNull();
  });

  it("ChatMsgB shows the image, right-aligned, and drops the empty bubble", () => {
    const { container } = render(
      <ChatMsgB {...base} message="" imageUrl={FULL} />,
    );

    expect(container.querySelector("a")!.className).toContain("ml-auto");
    expect(container.querySelector(".rounded-tr-sm")).toBeNull();
  });

  it("ChatMsgB keeps the text next to the image", () => {
    const { container } = render(
      <ChatMsgB {...base} message="hi @nimbusbot" imageUrl={FULL} />,
    );

    expect(container.querySelector(".rounded-tr-sm")!.textContent).toBe(
      "hi @nimbusbot",
    );
  });
});
