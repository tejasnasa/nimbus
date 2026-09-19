/**
 * @module web/tests/msw/handlers
 * @description Default happy-path handlers for every API endpoint the web app
 * calls. Individual tests override these with `server.use(...)` to exercise
 * failure paths.
 *
 * Responses mirror the API's `ServerResponse` envelope exactly — a test that
 * only ever sees the success shape would not catch a client that ignores
 * `success: false`.
 */
import { http, HttpResponse } from "msw";

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

/** Builds the standard success envelope. */
export const ok = <T>(responseObject: T, message = "OK") =>
  HttpResponse.json({ success: true, message, responseObject, statusCode: 200 });

/** Builds a failure envelope, so client error handling can be exercised. */
export const fail = (statusCode: number, message: string) =>
  HttpResponse.json(
    { success: false, message, responseObject: null, statusCode },
    { status: statusCode },
  );

const url = (path: string) => `${BACKEND_URL}${path}`;

export const handlers = [
  // ── Workspaces ──
  http.get(url("/api/workspace"), () => ok([])),
  http.post(url("/api/workspace/create"), () =>
    HttpResponse.json(
      {
        success: true,
        message: "Workspace created",
        responseObject: {
          workspaceId: "cm_workspace_0000000000000",
          name: "Test Workspace",
          slug: "test-workspace",
          slugId: 1,
          creatorId: "user-1",
          inviteCode: "invite-code",
        },
        statusCode: 201,
      },
      { status: 201 },
    ),
  ),
  http.post(url("/api/workspace/join"), () =>
    ok({ slug: "test-workspace", slugId: 1 }, "Joined workspace"),
  ),
  http.put(url("/api/workspace/regenerate-invite/:wsid"), () =>
    ok({ inviteCode: "rotated-code" }, "Invite code regenerated"),
  ),
  http.put(url("/api/workspace/role/:wsid"), () => ok({ role: "ADMIN" }, "Member role updated")),
  http.delete(url("/api/workspace/leave/:wsid"), () => ok({}, "Member removed")),
  http.put(url("/api/workspace/update/:wsid"), () => ok({}, "Workspace updated")),
  http.delete(url("/api/workspace/delete/:wsid"), () => ok(null, "Workspace deleted")),
  http.get(url("/api/workspace/:slugId"), () =>
    ok({
      id: "cm_workspace_0000000000000",
      name: "Test Workspace",
      description: "",
      slug: "test-workspace",
      slugId: 1,
      inviteCode: "invite-code",
      updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      members: [
        { id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" },
        { id: "user-2", name: "Grace Hopper", image: null, role: "MEMBER" },
      ],
    }),
  ),

  // ── Documents ──
  http.post(url("/api/document/create"), () =>
    ok({ id: "cm_document_00000000000000", title: "New Document", type: "CANVAS" }),
  ),
  http.get(url("/api/document/workspace/:workspaceId"), () => ok([])),
  http.get(url("/api/document/:docId"), () =>
    ok({ id: "cm_document_00000000000000", title: "Readable", type: "CANVAS" }),
  ),
  http.delete(url("/api/document/:docId"), () => ok("Document deleted")),

  // ── Messages ──
  http.get(url("/api/messages/:wsid"), () => ok([])),

  // ── TURN ──
  http.get(url("/api/turn/credentials"), () =>
    ok({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "turn:127.0.0.1:3478?transport=udp", username: "123:user-1", credential: "abc" },
      ],
    }),
  ),

  // ── better-auth ──
  http.post(url("/api/auth/sign-in/email"), () => HttpResponse.json({ token: "session-token", user: { id: "user-1" } })),
  http.post(url("/api/auth/sign-up/email"), () => HttpResponse.json({ token: null, user: { id: "user-1" } })),
  http.post(url("/api/auth/sign-out"), () => HttpResponse.json({ success: true })),
  http.get(url("/api/auth/get-session"), () => HttpResponse.json(null)),
];
