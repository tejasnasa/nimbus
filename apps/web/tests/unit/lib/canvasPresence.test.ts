/**
 * @module web/tests/unit/lib/canvasPresence
 * @description Building Excalidraw collaborators from relayed pointers,
 * expiring silent ones, and the element signature that keeps pointer traffic
 * from being mistaken for an edit.
 */
import { describe, expect, it } from "vitest";
import {
  COLLABORATOR_TTL_MS,
  collaboratorFromPointer,
  elementsSignature,
  pruneStale,
  toSceneCollaborators,
  type PointerMessage,
  type TrackedCollaborator,
} from "../../../lib/canvasPresence";

const message = (over: Partial<PointerMessage> = {}): PointerMessage => ({
  canvasId: "c1",
  socketId: "s1",
  user: { userId: "u1", name: "Ada", color: "#34d399", image: null },
  x: 1,
  y: 2,
  ...over,
});

describe("collaboratorFromPointer", () => {
  it("maps position, tool, button, selection and identity", () => {
    const collaborator = collaboratorFromPointer(
      message({
        tool: "laser",
        button: "down",
        selectedElementIds: ["a", "b"],
        user: {
          userId: "u1",
          name: "Ada",
          color: "#34d399",
          image: "https://i/a.png",
        },
      }),
    );

    expect(collaborator).toMatchObject({
      pointer: { x: 1, y: 2, tool: "laser" },
      button: "down",
      selectedElementIds: { a: true, b: true },
      username: "Ada",
      id: "u1",
      socketId: "s1",
      avatarUrl: "https://i/a.png",
      color: { background: "#34d399" },
    });
  });

  it("defaults to a plain pointer that is up with nothing selected", () => {
    const collaborator = collaboratorFromPointer(message());

    expect(collaborator.pointer?.tool).toBe("pointer");
    expect(collaborator.button).toBe("up");
    expect(collaborator.selectedElementIds).toEqual({});
    expect(collaborator.avatarUrl).toBeUndefined();
  });
});

describe("pruneStale", () => {
  const entry = (seenAt: number): TrackedCollaborator => ({
    collaborator: collaboratorFromPointer(message()),
    seenAt,
  });

  it("removes only collaborators silent for longer than the TTL", () => {
    const now = 100_000;
    const tracked = new Map([
      ["fresh", entry(now - 1_000)],
      ["edge", entry(now - COLLABORATOR_TTL_MS)],
      ["stale", entry(now - COLLABORATOR_TTL_MS - 1)],
    ]);

    expect(pruneStale(tracked, now)).toBe(true);
    expect([...tracked.keys()]).toEqual(["fresh", "edge"]);
  });

  it("reports when nothing was removed", () => {
    const tracked = new Map([["fresh", entry(1_000)]]);

    expect(pruneStale(tracked, 2_000)).toBe(false);
  });
});

describe("toSceneCollaborators", () => {
  it("keys the collaborators by socket id", () => {
    const collaborator = collaboratorFromPointer(message());
    const scene = toSceneCollaborators(
      new Map([["s1", { collaborator, seenAt: 0 }]]),
    );

    expect(scene.get("s1" as never)).toBe(collaborator);
  });
});

describe("elementsSignature", () => {
  const el = (id: string, version = 1, versionNonce = 1) => ({
    id,
    version,
    versionNonce,
  });

  it("is stable for the same scene", () => {
    expect(elementsSignature([el("a"), el("b")])).toBe(
      elementsSignature([el("a"), el("b")]),
    );
  });

  it("changes when an element is added, removed, replaced or mutated", () => {
    const base = elementsSignature([el("a")]);

    expect(elementsSignature([el("a"), el("b")])).not.toBe(base);
    expect(elementsSignature([])).not.toBe(base);
    expect(elementsSignature([el("b")])).not.toBe(base);
    expect(elementsSignature([el("a", 2)])).not.toBe(base);
    expect(elementsSignature([el("a", 1, 2)])).not.toBe(base);
  });

  it("copes with elements that carry no version fields", () => {
    expect(elementsSignature([{ id: "a" }])).toBe(
      elementsSignature([{ id: "a" }]),
    );
  });
});
