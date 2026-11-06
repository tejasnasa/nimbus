/**
 * A local stand-in for an AI provider, used only by the end-to-end suite.
 *
 * The API is started with `AI_TEST_BASE_URL` pointing here, which its provider
 * code honours only when `NODE_ENV` is `test`. That lets a browser test add a
 * workspace key and exercise the save-time probes without ever calling a real
 * provider or spending a real key.
 *
 * Behaviour, keyed on the bearer token:
 *   - a token containing `rejected` is answered 401, like a wrong key;
 *   - a token containing `no-audio` has its text probe pass but its audio
 *     probes answered 403, so the "saved with warnings" path can be driven;
 *   - any other token is accepted for text, transcription and speech.
 *
 * Endpoints: `POST /responses`, `POST /audio/transcriptions`,
 * `POST /audio/speech`, plus `GET /health` for the readiness check.
 */
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import process from "node:process";

/** The port `playwright.config.ts` and the API's `AI_TEST_BASE_URL` both name. */
const PORT = 4010;

/** Reads and discards a request body so the socket can be reused. */
const drain = (req) =>
  new Promise((resolve) => {
    req.on("data", () => {});
    req.on("end", resolve);
  });

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true });
  }

  await drain(req);
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const path = (req.url ?? "").split("?")[0];

  if (token.includes("rejected")) {
    return send(res, 401, { error: { message: "Incorrect API key provided." } });
  }

  if (req.method === "POST" && path === "/responses") {
    return send(res, 200, {
      id: "resp_fake",
      object: "response",
      created_at: 0,
      status: "completed",
      model: "fake",
      output: [
        {
          type: "message",
          id: "msg_fake",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  }

  if (token.includes("no-audio") && path.startsWith("/audio/")) {
    return send(res, 403, { error: { message: "Audio is not enabled for this key." } });
  }

  if (req.method === "POST" && path === "/audio/transcriptions") {
    return send(res, 200, { text: "" });
  }

  if (req.method === "POST" && path === "/audio/speech") {
    return send(res, 200, Buffer.from([0, 0, 1, 0, 2, 0, 3, 0]), "application/octet-stream");
  }

  return send(res, 404, { error: { message: "Not found" } });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`fake provider listening on http://127.0.0.1:${PORT}\n`);
});
