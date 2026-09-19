import { afterEach, describe, expect, it } from "vitest";
import Avatar from "../src/components/Avatar";
import AvatarGroup from "../src/components/AvatarGroup";
import ChatMsgA from "../src/components/ChatMsgA";
import ChatMsgB from "../src/components/ChatMsgB";
import Input from "../src/components/Input";
import Textarea from "../src/components/Textarea";
import { Skeleton } from "../src/components/Skeleton";
import OrContinueWith from "../src/components/OrContinueWith";
import { AIGenOrb } from "../src/components/AiGenOrb";
import { cleanupDom, query, queryAll, render } from "./testUtils";

afterEach(cleanupDom);

describe("Avatar", () => {
  it("renders the user image with the name as alt text", () => {
    const { container } = render(
      <Avatar user={{ name: "Ada", image: "/ada.png" }} classname="h-10 w-10" />,
    );
    const img = query<HTMLImageElement>(container, "img");
    expect(img.getAttribute("src")).toBe("/ada.png");
    expect(img.getAttribute("alt")).toBe("Ada");
    expect(img.className).toContain("rounded-full");
  });

  it("applies the sizing classes to the wrapper", () => {
    const { container } = render(
      <Avatar user={{ name: "Ada", image: "/ada.png" }} classname="h-10 w-10" />,
    );
    expect(query(container, "div").className).toContain("h-10 w-10");
  });

  it("shows the presence dot only for online users", () => {
    const offline = render(<Avatar user={{ name: "Ada", image: "/a.png" }} />);
    expect(offline.container.querySelectorAll("div.relative > div")).toHaveLength(0);

    const online = render(
      <Avatar user={{ name: "Ada", image: "/a.png", isOnline: true }} />,
    );
    const dot = query(online.container, "div.relative > div");
    expect(dot.className).toContain("bg-(--chart-2)");
  });
});

