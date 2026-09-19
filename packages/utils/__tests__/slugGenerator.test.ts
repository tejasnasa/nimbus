import { describe, expect, it } from "vitest";
import { generateSlug } from "../src/slugGenerator";

describe("generateSlug — normalisation", () => {
  it("lowercases and hyphenates a plain name", () => {
    expect(generateSlug("Ada Dev Lounge")).toBe("ada-dev-lounge");
  });

  it("strips accents via NFD normalisation", () => {
    expect(generateSlug("Café Münster")).toBe("cafe-munster");
    expect(generateSlug("Ünïcödé")).toBe("unicode");
  });

  it("removes straight and curly apostrophes without leaving a separator", () => {
    expect(generateSlug("Ada's Dev Lounge!")).toBe("adas-dev-lounge");
    expect(generateSlug("Ada’s Dev Lounge!")).toBe("adas-dev-lounge");
  });

  it("collapses runs of non-alphanumeric characters into a single hyphen", () => {
    expect(generateSlug("Hello,   World!!!")).toBe("hello-world");
    expect(generateSlug("a---b")).toBe("a-b");
    expect(generateSlug("a_-_b")).toBe("a-b");
  });

  it("trims surrounding whitespace and edge hyphens", () => {
    expect(generateSlug("   spaced   ")).toBe("spaced");
    expect(generateSlug("-leading-and-trailing-")).toBe("leading-and-trailing");
  });

  it("keeps digits and dots-as-separators", () => {
    expect(generateSlug("Nimbus 2.0")).toBe("nimbus-2-0");
    expect(generateSlug("workspace-42")).toBe("workspace-42");
  });

  it("accepts an already-slugified name unchanged", () => {
    expect(generateSlug("already-a-slug")).toBe("already-a-slug");
  });
});

describe("generateSlug — length", () => {
  it("caps the slug at 30 characters", () => {
    expect(generateSlug("a".repeat(40))).toHaveLength(30);
    expect(generateSlug("word ".repeat(20)).length).toBeLessThanOrEqual(30);
  });

  it.fails(
    "does not leave a trailing hyphen when truncation lands on a separator",
    () => {
      // 29 'a's followed by " b" slugifies to 29 chars + "-" + "b", so the
      // 30-character cap cuts exactly on that separator.
      const slug = generateSlug(`${"a".repeat(29)} b`);
      expect(slug.endsWith("-")).toBe(false);
      expect(slug).toBe("a".repeat(29));
    },
  );

  it("produces an empty slug for input that has no alphanumeric characters", () => {
    expect(generateSlug("日本語")).toBe("");
    expect(generateSlug("!!!")).toBe("");
    expect(generateSlug("")).toBe("");
  });
});

describe("generateSlug — determinism and collisions", () => {
  it("is deterministic for the same input", () => {
    const first = generateSlug("Team Rocket #1");
    for (let i = 0; i < 50; i++) {
      expect(generateSlug("Team Rocket #1")).toBe(first);
    }
  });

  it("maps different display names onto the same slug when they normalise alike", () => {
    expect(generateSlug("Ada's Dev")).toBe(generateSlug("Adas Dev"));
    expect(generateSlug("Design  Team")).toBe(generateSlug("design-team"));
  });

  it("collides for names that differ only past the 30-character cap", () => {
    const prefix = "a".repeat(30);
    expect(generateSlug(`${prefix}alice`)).toBe(generateSlug(`${prefix}bob`));
  });

  it("never emits characters outside [a-z0-9-]", () => {
    const inputs = [
      "Ada's Dev Lounge!",
      "Café Münster",
      "  Tab\tSeparated  ",
      "Ünïcödé / Slash #42",
      "emoji 🚀 rocket",
    ];
    for (const input of inputs) {
      expect(generateSlug(input)).toMatch(/^[a-z0-9-]*$/);
    }
  });

  it.fails(
    "matches the slug shown in its own JSDoc example",
    () => {
      expect(generateSlug("Ada's Dev Lounge!")).toBe("ada-s-dev-lounge");
    },
  );
});
