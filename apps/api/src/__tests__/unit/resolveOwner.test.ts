/**
 * @module api/__tests__/unit/resolveOwner
 * @description Matching a spoken name to a workspace member: the whole name,
 * then the first name, then a prefix; ambiguity and no match give no owner;
 * Unicode names compare the way people read them.
 */
import { describe, expect, it } from "vitest";
import { resolveOwner } from "../../lib/meeting/resolveOwner";

const members = [
  { userId: "u-priya", name: "Priya Shah" },
  { userId: "u-tom", name: "Tom Brandt" },
  { userId: "u-jonathan", name: "Jonathan Lee" },
  { userId: "u-alex1", name: "Alex Kim" },
  { userId: "u-alex2", name: "Alex Moreau" },
];

describe("resolveOwner", () => {
  it("matches the full name regardless of case and spacing", () => {
    expect(resolveOwner("priya SHAH", members)).toBe("u-priya");
    expect(resolveOwner("  Tom   Brandt ", members)).toBe("u-tom");
  });

  it("prefers an exact full name over a shared first name", () => {
    expect(resolveOwner("Alex Kim", members)).toBe("u-alex1");
  });

  it("matches a unique first name", () => {
    expect(resolveOwner("Priya", members)).toBe("u-priya");
    expect(resolveOwner("tom", members)).toBe("u-tom");
  });

  it("matches a unique prefix", () => {
    expect(resolveOwner("Jon", members)).toBe("u-jonathan");
    expect(resolveOwner("Jonathan L", members)).toBe("u-jonathan");
  });

  it("gives no owner when the first name is shared", () => {
    expect(resolveOwner("Alex", members)).toBeNull();
  });

  it("gives no owner when a prefix is shared", () => {
    expect(resolveOwner("Al", members)).toBeNull();
  });

  it("gives no owner when two members have the same full name", () => {
    const twins = [
      { userId: "a", name: "Sam Lee" },
      { userId: "b", name: "sam lee" },
    ];
    expect(resolveOwner("Sam Lee", twins)).toBeNull();
  });

  it("gives no owner when nothing matches", () => {
    expect(resolveOwner("Zed", members)).toBeNull();
    expect(resolveOwner("", members)).toBeNull();
    expect(resolveOwner("   ", members)).toBeNull();
  });

  it("does not match a one-letter prefix", () => {
    expect(resolveOwner("T", members)).toBeNull();
  });

  it("gives no owner for an empty member list", () => {
    expect(resolveOwner("Priya", [])).toBeNull();
  });

  describe("Unicode names", () => {
    const international = [
      { userId: "u-zoe", name: "Zoë Müller" },
      { userId: "u-jose", name: "José García" },
      { userId: "u-aiko", name: "愛子 田中" },
      { userId: "u-anna", name: "Анна Петрова" },
    ];

    it("is case-insensitive beyond ASCII", () => {
      expect(resolveOwner("ZOË MÜLLER", international)).toBe("u-zoe");
      expect(resolveOwner("анна", international)).toBe("u-anna");
    });

    it("treats a combining accent like the precomposed letter", () => {
      expect(resolveOwner("Zoë", international)).toBe("u-zoe");
      expect(resolveOwner("José", international)).toBe("u-jose");
    });

    it("matches names in other scripts by first name and full name", () => {
      expect(resolveOwner("愛子", international)).toBe("u-aiko");
      expect(resolveOwner("愛子 田中", international)).toBe("u-aiko");
    });

    it("does not match a different accent", () => {
      expect(resolveOwner("Zoe", international)).toBeNull();
    });
  });
});
