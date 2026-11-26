# Nimbus documentation

Nimbus is a real-time collaborative workspace: chat, live markdown documents and whiteboards, voice calls with an AI meeting assistant that takes notes and answers questions, and a chat assistant that writes documents and diagrams. This documentation explains how it is built and how to work on it, from first setup to production operations. Every page states its design trade-offs and limits at the end, and every claim was checked against the code.

## Reading guide

| If you want to… | Start with |
| --- | --- |
| Understand the system in ten minutes | [Architecture overview](architecture/overview.md) |
| Run it locally | [Local setup](getting-started/local-setup.md), then [The monorepo](getting-started/monorepo.md) |
| Understand how live editing works | [Realtime overview](realtime/overview.md) |
| See how the AI features are built | [Nimbus, the chat assistant](ai/nimbusbot.md) and [The assistant and its tools](meetings/assistant-and-tools.md) |
| Make a change | The [how-to guides](#how-to-guides) |
| Look up an endpoint, event, table or variable | The [reference](#reference) |
| Deploy or debug production | [Deployment and CI/CD](operations/deployment.md) and the [Runbook](operations/runbook.md) |

### Two suggested paths

**New developer:** [Local setup](getting-started/local-setup.md) → [The monorepo](getting-started/monorepo.md) → [Architecture overview](architecture/overview.md) → [Authentication](architecture/auth.md) → [Realtime overview](realtime/overview.md) → [Testing overview](testing/overview.md) → the guide for your first change.

**Reviewer skimming the engineering:** [Architecture overview](architecture/overview.md) → [Realtime overview](realtime/overview.md) → [Markdown sync](realtime/markdown-sync.md) → [The voice agent](meetings/voice-agent.md) → [The assistant and its tools](meetings/assistant-and-tools.md) → [Document generation](ai/document-generation.md) → [Security and RBAC](architecture/security.md). Each page's final section is a quick read of the decisions and their costs.

## All pages

### Getting started

| Page | What it covers |
| --- | --- |
| [Local setup](getting-started/local-setup.md) | Prerequisites, env files, test containers, running the apps, troubleshooting |
| [The monorepo](getting-started/monorepo.md) | Workspaces, Turborepo tasks and env contract, lint budgets, code conventions |

### Architecture

| Page | What it covers |
| --- | --- |
| [Architecture overview](architecture/overview.md) | The three processes, request paths, the main subsystems |
| [Authentication](architecture/auth.md) | better-auth, sessions and cookies, REST and socket guards, email flows |
| [Security and RBAC](architecture/security.md) | Roles and their invariants, workspace isolation, secrets, rate limits |

### Realtime

| Page | What it covers |
| --- | --- |
| [Realtime overview](realtime/overview.md) | Why there are three sync models, rooms, the Redis adapter, scaling limits |
| [Markdown sync](realtime/markdown-sync.md) | Yjs CRDT over Socket.IO, awareness, persistence and seeding |
| [Canvas sync](realtime/canvas-sync.md) | Last-write-wins whiteboards, the empty-array guard, pointers |
| [Presence and chat](realtime/presence-and-chat.md) | Redis presence, messages, typing, images |

### Meetings and voice

| Page | What it covers |
| --- | --- |
| [Voice calls and LiveKit](meetings/voice-and-livekit.md) | Tokens, rooms, webhooks, the call roster |
| [The voice agent](meetings/voice-agent.md) | `apps/agent`: dispatch, tickets, listening, captions, speaking, barge-in |
| [Transcripts and notes](meetings/transcripts-and-notes.md) | Segments, translation, the rolling summary, meeting notes and recovery |
| [The assistant and its tools](meetings/assistant-and-tools.md) | Answering in a call, the tool registry, workspace confinement |

### AI

| Page | What it covers |
| --- | --- |
| [Nimbus, the chat assistant](ai/nimbusbot.md) | Mentions, routing, history, replies and tool use in chat |
| [Document generation](ai/document-generation.md) | Markdown and diagram generation, the layout pipeline, image-to-canvas |
| [AI providers and bring-your-own-key](ai/providers-and-byok.md) | The provider registry, encrypted keys, model selection |
| [AI entitlements, quotas and the free tier](ai/quotas-and-free-tier.md) | Who pays for a call, free allowances, spend caps, the call log |
| [Memory and search](ai/memory-and-search.md) | Full-text search, decisions and recall across meetings |

### Frontend

| Page | What it covers |
| --- | --- |
| [Frontend overview](frontend/overview.md) | Routes, providers, the socket singleton, editors, the docs site |

### Testing

| Page | What it covers |
| --- | --- |
| [Testing overview](testing/overview.md) | Suites, shards, real Postgres and Redis, coverage floors, Turbo's env contract |
| [End-to-end and production smoke tests](testing/end-to-end.md) | The two Playwright suites and how they are kept apart |

### Operations

| Page | What it covers |
| --- | --- |
| [Deployment and CI/CD](operations/deployment.md) | Where each app runs, the five workflows, the image, migrations |
| [Runbook](operations/runbook.md) | Health checks, symptoms and fixes, secret rotation, scaling limits |

### How-to guides

| Page | What it covers |
| --- | --- |
| [Add a REST endpoint](guides/add-an-endpoint.md) | Schema, controller, router, mounting, client call, tests |
| [Add a socket event](guides/add-a-socket-event.md) | The contract, per-event membership checks, listeners, tests |
| [Add an assistant tool](guides/add-an-assistant-tool.md) | A registry entry with strict schemas, confinement, tests |
| [Change the database schema](guides/change-the-schema.md) | Migrations, hand-written SQL, rollout order |

### Reference

| Page | What it covers |
| --- | --- |
| [REST API reference](reference/rest-api.md) | Every endpoint, its guard and its envelope |
| [Socket events reference](reference/socket-events.md) | Every event in both directions, with payloads |
| [Data model reference](reference/data-model.md) | Every table, its relations, and the migration history |
| [Environment variables](reference/environment.md) | Every variable for the API, web app and agent |

## How these pages are organised

The set follows the [Diátaxis](https://diataxis.fr/) split: **getting started** pages are tutorials, **guides** are recipes for one task, **reference** pages are lookup tables, and the subsystem sections explain how and why things work. Each page opens with a one-paragraph summary, uses Mermaid diagrams for flows and structure, links straight to the source files it describes, and ends with **Design trade-offs and limits** and **Related documentation**. The same files are rendered at `/docs` in the web app, with section navigation.

## Glossary

| Term | Meaning |
| --- | --- |
| **Agent** | The `apps/agent` worker that joins a call to transcribe and speak for Nimbus; runs on LiveKit Cloud. See [The voice agent](meetings/voice-agent.md). |
| **Agent session** | The short-lived credential the agent gets for one meeting by redeeming a ticket; sent as the `x-meeting-session` header on its calls to the API. |
| **Awareness** | Yjs's side channel for ephemeral per-user state such as cursors and selections; relayed, never persisted. |
| **Barge-in** | Interrupting the assistant by talking over it; the agent stops speaking and cancels the answer. |
| **BYOK** | Bring your own key: a workspace stores its own AI provider key, encrypted with AES-256-GCM, and is billed by the provider directly. |
| **CRDT** | Conflict-free replicated data type: a structure that merges concurrent edits deterministically without a central lock. Markdown documents use one (Yjs). |
| **Dispatch** | Asking LiveKit to start the agent in a specific room. Nimbus uses explicit dispatch, so the agent never joins a call on its own. |
| **ELK** | The Eclipse Layout Kernel (`elkjs`), which positions generated diagram nodes before they are turned into Excalidraw elements. |
| **Envelope** | See `ServerResponse`. |
| **Free tier** | Nimbus's own AI key, used when a workspace has none, within per-user allowances (`AI_FREE_DOC_LIMIT`, free voice minutes). |
| **LiveKit** | The WebRTC media server (LiveKit Cloud in production) that carries call audio; Nimbus's API only signs tokens and receives webhooks. |
| **LWW** | Last write wins: the canvas model, where each update replaces the whole element array. |
| **Nimbus / NimbusBot** | The assistant. "NimbusBot" is its user row (`BOT_USERID`), which owns its chat messages and is a workspace ADMIN; people address it as "Nimbus". |
| **Rolling summary** | A short, continuously updated summary of a live meeting, given to the assistant so it knows what was said before the recent transcript window. |
| **Room** | A Socket.IO room (a workspace, document or canvas) that scopes broadcasts, or a LiveKit room for a call. |
| **Segment** | One transcribed utterance from one speaker, stored as a `TranscriptSegment` and shown as a caption. |
| **`ServerResponse`** | The `{ success, message, responseObject, statusCode }` envelope every REST endpoint returns. |
| **`slugId`** | A workspace's autoincrement integer, used in URLs; internal identity is the cuid `id`. |
| **STT / TTS** | Speech-to-text (transcription) and text-to-speech (the assistant's voice). |
| **Ticket** | A single-use token the API mints when it dispatches the agent; the agent redeems it once for an agent session. |
| **`tsvector`** | Postgres's full-text search type. Documents and transcript segments carry generated `tsvector` columns with GIN indexes. |
| **VAD** | Voice activity detection: the Silero model the agent uses to find where each person's speech starts and stops. |
| **Yjs** | The CRDT library behind markdown documents; the server keeps one `Y.Doc` per open document in memory. |

## Design trade-offs and limits

- **Docs live next to the code** and are checked by the web suite (every page needs a summary and a trade-offs section, and every link must resolve), but nothing checks that prose still matches behaviour; a page can go stale while its links stay valid.
- **Pages describe `main`**, not a released version. There is no versioned documentation.