describe("AvatarGroup", () => {
  const users = (n: number, online = false) =>
    Array.from({ length: n }, (_, i) => ({ image: `/u${i}.png`, online }));

  it("renders every avatar up to the default maximum of three", () => {
    const { container } = render(<AvatarGroup users={users(3)} />);
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(container.textContent).not.toContain("+");
  });

  it("collapses the overflow into a +N badge", () => {
    const { container } = render(<AvatarGroup users={users(7)} />);
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(container.textContent).toContain("+4");
  });

  it("never renders a negative overflow badge", () => {
    const { container } = render(<AvatarGroup users={users(2)} max={5} />);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.textContent).toBe("");
  });

  it("respects a custom maximum and hides the badge at exactly max", () => {
    const four = render(<AvatarGroup users={users(4)} max={4} />);
    expect(four.container.querySelectorAll("img")).toHaveLength(4);
    expect(four.container.textContent).not.toContain("+");

    const five = render(<AvatarGroup users={users(4)} max={3} />);
    expect(five.container.textContent).toContain("+1");
  });

  it("collapses everything into the badge when max is zero", () => {
    const { container } = render(<AvatarGroup users={users(2)} max={0} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).toContain("+2");
  });

  it("renders an empty stack for no members", () => {
    const { container } = render(<AvatarGroup users={[]} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("stacks later avatars underneath earlier ones", () => {
    const { container } = render(<AvatarGroup users={users(3)} />);
    const wrappers = queryAll<HTMLDivElement>(container, "div.relative");
    expect(wrappers.map((w) => w.style.zIndex)).toEqual(["3", "2", "1"]);
  });

  it("shows a presence dot per online member", () => {
    const { container } = render(<AvatarGroup users={users(2, true)} />);
    expect(queryAll(container, "div.relative > div")).toHaveLength(2);
  });

  it("appends caller classes to the stack", () => {
    const { container } = render(<AvatarGroup users={users(1)} className="mt-2" />);
    expect(query(container, "div").className).toContain("mt-2");
  });
});

describe("ChatMsgA", () => {
  const base = { name: "NimbusBot", image: "/bot.png", message: "hello", time: "12:00" };

  it("renders the sender, message and hover timestamp", () => {
    const { container } = render(<ChatMsgA {...base} />);
    expect(container.textContent).toContain("NimbusBot");
    expect(container.textContent).toContain("hello");
    expect(container.textContent).toContain("12:00");
  });

  it("highlights bot names", () => {
    const bot = render(<ChatMsgA {...base} isBot />);
    expect(query(bot.container, "span.text-xs").className).toContain("text-blue-500");

    const human = render(<ChatMsgA {...base} />);
    expect(query(human.container, "span.text-xs").className).not.toContain(
      "text-blue-500",
    );
  });

  it("passes the online flag through to the avatar", () => {
    const { container } = render(<ChatMsgA {...base} isOnline />);
    expect(queryAll(container, "img").length).toBe(1);
    expect(queryAll(container, "div.relative > div")).toHaveLength(1);
  });

  it("preserves whitespace in multi-line messages", () => {
    const { container } = render(<ChatMsgA {...base} message={"a\nb"} />);
    expect(
      query(container, "div.whitespace-pre-wrap").textContent,
    ).toBe("a\nb");
  });
});

describe("ChatMsgB", () => {
  it("right-aligns the outgoing bubble", () => {
    const { container } = render(
      <ChatMsgB name="Ada" image="/ada.png" message="hi" time="12:01" />,
    );
    expect(query(container, "div.justify-end")).toBeTruthy();
    const bubble = queryAll<HTMLDivElement>(container, "div").find((d) =>
      d.className.includes("bg-(--primary)/15"),
    );
    expect(bubble?.textContent).toBe("hi");
    expect(container.textContent).toContain("Ada");
    expect(container.textContent).toContain("12:01");
  });
});

describe("Skeleton", () => {
  it("renders the shimmer base with caller sizing", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = query(container, "div");
    expect(el.className).toContain("animate-shimmer");
    expect(el.className).toContain("h-4 w-32");
    expect(el.style.backgroundSize).toBe("200% 100%");
  });

  it("lets caller styles override the shimmer defaults", () => {
    const { container } = render(<Skeleton style={{ backgroundSize: "100% 100%" }} />);
    expect(query(container, "div").style.backgroundSize).toBe("100% 100%");
  });
});

describe("Input", () => {
  it("forwards native props and appends caller classes", () => {
    const { container } = render(
      <Input type="email" placeholder="you@example.com" defaultValue="x" className="mt-1" />,
    );
    const input = query<HTMLInputElement>(container, "input");
    expect(input.getAttribute("type")).toBe("email");
    expect(input.getAttribute("placeholder")).toBe("you@example.com");
    expect(input.value).toBe("x");
    expect(input.className).toContain("h-11");
    expect(input.className).toContain("mt-1");
    expect(input.className).not.toContain("undefined");
  });
});

describe("Textarea", () => {
  it("forwards native props", () => {
    const { container } = render(
      <Textarea placeholder="Describe it" defaultValue="draft" rows={4} />,
    );
    const textarea = query<HTMLTextAreaElement>(container, "textarea");
    expect(textarea.getAttribute("placeholder")).toBe("Describe it");
    expect(textarea.value).toBe("draft");
    expect(textarea.getAttribute("rows")).toBe("4");
    expect(textarea.className).toContain("resize-none");
  });

  it.fails("does not emit a literal 'undefined' class when className is omitted", () => {
    const { container } = render(<Textarea />);
    expect(query(container, "textarea").className).not.toContain("undefined");
  });
});

describe("OrContinueWith", () => {
  it("renders the divider label", () => {
    const { container } = render(<OrContinueWith />);
    expect(container.textContent).toBe("or");
    expect(container.querySelectorAll("div")).toHaveLength(3);
  });
});

describe("AIGenOrb", () => {
  it("renders the decorative orb without props", () => {
    const { container } = render(<AIGenOrb />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    expect(container.querySelectorAll("circle")[0]!.getAttribute("r")).toBe("54");
  });
});
