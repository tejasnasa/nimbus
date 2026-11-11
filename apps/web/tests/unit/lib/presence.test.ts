/**
 * @module web/tests/unit/lib/presence
 * @description The pure presence helpers: the local awareness identity, the
 * de-duplicated list of other people, the accessible label, and the pointer
 * throttle. These carry the rules the editors rely on (never list yourself,
 * one entry per person, never drop the last pointer position).
 */
import { presenceColor } from "@nimbus/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alsoEditingLabel,
  localAwarenessUser,
  peersFromAwareness,
  peersFromRoster,
  samePeers,
  throttle,
} from "../../../lib/presence";

const state = (user: unknown) => ({ user }) as Record<string, unknown>;

describe("localAwarenessUser", () => {
  it("derives the colour from the user id and defaults the image to null", () => {
    expect(localAwarenessUser({ id: "u1", name: "Ada" })).toEqual({
      userId: "u1",
      name: "Ada",
      color: presenceColor("u1"),
      image: null,
    });
  });

  it("keeps the user's image", () => {
    expect(
      localAwarenessUser({ id: "u1", name: "Ada", image: "https://i/a.png" })
        .image,
    ).toBe("https://i/a.png");
  });
});

describe("peersFromAwareness", () => {
  it("excludes this tab, and any other tab of the same user", () => {
    const states = new Map([
      [1, state({ userId: "me", name: "Me" })],
      [2, state({ userId: "me", name: "Me" })],
      [3, state({ userId: "ada", name: "Ada", color: "#34d399" })],
    ]);

    expect(peersFromAwareness(states, 1, "me")).toEqual([
      { userId: "ada", name: "Ada", color: "#34d399", image: null },
    ]);
  });

  it("lists a person once however many tabs they have open", () => {
    const states = new Map([
      [2, state({ userId: "ada", name: "Ada" })],
      [3, state({ userId: "ada", name: "Ada" })],
    ]);

    expect(peersFromAwareness(states, 1)).toHaveLength(1);
  });

  it("orders by name so the strip does not reshuffle", () => {
    const states = new Map([
      [2, state({ userId: "z", name: "Zed" })],
      [3, state({ userId: "a", name: "Ada" })],
      [4, state({ userId: "g", name: "Grace" })],
    ]);

    expect(peersFromAwareness(states, 1).map((p) => p.name)).toEqual([
      "Ada",
      "Grace",
      "Zed",
    ]);
  });

  it("skips states that are not a usable user and falls back for a missing colour", () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, {}],
      [3, state(null)],
      [4, state("ada")],
      [5, state({ userId: 7, name: "Numeric" })],
      [6, state({ userId: "x", name: "No colour" })],
    ]);

    expect(peersFromAwareness(states, 1)).toEqual([
      {
        userId: "x",
        name: "No colour",
        color: presenceColor("x"),
        image: null,
      },
    ]);
  });

  it("only trusts an https avatar image", () => {
    const states = new Map([
      [2, state({ userId: "a", name: "A", image: "https://i/a.png" })],
      [3, state({ userId: "b", name: "B", image: "javascript:alert(1)" })],
      [4, state({ userId: "c", name: "C", image: "http://i/c.png" })],
    ]);

    expect(peersFromAwareness(states, 1).map((p) => p.image)).toEqual([
      "https://i/a.png",
      null,
      null,
    ]);
  });
});

describe("peersFromRoster", () => {
  it("excludes the signed-in user and dedupes by user", () => {
    const ada = { userId: "ada", name: "Ada", color: "#fff", image: null };
    const me = { userId: "me", name: "Me", color: "#000", image: null };

    expect(peersFromRoster([ada, me, { ...ada }], "me")).toEqual([ada]);
  });
});

describe("samePeers", () => {
  const ada = { userId: "ada", name: "Ada", color: "#fff", image: null };

  it("is true for equal lists and false for any difference", () => {
    expect(samePeers([ada], [{ ...ada }])).toBe(true);
    expect(samePeers([ada], [])).toBe(false);
    expect(samePeers([ada], [{ ...ada, name: "Ad" }])).toBe(false);
    expect(samePeers([ada], [{ ...ada, color: "#000" }])).toBe(false);
    expect(samePeers([ada], [{ ...ada, image: "https://i" }])).toBe(false);
    expect(samePeers([ada], [{ ...ada, userId: "bob" }])).toBe(false);
  });
});

describe("alsoEditingLabel", () => {
  it("names everyone", () => {
    const peer = (name: string) => ({
      userId: name,
      name,
      color: "#fff",
      image: null,
    });

    expect(alsoEditingLabel([peer("Ada"), peer("Grace")])).toBe(
      "Also editing: Ada, Grace",
    );
  });
});

describe("throttle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls through immediately, then at most once per interval with the latest arguments", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 50);

    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn.mock.calls).toEqual([[1]]);

    vi.advanceTimersByTime(50);
    expect(fn.mock.calls).toEqual([[1], [3]]);

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls through again once the interval has passed with nothing pending", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 50);

    throttled(1);
    vi.advanceTimersByTime(60);
    throttled(2);

    expect(fn.mock.calls).toEqual([[1], [2]]);
  });

  it("cancel drops the pending trailing call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 50);

    throttled(1);
    throttled(2);
    throttled.cancel();
    vi.advanceTimersByTime(200);

    expect(fn.mock.calls).toEqual([[1]]);
  });

  it("uses the injected clock", () => {
    let now = 0;
    const fn = vi.fn();
    const throttled = throttle(fn, 50, () => now);

    throttled("a");
    now = 49;
    throttled("b");
    expect(fn).toHaveBeenCalledTimes(1);
    throttled.cancel();

    now = 50;
    throttled("c");
    expect(fn.mock.calls).toEqual([["a"], ["c"]]);
  });
});
