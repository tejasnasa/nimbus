/**
 * @module api/__tests__/integration/contract
 * @description Golden snapshots of the public contract: the mounted REST route
 * table and the Socket.IO event names.
 *
 * Purpose is not coverage but *friction*: a route or event that is renamed,
 * removed, or unmounted must fail here, so the change has to be made consciously
 * in a second place. Clients on other release cycles depend on both surfaces.
 *
 * @important These lists are the snapshot. Update them when the contract changes
 *            on purpose — that edit is the review checkpoint.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { closeTestResources, resetDatabase } from "@testhelpers";

const app = createApp();

afterAll(closeTestResources);

/** Every route the API exposes, as (method, path). Every one sits behind `authCheck`. */
const ROUTE_CONTRACT = [
  ["get", "/api/workspace"],
  ["post", "/api/workspace/create"],
  ["post", "/api/workspace/join"],
  ["put", "/api/workspace/regenerate-invite/:wsid"],
  ["put", "/api/workspace/role/:wsid"],
  ["delete", "/api/workspace/leave/:wsid"],
  ["put", "/api/workspace/update/:wsid"],
  ["delete", "/api/workspace/delete/:wsid"],
  ["get", "/api/workspace/:slugId"],
  ["get", "/api/messages/:wsid"],
  ["post", "/api/document/create"],
  ["get", "/api/document/workspace/:workspaceId"],
  ["get", "/api/document/:docId"],
  ["delete", "/api/document/:docId"],
  ["get", "/api/turn/credentials"],
] as const;

/** Concrete values stand in for path params. */
const concretise = (path: string) =>
  path.replaceAll(":wsid", "cm_contract000000000000000").replaceAll(":workspaceId", "cm_contract000000000000000")
    .replaceAll(":docId", "cm_contract000000000000000")
    .replaceAll(":slugId", "1");

describe("contract: REST routes", () => {
  it.each(ROUTE_CONTRACT)("%s %s is mounted and guarded", async (method, path) => {
    await resetDatabase();

    const url = concretise(path);
    const res =
      method === "get"
        ? await request(app).get(url)
        : method === "post"
          ? await request(app).post(url).send({})
          : method === "put"
            ? await request(app).put(url).send({})
            : await request(app).delete(url).send({});

    // Anonymous callers get 401 from authCheck. A route that stopped being
    // mounted would 404 instead — which is what this catches.
    expect(res.status).toBe(401);
  });

  it("answers unknown /api paths with 404", async () => {
    const res = await request(app).get("/api/not-a-real-route");

    expect(res.status).toBe(404);
  });

  it("keeps better-auth mounted ahead of the API routers", async () => {
    const res = await request(app).get("/api/auth/get-session");

    expect(res.status).toBe(200);
  });
});

describe("contract: socket events", () => {
  /** Golden list of client→server event names, read from the shared type module. */
  const EXPECTED_CLIENT_EVENTS = [
    "workspace:join",
    "workspace:leave",
    "message:send",
    "typing:start",
    "typing:stop",
    "canvas:join",
    "canvas:leave",
    "canvas:update",
    "doc:join",
    "doc:update",
    "doc:leave",
    "voice:join",
    "voice:leave",
    "voice:offer",
    "voice:answer",
    "voice:ice-candidate",
    "voice:mute-state",
  ];

  it("declares exactly the documented client→server events", () => {
    // Read as source text: a rename in the type module is precisely the kind of
    // silent breaking change a runtime assertion cannot see.
    const source = readFileSync(
      fileURLToPath(new URL("../../../../../packages/types/src/socket/socketEvents.ts", import.meta.url)),
      "utf8",
    );
    // Bound the slice to the client→server block; splitting on the first marker
    // alone would run on into ServerToClientEvents and count both directions.
    const clientSection =
      (source.split("ClientToServerEvents")[1] ?? "").split("ServerToClientEvents")[0] ?? "";
    const declared = [...clientSection.matchAll(/^\s*"([a-z-]+:[a-zA-Z-]+)":/gm)].map(
      (match) => match[1]!,
    );

    expect([...new Set(declared)].sort()).toEqual([...EXPECTED_CLIENT_EVENTS].sort());
  });

  it("keeps the namespace:verb convention for every event", () => {
    for (const event of EXPECTED_CLIENT_EVENTS) {
      expect(event).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });
});
