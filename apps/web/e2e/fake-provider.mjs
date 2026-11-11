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
 * The image-to-diagram flow has two scripted answers, recognised by the shape
 * of the request rather than by the token: a routing call whose tool offers a
 * `fromImage` argument is answered with a `create_document` call that sets it,
 * and a streamed JSON-mode call is answered, after a short pause so the
 * generation overlay is observable, with a three-node diagram. Everything else
 * on `/responses` still gets the plain "ok".
 *
 * Meeting notes are recognised by their instructions ("write the notes for a
 * meeting"): a non-streamed JSON-mode call carrying them is answered with a
 * fixed, valid set of notes whose action items name the two seeded users, so a
 * browser test can assert on the decisions, owners and document that follow.
 *
 * The in-call assistant is driven by a token containing `agent`: its
 * transcription requests are answered with a fixed sentence, whatever audio was
 * sent, so a browser test can assert that a caption appears without a real
 * speech model. Every other token still gets the empty transcript the probes
 * expect.
 *
 * Endpoints: `POST /responses`, `POST /audio/transcriptions`,
 * `POST /audio/speech`, plus `GET /health` for the readiness check.
 */
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import process from "node:process";

/** The port `playwright.config.ts` and the API's `AI_TEST_BASE_URL` both name. */
const PORT = 4010;

/** Reads a request body in full and parses it as JSON when it is. */
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
  });

/** The diagram the streamed image-to-canvas call returns. */
const DIAGRAM = JSON.stringify({
  direction: "LR",
  nodes: [
    { id: "client", shape: "rectangle", label: "Client" },
    { id: "api", shape: "rectangle", label: "API" },
    { id: "db", shape: "ellipse", label: "Database" },
  ],
  edges: [
    { from: "client", to: "api" },
    { from: "api", to: "db" },
  ],
});

/** The notes the fake model writes for any meeting transcript it is sent. */
const MEETING_NOTES = JSON.stringify({
  title: "E2E launch sync",
  summary:
    "The team agreed to ship the launch on Friday and to write a rollback plan.",
  decisions: [{ text: "Ship the launch on Friday", sourceSeq: 1 }],
  actionItems: [
    {
      text: "Update the changelog",
      ownerName: "E2E Member",
      due: "2026-12-04",
      sourceSeq: 2,
    },
    { text: "Write the rollback plan", ownerName: "E2E Owner", sourceSeq: 4 },
  ],
  openQuestions: ["Who reviews the rollback plan?"],
  topics: ["launch", "rollback"],
});

/** What the fake speech model hears when the assistant sends it audio. */
const SCRIPTED_TRANSCRIPT = "Let us review the Nimbus launch plan together.";

/** How long the streamed diagram is held back, so the overlay can be seen. */
const STREAM_DELAY_MS = 1500;

/** Writes one server-sent event in the shape the OpenAI SDK parses. */
const sse = (res, event) => {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
};

const streamDiagram = async (res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  await new Promise((resolve) => setTimeout(resolve, STREAM_DELAY_MS));
  sse(res, {
    type: "response.output_text.delta",
    sequence_number: 1,
    item_id: "msg_fake",
    output_index: 0,
    content_index: 0,
    delta: DIAGRAM,
  });
  sse(res, {
    type: "response.completed",
    sequence_number: 2,
    response: {
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
          content: [{ type: "output_text", text: DIAGRAM, annotations: [] }],
        },
      ],
      usage: { input_tokens: 800, output_tokens: 90, total_tokens: 890 },
    },
  });
  res.end();
};

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "content-type": type });
  res.end(
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body),
  );
};

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true });
  }

  const body = await readBody(req);
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const path = (req.url ?? "").split("?")[0];

  if (token.includes("rejected")) {
    return send(res, 401, {
      error: { message: "Incorrect API key provided." },
    });
  }

  if (req.method === "POST" && path === "/responses") {
    const offersFromImage = (body?.tools ?? []).some(
      (tool) => tool?.parameters?.properties?.fromImage,
    );
    if (offersFromImage) {
      return send(res, 200, {
        id: "resp_fake",
        object: "response",
        created_at: 0,
        status: "completed",
        model: "fake",
        output: [
          {
            type: "function_call",
            id: "fc_fake",
            call_id: "call_fake",
            name: "create_document",
            status: "completed",
            arguments: JSON.stringify({
              type: "CANVAS",
              label: "Photo diagram",
              prompt: "Turn the attached image into a diagram",
              fromImage: true,
            }),
          },
        ],
        usage: { input_tokens: 300, output_tokens: 30, total_tokens: 330 },
      });
    }
    if (
      body?.stream !== true &&
      body?.text?.format?.type === "json_object" &&
      String(body?.instructions ?? "").includes("write the notes for a meeting")
    ) {
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
            content: [
              { type: "output_text", text: MEETING_NOTES, annotations: [] },
            ],
          },
        ],
        usage: { input_tokens: 400, output_tokens: 120, total_tokens: 520 },
      });
    }
    if (body?.stream === true && body?.text?.format?.type === "json_object") {
      return streamDiagram(res);
    }
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
    return send(res, 403, {
      error: { message: "Audio is not enabled for this key." },
    });
  }

  if (req.method === "POST" && path === "/audio/transcriptions") {
    return send(res, 200, {
      text: token.includes("agent") ? SCRIPTED_TRANSCRIPT : "",
    });
  }

  if (req.method === "POST" && path === "/audio/speech") {
    return send(
      res,
      200,
      Buffer.from([0, 0, 1, 0, 2, 0, 3, 0]),
      "application/octet-stream",
    );
  }

  return send(res, 404, { error: { message: "Not found" } });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`fake provider listening on http://127.0.0.1:${PORT}\n`);
});
