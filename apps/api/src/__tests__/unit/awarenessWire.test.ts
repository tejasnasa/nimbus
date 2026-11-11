/**
 * @module api/__tests__/unit/awarenessWire
 * @description The awareness codec and rate limiter used by the presence
 * handlers. The codec is checked against real y-protocols output in both
 * directions, because it re-implements that framing.
 */
import { describe, expect, it } from "vitest";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";
import {
  MAX_AWARENESS_ENTRIES,
  decodeAwarenessEntries,
  encodeAwarenessEntries,
  sanitizeAwarenessState,
} from "../../lib/awareness";
import { createRateLimiter } from "../../lib/rateLimiter";

const identity = { id: "u1", name: "Ada", image: "https://img/ada.png" };

describe("awareness codec", () => {
  it("reads what y-protocols encodes", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState({ user: { name: "x" }, cursor: null });

    const entries = decodeAwarenessEntries(
      encodeAwarenessUpdate(awareness, [doc.clientID]),
    );

    expect(entries).toEqual([
      {
        clientId: doc.clientID,
        clock: 1,
        state: { user: { name: "x" }, cursor: null },
      },
    ]);
  });

  it("writes what y-protocols applies", () => {
    const source = new Awareness(new Y.Doc());
    const target = new Awareness(new Y.Doc());
    const bytes = encodeAwarenessEntries([
      { clientId: 77, clock: 3, state: { cursor: null } },
    ]);

    applyAwarenessUpdate(target, bytes, "test");

    expect(target.getStates().get(77)).toEqual({ cursor: null });
    source.destroy();
    target.destroy();
  });

  it("round-trips a removal", () => {
    const bytes = encodeAwarenessEntries([
      { clientId: 5, clock: 9, state: null },
    ]);
    expect(decodeAwarenessEntries(bytes)).toEqual([
      { clientId: 5, clock: 9, state: null },
    ]);
  });

  it("rejects malformed input", () => {
    expect(decodeAwarenessEntries(new Uint8Array([1]))).toBeNull();
    expect(
      decodeAwarenessEntries(new Uint8Array([1, 5, 1, 3, 110])),
    ).toBeNull();
    const trailing = new Uint8Array([
      ...encodeAwarenessEntries([{ clientId: 1, clock: 1, state: null }]),
      0,
    ]);
    expect(decodeAwarenessEntries(trailing)).toBeNull();
  });

  it("rejects a state that is not an object", () => {
    const bytes = encodeAwarenessEntries([
      { clientId: 1, clock: 1, state: [] as never },
    ]);
    expect(decodeAwarenessEntries(bytes)).toBeNull();
  });

  it("rejects more entries than a tab needs", () => {
    const bytes = encodeAwarenessEntries(
      Array.from({ length: MAX_AWARENESS_ENTRIES + 1 }, (_, i) => ({
        clientId: i,
        clock: 1,
        state: null,
      })),
    );
    expect(decodeAwarenessEntries(bytes)).toBeNull();
  });
});

describe("sanitizeAwarenessState", () => {
  it("stamps the session's identity and drops unknown fields", () => {
    const clean = sanitizeAwarenessState(
      { user: { name: "Mallory" }, cursor: null, script: "x" },
      identity,
    );
    expect(clean).toEqual({
      user: {
        userId: "u1",
        name: "Ada",
        color: expect.stringMatching(/^#[0-9a-f]{6}$/),
        image: "https://img/ada.png",
      },
      cursor: null,
    });
  });

  it("keeps a well-formed cursor and drops a malformed one", () => {
    const cursor = { anchor: { a: 1 }, head: { b: 2 } };
    expect(sanitizeAwarenessState({ cursor }, identity).cursor).toEqual(cursor);
    expect(
      "cursor" in sanitizeAwarenessState({ cursor: "nope" }, identity),
    ).toBe(false);
    expect(
      "cursor" in sanitizeAwarenessState({ cursor: { anchor: 1 } }, identity),
    ).toBe(false);
  });

  it("uses a null image when the session has none", () => {
    const clean = sanitizeAwarenessState({}, { id: "u2", name: "Bo" });
    expect((clean.user as { image: unknown }).image).toBeNull();
  });
});

describe("createRateLimiter", () => {
  it("allows the budget, refuses the excess, and resets each window", () => {
    let now = 1_000;
    const allow = createRateLimiter(2, 1_000, () => now);

    expect([allow(), allow(), allow()]).toEqual([true, true, false]);

    now += 999;
    expect(allow()).toBe(false);

    now += 1;
    expect([allow(), allow(), allow()]).toEqual([true, true, false]);
  });
});
