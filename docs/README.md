# Nimbus Documentation

These pages are the written tour of Nimbus: what each part of the system does, how it works, why it
was built that way, and what to do when it breaks. They assume you have never opened the repository
before. Terms are explained where they first appear, and the ones used everywhere are collected in
the [glossary](#glossary) at the end of this page.

If you only read one page, read [architecture.md](architecture.md). It gives the shape of the whole
system, two processes, one monorepo, and where every kind of state lives, and every other page
hangs off it.

## How to read this

Pick the row that matches what you are trying to do.

| If you want to…                                           | Start here                                       |
| --------------------------------------------------------- | ------------------------------------------------ |
| Understand what Nimbus is and how the pieces fit together | [architecture.md](architecture.md)               |
| Get it running on your machine                            | [getting-started.md](getting-started.md)         |
| Understand how two people can edit the same document      | [document-sync.md](document-sync.md)             |
| Follow a chat message, presence update or socket event    | [realtime.md](realtime.md)                       |
| Follow an AI-generated document from mention to editor    | [document-generation.md](document-generation.md) |
| Understand model choice, user keys and the free tier      | [ai.md](ai.md)                                   |
| Call the REST API or check who is allowed to do what      | [api.md](api.md)                                 |
| Change the database schema                                | [data.md](data.md)                               |
| Work on the Next.js application                           | [frontend.md](frontend.md)                       |
| Run, write or debug the test suites                       | [testing.md](testing.md)                         |
| Deploy, configure or operate a running instance           | [operations.md](operations.md)                   |
| Review the design decisions and their trade-offs          | the last section of any page                     |

## The documents

### Foundations

- **[architecture.md](architecture.md)**: the two-process model, the monorepo dependency graph, one
  request and one socket event traced end to end, where every kind of state lives, and why auth is
  the spine of every request path.

- **[getting-started.md](getting-started.md)**: from a fresh clone to both processes running.
  Prerequisites, every environment variable and what happens when one is wrong, the Turborepo env
  contract, code conventions and the failures that actually happen.

### Collaboration

- **[realtime.md](realtime.md)**: the Socket.IO layer. Handshake authentication, rooms, the typed
  event contract, chat, presence and typing, the Redis-backed state, and what changes when you run
  more than one replica.

- **[document-sync.md](document-sync.md)**: the two sync models side by side. Markdown documents are
  a Yjs CRDT, canvases are full-state last-write-wins, and this page explains why, how each is
  persisted and evicted, and the invariants worth protecting.

### AI

- **[document-generation.md](document-generation.md)**: the pipeline behind asking the assistant
  for a document, stage by stage. Entitlements, the atomic quota claim, streamed Markdown, the canvas
  JSON → validate → layout → Excalidraw path, and how failures and refusals are reported.

- **[ai.md](ai.md)**: the provider registry, how a model is chosen for each feature, encrypted
  credential storage, the probe that checks a key when it is saved, and the free-tier quota.

### Interfaces and data

- **[api.md](api.md)**: REST conventions, the response envelope, validation, authentication, the
  role model and the full endpoint reference.

- **[data.md](data.md)**: every Prisma model and enum, cascades and deletion order, the migration
  history, debounced persistence and the test database.

- **[frontend.md](frontend.md)**: the route map, the server/client component split, the route
  guard, the state model without a state library, the socket singleton, hooks, components and the
  Tailwind v4 token system.

### Running it

- **[testing.md](testing.md)**: every suite, from the API shards to the production smoke run, plus
  fixtures, coverage floors, CI and troubleshooting.

- **[operations.md](operations.md)**: the deployment topology, the Docker image, the CI/CD
  workflows, production configuration, the security model, observability and a runbook.

## Conventions in this documentation

- **Claims are tied to code.** Where a behaviour matters, the page names the module or function
  that implements it, so it can be checked rather than believed.
- **Trade-offs are written down.** Every page ends with the design decisions behind its subsystem,
  the alternatives that were considered, and the costs that were accepted.
- **Limitations are stated plainly.** Where something is process-local, approximate or known to fall
  short, the page says so instead of describing the intended behaviour.
- **Diagrams are Mermaid.** Flows and structures are Mermaid blocks, so GitHub and this site render
  them as real diagrams. Directory trees stay as plain text.
- **Configuration lives with the behaviour it controls.** An environment variable is documented on
  the page that explains what it does; [getting-started.md](getting-started.md) lists them all with a
  pointer to each.

## Glossary

| Term                   | Meaning in Nimbus                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace**          | A shared space with members, chat, documents and voice. URLs use its `slugId` (an auto-increment number); everything internal uses its `id` (a cuid).     |
| **Role**               | `OWNER > ADMIN > MEMBER`. There is exactly one owner, and that role can never be reassigned, demoted or removed.                                          |
| **Document**           | A tab in a workspace, either `MARKDOWN` (rich text) or `CANVAS` (an Excalidraw whiteboard). Each type syncs differently.                                  |
| **CRDT**               | Conflict-free replicated data type. Markdown documents are Yjs documents, so concurrent edits merge character by character instead of overwriting.        |
| **Last-write-wins**    | The canvas model: each update replaces the whole element array, and the most recent one is kept.                                                          |
| **Presence**           | Who is online in a workspace right now, kept in Redis rather than in process memory.                                                                      |
| **Nimbus (assistant)** | The AI member of every workspace. Mention `@nimbus` in chat to ask it something or have it create a document. It is a real user row, set by `BOT_USERID`. |
| **BYOK**               | Bring your own key. Users store their own provider API keys, encrypted at rest, and the assistant runs on their key instead of the operator's.            |
| **Free tier**          | The operator-funded allowance for users without a key of their own: a small number of generated documents, `AI_FREE_DOC_LIMIT` (5 by default).            |
| **Entitlement**        | The answer to "may this user generate this, and on whose key?", resolved before anything is promised in chat.                                             |
| **Envelope**           | The `ServerResponse` shape every REST endpoint returns: `{ success, message, responseObject, statusCode }`.                                               |
| **Strict env mode**    | Turborepo passes a task only the environment variables it declares, so a task can pass locally on your exported shell and fail in CI.                     |
| **Coverage floor**     | A fixed per-package minimum for coverage, checked after the tests run in CI. Floors move only by deliberate decision.                                     |
