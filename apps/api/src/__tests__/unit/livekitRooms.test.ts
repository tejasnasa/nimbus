/**
 * @module api/__tests__/unit/livekitRooms
 * @description The workspace-to-room naming contract. The webhook trusts
 * `workspaceIdFromRoom` to decide whether an event is about a workspace at all,
 * so what it must refuse matters as much as what it accepts.
 */
import { describe, expect, it } from "vitest";
import {
  isAgentIdentity,
  isAgentParticipant,
  roomNameFor,
  workspaceIdFromRoom,
} from "../../lib/livekit/rooms";

describe("lib/livekit/rooms", () => {
  it("round-trips a workspace id through its room name", () => {
    const id = "cm9abc123xyz";

    expect(roomNameFor(id)).toBe("nimbus-ws-cm9abc123xyz");
    expect(workspaceIdFromRoom(roomNameFor(id))).toBe(id);
  });

  it.each([
    ["a room from another application", "standup"],
    ["the prefix alone", "nimbus-ws-"],
    ["a different prefix", "other-ws-abc"],
    ["the prefix not at the start", "x-nimbus-ws-abc"],
    ["an id with a path separator", "nimbus-ws-abc/def"],
    ["an id with whitespace", "nimbus-ws-abc def"],
    ["an empty name", ""],
  ])("parses %s to null", (_label, room) => {
    expect(workspaceIdFromRoom(room)).toBeNull();
  });

  it("parses a missing room to null", () => {
    expect(workspaceIdFromRoom(undefined)).toBeNull();
    expect(workspaceIdFromRoom(null)).toBeNull();
  });

  it("recognises agent identities and leaves user ids alone", () => {
    expect(isAgentIdentity("agent-AJ_8fKq")).toBe(true);
    expect(isAgentIdentity("cm9abc123xyz")).toBe(false);
    expect(isAgentIdentity("")).toBe(false);
    expect(isAgentIdentity(undefined)).toBe(false);
  });

  it("recognises an agent by the kind the server reports, too", () => {
    expect(isAgentParticipant({ identity: "someone", kind: 4 })).toBe(true);
    expect(isAgentParticipant({ identity: "agent-x", kind: 0 })).toBe(true);
    expect(isAgentParticipant({ identity: "cm9abc", kind: 0 })).toBe(false);
  });
});
