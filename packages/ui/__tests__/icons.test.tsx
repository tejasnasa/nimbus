import { afterEach, describe, expect, it } from "vitest";
import Download from "../src/components/icons/Download";
import Edit from "../src/components/icons/Edit";
import { cleanupDom, query, render } from "./testUtils";

afterEach(cleanupDom);

describe("action icons", () => {
  it.each([
    ["Download", Download],
    ["Edit", Edit],
  ])(
    "%s renders an svg that takes its colour and size from the caller",
    (_name, Icon) => {
      const { container } = render(<Icon className="size-4 text-red-500" />);

      const svg = query(container, "svg");
      expect(svg.getAttribute("class")).toBe("size-4 text-red-500");
      expect(svg.getAttribute("fill")).toBe("currentColor");
      expect(svg.querySelector("path")).not.toBeNull();
    },
  );
});
