# Testing

Nimbus has four test suites across five workspaces: **API** (Vitest, against a real Postgres and
Redis), **web** (Vitest + MSW, in `node` and `happy-dom` environments), **packages** (Vitest, one
suite per shared package), and **end-to-end** (Playwright, two real servers and a browser). This
document covers what each one is for, how to run them, how they are configured, and the conventions
to follow when adding tests.

## Contents

- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Test suites](#test-suites)
- [Running tests](#running-tests)
- [API suite](#api-suite)
- [Web suite](#web-suite)
- [Package suites](#package-suites)
- [End-to-end suite](#end-to-end-suite)
- [Coverage](#coverage)
- [Continuous integration](#continuous-integration)
- [Known unfixed defects](#known-unfixed-defects)
- [Writing tests](#writing-tests)
- [Troubleshooting](#troubleshooting)

## Quick start

```bash
make test-infra     # start Postgres (5434) and Redis (6381) for the test stack
make test-schema    # apply migrations to the test database — first run, or after a migration
npm test            # every workspace's suite
```

The end-to-end suite boots two servers and a browser, so it is a separate target and takes minutes
rather than seconds: `make test-e2e`.

[Running tests](#running-tests) lists every target, along with how to run one workspace, one shard,
or one test.

## Prerequisites

### Docker

The API and end-to-end suites run against a real PostgreSQL and a real Redis. `docker-compose.test.yml`
at the repo root provides both:

```bash
docker compose -f docker-compose.test.yml up -d
docker compose -f docker-compose.test.yml down
```

Both services listen on ports offset from the development defaults — Postgres on **5434** instead of
5432, Redis on **6381** instead of 6379. The offset exists because the sibling Illume project's test
stack already occupies 5433/6380 on a developer machine, so the two can run at once. It has the
useful side effect that a test run cannot write to a development database.

**Postgres and Redis are never mocked.** A mocked database cannot report that a query is wrong, that
a constraint fires, or that a migration and a model disagree, and those are the failures this suite
exists to catch. The only faked dependency is outbound HTTP: `resend` on the API side, and the whole
API surface on the web side, where MSW intercepts `fetch`.

### Environment

The connection strings come from `.env.test` at the repo root, which is committed. **Vitest does not
read `.env` files**, so the API and `@nimbus/db` configs load it explicitly via `dotenv` in their own
`vitest.config.mts`; the web config sets the two `NEXT_PUBLIC_*` values it needs inline. In CI the same
values are repeated in each workflow's top-level `env:` block, and the service containers publish the
same two ports.

Both the API config and the Playwright config pin `REDIS_TLS=false`. The test Redis is plaintext, and
the transport is derived from the URL's host (see [Troubleshooting](#troubleshooting)) — a TLS
handshake against a plaintext server stalls without ever emitting an `error` event, so every
realtime feature would hang behind a suite that looks merely slow.

### Checking that infrastructure is up

```bash
make test-suite SUITE=smoke
```

The smoke shard checks that Postgres answers, that the Prisma schema is applied, that Redis answers,
that the app composes, and that the root route responds. When the stack is down it fails with the
command to start it rather than a connection traceback.

## Test suites

| Suite | Location | Runner | Docker | Tests | Duration |
|---|---|---|---|---|---|
| API | `apps/api/src/__tests__/` | Vitest | Yes | 348 passing, 2 expected failures | ~3.5 min |
| Web | `apps/web/tests/` | Vitest + MSW | No | 235 passing, 7 expected failures | ~1 min |
| `@nimbus/ui` | `packages/ui/__tests__/` | Vitest | No | 106 passing, 4 expected failures | ~2 s |
| `@nimbus/db` | `packages/database/__tests__/` | Vitest | Yes | 101 passing | ~9 s |
| `@nimbus/utils` | `packages/utils/__tests__/` | Vitest | No | 37 passing, 2 expected failures | ~1 s |
| End-to-end | `apps/web/e2e/` | Playwright | Yes | 22 passing (20 specs + 2 setup steps) | ~3 min |

Timings are from a serial local run and vary with machine load. The API suite is by far the largest
because it drives a real HTTP server and real Socket.IO clients against a real database; `vitest`
reports it as 72% test time.

A rough guide to which suite a change belongs in:

- A pure function — a formatter, a validator, a slug generator — is covered by a **unit test**, in
  the API's `unit` shard or in `packages/utils`.
- A route's status code, permission check, or persisted row is covered by an **API integration test**
  in `__tests__/integration/http/`.
- Realtime behaviour — delivery, rooms, membership re-checks, convergence — is covered by an **API
  socket test** in `__tests__/integration/socket/`.
- How a component renders, or a hook behaves on interaction, is covered by a **web component or hook
  test**.
- Routing, cookies, or anything that only breaks in a real browser is covered by an **end-to-end
  test**.

Covering the same change at more than one layer is normal. The layers complement each other rather
than replace each other.

## Running tests

### Make

From the repo root:

```bash
make help                # list every target
make test-infra-up       # start Postgres + Redis on the test ports
make test-infra-down     # stop them, keeping the data volume
make test-infra-reset    # stop them and delete the data volume
make test-schema         # apply migrations to the test database
make test                # every workspace, bypassing the turbo cache
make test-api            # the API suite only
make test-web            # the web suite only
make test-suite          # one API shard, e.g. `make test-suite SUITE=integration`
make test-coverage       # every suite with coverage
make test-coverage-check # coverage, then the ratchet
make test-e2e            # Playwright, against a real stack
make test-e2e-seed       # re-seed the E2E fixtures without running the suite
```

### Turbo

`npm test` and `npm run test:coverage` run turbo, which fans out to each workspace and resolves
`@nimbus/db`'s generated Prisma client first. Running a workspace directly is the narrower loop:

```bash
npm test -w apps/api              # the whole API suite
npm run test:watch -w apps/api    # watch mode
npm test -w apps/web              # the whole web suite
```

### One file or one test

```bash
cd apps/api
npx vitest run src/__tests__/unit/bot.test.ts        # one file
npx vitest run -t "prepends the sender's name"       # one test, by name
```

API shards are named after their directories — `smoke`, `unit`, `integration` and `security` — so
they can be selected either by path or by project name:

```bash
cd apps/api
npx vitest run src/__tests__/smoke      # by path
npx vitest run --project smoke          # by project name — 10 tests in 3 files
```

`make test-suite SUITE=smoke` wraps the path form.

```bash
cd apps/web
npx vitest run tests/components/LoginForm.test.tsx
npx vitest run --project node            # the split here is by environment
npx vitest run --project happy-dom
```

### Linting the tests

Test code is held to the same standard as application code in the projects that lint it. `npm run
lint` covers every workspace that declares a `lint` script; the API's runs without `--max-warnings 0`
(it carries standing warnings) while the web's and `packages/ui`'s treat a warning as a failure.

Type checking is unevenly scoped, which is worth knowing before trusting a green `check-types`.
`apps/web`'s `tsconfig` includes `**/*.ts` and `**/*.tsx`, so its unit tests and E2E specs are
checked — but `apps/api`'s `include` is `./src/**/*` with `src/__tests__` and `testhelpers` in
`exclude`, and `packages/ui`'s is `src` alone. Neither of those type-checks its own tests, so a type
error there is not caught by `check-types`; it surfaces when the suite runs, or not at all if the
line is unexecuted. The zod-typed fixtures and `@nimbus/*` imports in the API tests are the reason
this has not bitten yet.

## API suite

`apps/api/src/__tests__/`, run by Vitest. The directories **are** the shards: each one is a vitest
project, so the layout doubles as the test taxonomy.

```
src/__tests__/
├── smoke/            # is the world ready to be tested at all
├── unit/             # lib/ functions and one controller, dependencies faked
├── integration/
│   ├── contract.test.ts   # golden snapshot of routes + socket event names
│   ├── http/              # one module per router
│   ├── persistence/       # the debounced document save
│   └── socket/            # real Socket.IO server, real clients
└── security/         # the authorization matrix, as a suite of its own
```

`fileParallelism: false` because these suites truncate shared tables between tests and would
otherwise race each other; `testTimeout` is 20s and `hookTimeout` 30s, which the socket and
auth-heavy suites need.

### What each shard covers

**Smoke** (10 tests across 3 files) makes no claims about behaviour; it confirms the environment is
usable, so a broken stack surfaces in seconds instead of as a long list of confusing failures.
`infra` checks Postgres, the
applied schema (by table name), and Redis. `boot` checks that the Express app composes, that
`/` answers, that better-auth is mounted ahead of the app routers, and that an anonymous REST call
gets the `ServerResponse` envelope. `socket-unauth` checks that an unauthenticated handshake is
refused. `infra` deliberately fails with `Is the test stack up? Run: docker compose -f
docker-compose.test.yml up -d` appended to the real error.

**Unit** covers `lib/` in isolation with its dependencies faked: `bot` (history assembly, the
`create_document` decision, and the fallback contract), `canvasGeneration` and `markdownGeneration`
(what they send the model and what they make of its output, including malformed responses),
`email`, `env` (boot-time validation), `redis` (transport derivation), `presence`,
`turnCredentials`, `serverResponse`, `error.middleware`, `validate.middleware`, and
`workspace.controller`.

**Integration** runs the real app. `http/` drives it through supertest — one module per router, with
`auth.http.test.ts` covering the sign-up/verify/sign-in flow itself. `socket/` boots a real
Socket.IO server on an ephemeral port and connects real clients, with one module per handler
(`chat`, `document`, `canvas`, `voice`, `bot`) plus `yjs.convergence.test.ts` for the CRDT path and
`redis-adapter.test.ts` for multi-instance fan-out. `persistence/` covers the debounced save.

`contract.test.ts` is not about coverage but about **friction**: it holds the mounted REST route
table and the socket event names as explicit lists, so a route or event that is renamed, removed, or
unmounted fails a test and has to be changed consciously in a second place. Those lists *are* the
snapshot — updating them is the review checkpoint.

**Security** is a suite of its own rather than assertions spread through the others, so the posture
can be reviewed as a whole:

- `guards.security.test.ts` — the authorization matrix. Every protected route rejects anonymous
  callers (table-driven over the same route list, so a new route added without an entry is a visible
  omission), cross-workspace resource ids are denied to authenticated non-members, and socket events
  re-check membership rather than trusting a room.
- `rbac.security.test.ts` — the role invariants: promotion, membership removal, invite-code rotation,
  workspace deletion, document deletion.
- `transport.security.test.ts` — CORS behaviour, malformed JSON (400, not 500), oversized bodies,
  and the status carried by the error handler.

### Fixtures

`apps/api/testhelpers/`, addressed by the `@testhelpers` alias — test directories sit at varying
depths, so the harness is resolved by name rather than by counting `../`. `@nimbus/db` resolves to
`packages/database/src/index.ts` in this config, so the suite exercises the working tree rather than
a possibly-stale `dist` build.

| Helper | Provides |
|---|---|
| `testPrisma` | A Prisma client with its own pool on the test database. |
| `resetDatabase()` | Truncates every application table, restarts identity sequences, flushes Redis, and re-seeds the bot row. |
| `closeTestResources()` | Disconnects Prisma and quits the Redis client. Call it from `afterAll`. |
| `mintUser(app)` | Creates a verified user and signs it in **through the real endpoints**. |
| `as(app, user)` | Supertest helpers with the user's session cookie pre-attached. |
| `startTestServer()` | The app's own `createHttpServer()` bound to an ephemeral port. |
| `connectClient(url, headers)` | A real `socket.io-client` with reconnection disabled. |
| `waitForEvent(socket, event, ms)` | Resolves with the first payload for `event`, or rejects on timeout. |
| `createUser`, `createWorkspace`, `addMember`, `createDocument`, `createMessage` | Direct-to-database row builders. |

### Truncation rather than rollback

`resetDatabase()` gives each test a clean slate by truncating, not by wrapping the test in a
transaction that gets rolled back. Rollback is the tidier technique and it is unusable here:
Socket.IO's async hops own the connection, so a transaction begun by a fixture is not reliably the
one the handler runs on. Truncation is blunt but deterministic.

It also has to restore one row by hand. Truncation wipes the NimbusBot user that `createWorkspace`
inserts as an ADMIN member inside its own transaction, and `WorkspaceMember.userId` is a foreign key
to `user.id` — without the row, workspace creation over HTTP fails with an opaque `P2003`. So every
reset re-seeds the bot when `BOT_USERID` is set.

### Sessions are minted, never forged

`mintUser` drives the app's own `/api/auth/sign-up/email` → verify → `/api/auth/sign-in/email` flow
against the test database. The auth configuration under test is therefore the one that actually
runs, including the email-verification gate (`requireEmailVerification` blocks sign-in, so the helper
marks the row verified, standing in for following the emailed link).

The cookie it gets back carries `Domain=.tejasnasa.me; Secure` — the app pins those attributes
unconditionally (see [Known unfixed defects](#known-unfixed-defects)). No browser would store that
on localhost, and a naive cookie jar would drop it. The helper keeps only the `name=value` pairs and
discards the attributes, which the server accepts regardless.

### Mocking

| Dependency | How |
|---|---|
| Resend (email) | `vi.mock("resend")` in `testhelpers/setup.ts` — a per-file setup, because the SDK *resolves* with `{ data, error }` rather than throwing, so without it every sign-up would make a real call to resend.com with placeholder credentials and discard the failure. |
| Groq | `vi.mock("../../lib/groqClient")`, per test file. |
| OpenAI | `vi.mock("../../lib/openaiClient")`, per test file. |
| ioredis | `vi.mock("ioredis")` in `presence.test.ts`, where the fake stands in for the client. |
| Postgres, Redis | **Never mocked** anywhere in the suite — the smoke, integration and security shards reach the real instances, which is the point of requiring Docker. |

Socket.IO clients are genuinely `socket.io-client` instances rather than mocks: mocked sockets would
fake the exact transport and middleware semantics under test. One convention follows from that —
assert on events the *other* client receives, never on sender-side side effects, since polling for
your own echo is the main source of two-client flake.

## Web suite

`apps/web/tests/`, run by Vitest with two projects split by environment rather than by directory:

| Project | Environment | Include |
|---|---|---|
| `node` | `node` | `tests/unit/lib/**` |
| `happy-dom` | `happy-dom` | `tests/unit/hooks/**`, `tests/components/**`, `components/**/__tests__/**`, `hooks/**/__tests__/**`, `providers/**/__tests__/**` |

The DOM environment is noticeably slower and most of the suite does not need it. The split has one
consequence worth remembering: importing a component under the `node` project fails with
`document is not defined` rather than a clear message, so a new component test belongs on one of the
`happy-dom` include paths.

### What is covered

- `tests/unit/lib/socket.test.ts` — the typed client singleton: event names, connection lifecycle,
  and that listeners are removed.
- `tests/unit/hooks/` — every hook the app has: `useWorkspaceForm`, `useWorkspaceJoinForm`,
  `useWorkspaceDocumentForm`, `useUpdateWorkspaceSettingsForm`, `useLoginForm`, `useSignupForm`,
  `useForgotPasswordForm`, `useResetPasswordForm`, `useWorkspaceMembers`, `useWorkspaceDocuments`,
  `useWorkspacePermissions`, and `useVoiceChat`.
- `tests/components/` — the auth cards plus `FormSwitch`, `ViewWorkspaces`, `CreateWorkspaceCard`,
  `DocEditor`, `MarkdownEditor`, `Canvas`, `AiGenOverlay`, `UserNavbar`, `WorkspaceSettings`,
  `VoiceControls`, `VoiceOverlay`, and the `DocEditorRefContext` bridge.

The editors are where the tests lean on mocks, deliberately: `@excalidraw/excalidraw` and
`@milkdown/react` are both stubbed, because neither mounts meaningfully outside a browser and driving
a real editing session is not what these specs are for. What they assert instead is the contract each
component owns — that it mounts its editor tree without throwing, joins the document room on mount,
subscribes to that room's state channels, and leaves the room on unmount. `DocEditor` goes a step
further and stubs both editors it hosts, so the shell's own wiring is what is under test: the tab
strip, and the NimbusBot socket events driving the generating pseudo-tab and its overlay.

### Network mocking

MSW (`tests/msw/`) intercepts at the network layer, so the code under test makes an ordinary `fetch`
and does not know it is being faked. `handlers.ts` holds a **happy path for every endpoint the app
calls**, mirroring the API's `ServerResponse` envelope exactly — a suite that only ever saw the
success shape would not catch a client that ignores `success: false`. Individual tests override a
handler with `server.use(...)` to exercise a failure path, and the global `afterEach` resets them.

Unhandled requests are a **warning, not a failure** (`onUnhandledRequest: "warn"`). That is a
deliberate trade in this repo: it keeps a stray call visible without derailing a suite mid-file.
A request you expected to be handled and see warned about means a handler is missing.

### Setup pieces worth knowing about

`tests/setup.ts` registers the `jest-dom` matchers, starts MSW before a file and closes it after, and
— between every test — calls `cleanup()` and resets MSW's handlers, so an override registered with
`server.use(...)` in one test cannot leak into the next. The `cleanup()` call has to be manual
because Testing Library only self-registers when `afterEach` is a global, and this config
deliberately does not set `globals: true` — without it the DOM from one test stays mounted into the
next and a query can match an element a previous test rendered.

`tests/components/testUtils.ts` must be imported **first** in a component test. Importing it points
`NEXT_PUBLIC_BACKEND_URL` at the MSW origin, and `lib/auth-client.ts` reads that value at module-load
time — anything imported before it builds an auth client with an undefined base URL and throws.

It also exports two things that exist because of `happy-dom`'s gaps:

- `preflight` — a handler for `OPTIONS`. `happy-dom`'s `fetch` implements CORS, so every cross-origin
  write the app makes is preceded by a preflight that MSW has to answer, or the request fails.
- `stubAlert()` — `happy-dom` does not implement `window.alert`, so the workspace hooks'
  `alert(err.message)` error paths would throw a `TypeError` instead of surfacing the message. The
  stub returns a spy, so a test can assert on what the user would have seen.

### Two configuration traps

**JSX needs an explicit transform.** The shared `tsconfig` sets `jsx: "preserve"`, which is right for
Next.js (it runs its own transform) but leaves Vitest handing raw JSX to the import analyser, which
rejects it. The web config therefore sets `oxc: { jsx: "automatic" }`. Vite 8 transforms with Oxc, so
the older `esbuild` key is accepted but silently ignored — and without the working override, a single
unparseable file empties its whole project.

**There must be exactly one React copy.** npm previously hoisted `react@18` to the repo root, which
left `@testing-library/react` (itself hoisted) rendering with `react-dom` 18 and failing every render
with `Objects are not valid as a React child`. The root now pins React 19.2.4. If a second React
major ever reappears at the root, that is the cause, and no aliasing in this config can paper over
it: Vitest hands `node_modules` to Node, so a hoisted dependency's own imports never pass through
Vite's resolver.

## Package suites

| Package | Covers |
|---|---|
| `packages/utils` | `generateSlug`, `timeAgo`, and the package's own export surface. |
| `packages/ui` | The component library in `happy-dom`: `Button`, `AlertDialog`, `OptionsMenu`, `DocTabs`, `SettingTabs`, `ToggleGroup`, `Navbar`, `WorkspaceCard`, `VerifyEmailDialog`, `getAvatarForUser`, and the presentational primitives. |
| `packages/database` | The Prisma schema, its constraints, cascade behaviour, and the migration chain. |

`@nimbus/types` has no suite of its own. It is types, socket event contracts, and Zod validation
schemas, and it is exercised through the API and web suites.

### The database suite gets its own database

`packages/database` seeds rows and then asserts on them, so it cannot share a database with the API
suite — that one truncates every application table at arbitrary points in its run, and turbo starts
both workspaces at once, so a shared database let the API suite delete fixtures out from under a
migration test mid-run. Rather than a second server or a second connection string to keep in sync,
the *database name* is swapped in the committed URL: `nimbus_schema_test` on the same server, with
the same credentials.

Its `globalSetup` creates that database and applies migrations before any worker starts, which is
why the package is runnable standalone as well as under `turbo run test`. `prisma migrate deploy` is
used rather than creating tables by hand, because the suites assert on `prisma migrate status` and on
the `_prisma_migrations` ledger — the history has to be real. Both steps are idempotent, and a
`CREATE DATABASE` that loses a race to a concurrent run is treated as success.

`assertThrowawayTestDatabase()` refuses to proceed unless the URL points at port 5434. Both this
suite and the API's truncate tables, and global setup additionally issues `CREATE DATABASE`, so a
mistyped or exported `DATABASE_URL` is rejected before anything destructive runs.

## End-to-end suite

`apps/web/e2e/`, run by Playwright. It is the only layer that uses a real browser, and the only one
that can catch a broken server component, a cookie that does not survive a redirect, a route that
404s, or the realtime transport as a user experiences it.

### What it runs against

A real stack: migrated Postgres, real Redis, the actual Express API, and the actual Next.js app.
Nothing is stubbed, and no spec reaches a third-party service either — none of them mentions
`@nimbusbot`, so the AI pipeline is never triggered and a run makes no billed model call.
`playwright.config.ts` starts both servers itself via its `webServer` array and waits for each to
answer, so there is no "remember to start the servers first" step:

| Port | Service |
|---|---|
| 3001 | `apps/api`, booted with `DOTENV_CONFIG_PATH` pointed at `.env.test` |
| 3000 | `apps/web`, via `next dev` |

Two env details there are load-bearing. The API is given `DOTENV_CONFIG_PATH=.env.test` so the suite
can never reach a production database. And the web server is handed `NEXT_PUBLIC_BACKEND_URL`
explicitly, because **process env wins over `apps/web/.env`**, which points at the deployed API.

### Projects and identity

Two Playwright projects, chained: the `setup` project mints a storage state per seeded user, and
`chromium` holds the specs.

Identity comes from fixtures (`tests` extended in `e2e/fixtures.ts`), not from a project-level
`use.storageState`. That is deliberate: Playwright applies context options to every context it
creates, so a project-level storage state would silently authenticate the contexts specs create to
assert on signed-out behaviour — `/home` would render instead of redirecting. `fixtures.ts` instead
overrides `context` (making `page` the workspace OWNER) and adds a `memberPage` for the second
identity, which makes the identity explicit at the point of use.

`workers: 1` and `fullyParallel: false`, for the same reason as the API socket shards: document and
canvas state is per-process in memory, so parallel specs sharing a workspace would race each other.

### Seeding

`globalSetup` runs `apps/api/scripts/seed_e2e.ts` once, before any browser starts. The script lives in
`apps/api` because it needs that package's Prisma client, its auth instance (to hash passwords with
better-auth's own hasher), and its test fixtures. It truncates every application table, then creates
two verified users (OWNER and MEMBER), one workspace, and the CANVAS and MARKDOWN documents that
workspace creation normally seeds, and writes their ids to `e2e/.auth/e2e-state.json`.

Specs read ids from that file through the `E2EState` object exported by `fixtures.ts` rather than
hardcoding them, since `slugId` is an autoincrement int. Playwright loads every spec file to build
the test list *before* any project runs, so a module-scope read of that file fails on a clean
checkout while appearing to work locally, where the artifact survives from a previous run. The ids
are therefore read inside fixtures or `beforeEach`.

Seeded values are fixed: `e2e-owner@example.test`, `e2e-member@example.test`, the workspace
`e2e-workspace`, and the invite code `E2E-INVITE-CODE`.

### How a signed-in context is produced

`auth.setup.ts` signs in over the **HTTP API**, reads the raw `Set-Cookie` header, and re-injects the
same name/value pair scoped to `localhost`, rather than filling in the sign-in form.

This is a workaround for a real defect (see [Known unfixed defects](#known-unfixed-defects)): the API
pins `defaultCookieAttributes` to `domain: ".tejasnasa.me"` and `secure: true`, and a browser refuses
to store that cookie for `localhost`, so signing in through the UI against a local stack leaves the
context unauthenticated — the sign-in appears to succeed and every subsequent request is anonymous.
The domain check is client-side only, so the API accepts the re-scoped cookie unchanged.

The consequence is that **no spec can exercise signing in through the form**. `auth.spec.ts` covers
the rejection paths and the form's own behaviour, and every authenticated spec depends on the
re-scoping step. Fixing the cookie attributes would let this workaround be deleted.

### Specs

| Spec | Covers |
|---|---|
| `smoke.spec.ts` | An anonymous visitor is redirected away from `/home`; the seeded owner and the seeded member both reach the workspace; opening the room renders without throwing. |
| `auth.spec.ts` | Bad credentials, client-side email validation, switching between the sign-in and sign-up cards, the forgot-password card, and `/reset-password` with and without a token. |
| `workspace.spec.ts` | The dashboard's workspace list and both entry flows, the My Workspaces filter, creating a workspace and landing in its room with both seeded documents, and an unknown invite code producing a form error. |
| `documents.spec.ts` | Both documents present as tabs, selecting a tab swapping the mounted editor, and the member seeing the same document set as the owner. |
| `chat.spec.ts` | The owner's message reaching the member live, Enter sending and clearing the composer while Shift+Enter does not, and a whitespace-only message not being sent. |

### Artifacts

`trace: "on-first-retry"`, `screenshot: "only-on-failure"`, `video: "retain-on-failure"`, and
`retries: 2` in CI only. After a green run there is deliberately little to look at, which keeps the
CI upload small. To capture artifacts anyway, override on the command line, where flags take
precedence over the config:

```bash
cd apps/web
npx playwright test --config e2e/playwright.config.ts e2e/chat.spec.ts --trace=on
npm run test:e2e:ui      # interactive runner: timeline, DOM snapshots, watch mode
```

A trace tends to be more informative than a video when debugging: it shows which locator resolved to
what, the DOM at that moment, and the request that came back.

Both artifact directories resolve against the directory Playwright was invoked from — `apps/web`,
because the script runs as `npm run test:e2e -w apps/web` — rather than against `e2e/`, where the
config lives:

| Artifact | Location |
|---|---|
| HTML report | `apps/web/playwright-report/` |
| Traces, screenshots, videos | `apps/web/test-results/` |

An empty `test-results/` after a green run is the expected outcome, not a broken config: all three
artifact kinds record only on failure or retry. The report is opened with
`npx playwright show-report apps/web/playwright-report` from the repo root, or `npm run test:e2e:ui`
for the interactive runner. Both directories are covered by the root `.gitignore`.

## Coverage

Every package measures coverage and enforces a committed floor.

| Package | Floor file | statements | branches | functions | lines |
|---|---|---|---|---|---|
| `apps/api` | `apps/api/.coverage-floor` | 91 | 85 | 93 | 92 |
| `apps/web` | `apps/web/.coverage-floor` | 77 | 66 | 70 | 79 |
| `packages/ui` | `packages/ui/.coverage-floor` | 96 | 94 | 97 | 98 |
| `packages/utils` | `packages/utils/.coverage-floor` | 94 | 98 | 98 | 94 |
| `packages/database` | `packages/database/.coverage-floor` | 90 | 76 | 98 | 92 |

`scripts/check-coverage.mjs <package-dir> […]` compares the measured numbers against the floor and
exits non-zero on any drop. It is a **ratchet, not a target**: the floor is whatever the package last
achieved, so coverage can only go up unless someone edits the floor deliberately in review.

It reads `coverage/coverage-summary.json`, which is why every package's coverage config keeps the
`json-summary` reporter — a package that only printed to the terminal would look to the ratchet like
a package with no coverage at all. The API and web configs exclude their test directories from the
measurement.

```bash
npm run test:coverage      # every package
make test-coverage-check   # the same, then the ratchet
cd apps/api && npx vitest run --coverage   # per-file percentages, plus the `text` reporter's
                                           # "Uncovered Line #s" column
cd packages/utils && cat coverage/coverage-summary.json   # what the ratchet actually reads
```

**Add tests, or raise the floor in the same change that adds the coverage. Never lower one to make a
build pass.** The usual way a passing change trips the ratchet is by adding validation or fallback
branches — new `if` arms are new uncovered branches, and `branches` is usually the metric closest to
its floor.

## Continuous integration

`.github/workflows/ci.yml` defines four jobs, all on every PR and every push to `main`:

| Job | Runs |
|---|---|
| `Lint & typecheck` | `turbo run check-types --affected`, then `turbo run lint --affected` with `continue-on-error` |
| `API (smoke · unit · integration · security)` | Postgres + Redis service containers, `db:deploy`, `test:coverage --filter=api`, then the ratchet |
| `Web (unit · component)` | `test:coverage --filter=web`, then the ratchet |
| `Shared packages` | Postgres + Redis service containers, `db:deploy`, then `test:coverage` for utils, ui and db, then the ratchet |

Two things about it are worth knowing:

- **The lint step is non-blocking** (`continue-on-error: true`) because `apps/web` carries 10
  standing ESLint warnings while its script runs with `--max-warnings 0`. It stays visible in the log
  without gating every PR, and the API's own lint gate deliberately omits `--max-warnings 0` for the
  same reason. A green run therefore does not mean warning-free.
- **Coverage is checked as a separate step after the test step**, not inside it, so a ratchet failure
  reads as a coverage problem rather than a test problem.

`.github/workflows/e2e.yml` is deliberately *not* part of `ci.yml`: it boots two servers, two service
containers and a browser, which is minutes rather than seconds. It runs nightly at 03:23 UTC and on
`workflow_dispatch`, and uploads the Playwright report as an artifact. `deploy.yml` builds and pushes
the API image to GHCR and `docker compose up`s it on a droplet; the web app is deployed separately by
Vercel.

CI's Postgres and Redis are GitHub service containers published on the same offset ports (5434, 6381)
that `docker-compose.test.yml` uses locally, so a machine that can run the suite locally can run it
in CI with no second set of credentials.

### Turbo's environment contract

This is the thing that most often makes a suite pass locally and fail in CI, and it cost this repo
two red CI runs to find.

Turbo runs tasks in **strict env mode**: a task receives *only* the variables named in its own `env`
or `passThroughEnv`. Everything else is filtered out of the child process. A script can therefore
pass locally for no better reason than *you* having the variable exported, and fail in CI with no
error message of its own.

- `db:generate`, `db:migrate` and `db:deploy` each declare `passThroughEnv` including
  `DATABASE_URL`. Without it, `prisma migrate deploy` in CI reached no `DATABASE_URL` at all — the
  failure was masked locally by `packages/database/.env`, which CI does not have.
- `test` and `test:coverage` declare `passThroughEnv: ["DATABASE_URL", "REDIS_URL", "NODE_ENV"]` and
  `cache: false`, since they hit a real database.
- Both use `dependsOn: ["^db:generate", "db:generate"]`. The caret means *dependencies'* generate,
  which is what the API needs; the bare entry is what generates the client for the package under
  test. Drop the bare one and `@nimbus/db`'s own tests fail on a fresh checkout with `Cannot find
  module './generated/prisma/client'` — that client lives in
  `packages/database/src/generated/prisma` and is gitignored.

Adding a new variable that a task reads means adding it to that task's `passThroughEnv`, or the task
silently sees nothing.

## Known unfixed defects

Fifteen defects are recorded as **expected failures** — `it.fails(...)` instead of `it(...)`. Each
one asserts the behaviour that *should* exist, so the suite reads as a written record of the bug
rather than as a comment that can rot.

`it.fails` has two properties that make it the right instrument here:

1. It passes while the defect exists and **fails** when the defect is fixed (`Vitest: "expected to
   fail, but passed"`). Fixing a defect therefore cannot be done quietly — the marker has to be
   removed in the same change, which is the review checkpoint.
2. The test carries the assertion, so when the fix lands the desired behaviour is already covered.
   Nothing needs writing afterwards.

Current markers, by where they will be fixed:

| Location | Defect |
|---|---|
| `apps/api/src/lib/canvasGeneration.ts` | Two nodes sharing an id: one escapes the layout pass entirely instead of both being laid out. |
| `apps/api/src/lib/canvasGeneration.ts` | A `null` coordinate hint is treated as `y = 0` rather than as no hint. |
| `apps/web/components/FormSwitch.tsx` | The inactive auth cards stay in the accessibility tree, so a screen reader can reach fields the user cannot see. |
| `apps/web/components/FormSwitch.tsx` | Each card's Email label does not point at its own field, so clicking it focuses the wrong input. |
| `apps/web/components/UserNavbar.tsx` | A failed sign-out request leaves the user signed in rather than returning them to `/login`. |
| `apps/web/hooks/useResetPasswordForm.ts` | Navigates to `/login` after the form has unmounted. |
| `apps/web/hooks/useWorkspaceMembers.ts` | A member's own in-flight request is not kept marked as loading, so the row shows a stale state. |
| `apps/web/hooks/useWorkspacePermissions.ts` | The route is not refreshed after rotating the invite code, so the UI keeps showing the stale code. |
| `apps/web/hooks/useVoiceChat.ts` | The current user's updated display name is not reflected in the roster. |
| `packages/ui/src/utils/getAvatarForUser.ts` | Returns an unusable image URL for a named user. |
| `packages/ui/src/utils/getAvatarForUser.ts` | Returns an unusable image URL when no user id is supplied. |
| `packages/ui/src/components/Textarea.tsx` | Emits a literal `undefined` class when `className` is omitted. |
| `packages/ui/src/components/ToggleGroup.tsx` | The selection can point at an option that no longer exists after `options` changes. |
| `packages/utils/src/slugGenerator.ts` | Truncation that lands on a separator leaves a trailing hyphen. |
| `packages/utils/src/slugGenerator.ts` | `generateSlug` does not produce the output its own JSDoc example promises. |

Five more are **worked around rather than pinned** — either they cannot be expressed as an assertion
inside the suite, or they are configuration debt rather than behaviour:

- **Cookie attributes are hardcoded to production** (`apps/api/src/lib/auth.ts`): `Domain=.tejasnasa.me`
  and `Secure` are applied unconditionally, so local development cannot hold a session in a browser
  and the E2E suite has to sign in over the API and re-inject the cookie (see
  [the E2E section](#how-a-signed-in-context-is-produced)). Fixing it would delete that workaround and
  let a spec cover the sign-in form.
- **Workspace creation needs a `BOT_USERID` row that no migration creates**: the FK rollback takes
  the whole transaction with it, so a fresh environment cannot create a workspace. `resetDatabase()`
  re-seeds the row so the suite can proceed.
- **`packages/database` resolves through `dist`**: a bare `tsc --noEmit` inside `apps/api` on a fresh
  clone fails with errors that point at innocent application files. `turbo run check-types` is wired
  correctly and builds the dependency first, so this only bites someone running `tsc` by hand.
- **`npm run lint` in `apps/web` fails on an untouched checkout** — 10 standing warnings against
  `--max-warnings 0`. Two of them (`VoiceControls.tsx` computing an unused `speakingUsers`,
  `useVoiceChat.ts` computing an unused `iceServers`) look like intent mismatches rather than style.
- **`apps/api`'s lint runs without `--max-warnings 0`** and reports 29 warnings. Tightening it is the
  same job as clearing the ten above.

## Writing tests

### API test

1. Put it in the shard that matches what it claims: `unit/` for a `lib/` function with its
   dependencies faked, `integration/http/` for a route, `integration/socket/` for realtime behaviour,
   `security/` for an authorization property.
2. Arrange with `testhelpers` rather than through other endpoints — a test that exercises an
   endpoint should not depend on another endpoint to set itself up, or a failure in one masks the
   failure in the other.
3. `await resetDatabase()` in `beforeEach` for anything that touches the database, and
   `afterAll(closeTestResources)` once per file (not per describe — closing inside a describe tears
   down the shared Redis client for the describes that follow).
4. Assert on what the *other* client receives, never on your own echo.

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { as, closeTestResources, createWorkspace, mintUser, resetDatabase } from "@testhelpers";
import { createApp } from "../../app";

const app = createApp();
afterAll(closeTestResources);
beforeEach(resetDatabase);

describe("http: workspace", () => {
  it("lists only the workspaces the caller belongs to", async () => {
    const mine = await mintUser(app);
    const theirs = await mintUser(app);
    await createWorkspace(theirs.id, "Not mine");

    const res = await as(app, mine).get("/api/workspace");

    expect(res.status).toBe(200);
    expect(res.body.responseObject).toHaveLength(1);
  });
});
```

A new protected route belongs in **three** lists: `security/guards.security.test.ts` (the
authorization matrix), `integration/contract.test.ts` (the route snapshot), and
`routers/master.router.ts`. The table-driven tests exist so a forgotten entry is a visible gap.

### Web unit or component test

1. Pure logic goes in `tests/unit/lib/`, which the `node` project covers.
2. A hook or component goes in `tests/unit/hooks/` or `tests/components/`, which puts it in the
   `happy-dom` project. `components/**/__tests__/` works too.
3. **Import `testUtils` first** — see [Setup pieces](#setup-pieces-worth-knowing-about).
4. Register a `preflight` handler in `beforeEach` for any cross-origin write, and use `stubAlert()`
   where the code under test calls `alert`.
5. Override the happy-path handler with `server.use(fail(500, "…"))` to exercise an error path, and
   prefer `findBy*`/`waitFor` for anything that follows a request.

### End-to-end spec

1. Add `apps/web/e2e/<name>.spec.ts` in the `chromium` project.
2. Take `page` (OWNER) or `memberPage` (MEMBER) from the extended `test`, and read ids from the seed
   inside a fixture or `beforeEach`, never at module scope.
3. Prefer role-based locators (`getByRole("button", { name: "Create Workspace" })`) over CSS selectors
   or test ids. A role-based locator fails when the accessible name changes, which is usually a real
   regression; a CSS selector fails when a class name changes, which usually is not.
4. Add a new seeded fixture to `apps/api/scripts/seed_e2e.ts` rather than having a spec create its
   own data through the UI, unless driving the UI *is* the point of the spec.

### Conventions this suite follows

**Assert the specific thing.** A status code plus "a body came back" establishes only that something
was returned. Assert the row, the shape, or the value the endpoint is actually about.

**Make the negative case unable to pass vacuously.** A denial test that would also pass if the
request had failed for an unrelated reason should assert the precondition too. `resetDatabase()` runs
before each denial test for the same reason: a leaked membership must not be able to make a denial
look correct.

**Test names state the claim.** `"refuses to promote a member to ADMIN"` rather than
`"role update 2"`, so a CI failure is readable without opening the file.

**Prefer a table to a loop of near-identical tests.** `guards.security.test.ts` is table-driven over
the protected routes; adding a route without a row is then a visible omission.

**Treat a flaky test as a real problem.** A retry or a sleep added to make one pass tends to hide the
cause. In this repo the usual causes have been polling for a sender's own echo, a race with a
component's teardown, and a test that depended on a row another test left behind.

## Troubleshooting

**`Is the test stack up? Run: docker compose -f docker-compose.test.yml up -d`**
Docker is not running, or the containers are down. Start them with `make test-infra-up`.

**Tests hang with no error, and every realtime feature is dead**
The Redis transport is wrong. TLS is derived from the URL: `rediss://` always negotiates it, and a
`redis://` URL is decided by its host — loopback, a private range or a dot-free service name stays
plaintext, and anything addressed by an FQDN gets TLS. A TLS handshake against the *plaintext* test
container never completes and ioredis emits no `error` event, so the client silently never becomes
ready. Both the API config and the Playwright config set `REDIS_TLS=false`; if you added a new entry
point that opens a connection, it needs the same.

**`Cannot find module './generated/prisma/client'`**
The generated client is missing — it is gitignored and only exists after `prisma generate`. Run
`npx turbo run db:generate`, or let turbo do it: `test` and `test:coverage` both `dependsOn` the
generate task.

**A suite passes locally and fails in CI with no useful error**
Check `turbo.json`. Turbo runs in strict env mode, and a task only receives the variables named in
its own `env`/`passThroughEnv` — see [Turbo's environment contract](#turbos-environment-contract).

**`document is not defined` in a web test**
The test imports a component but is running in the `node` project. Move it onto one of the
`happy-dom` include paths.

**Every test file containing JSX fails to parse**
The `oxc: { jsx: "automatic" }` override has been lost or replaced with `esbuild`, which Vite 8
accepts but ignores. The shared `tsconfig` sets `jsx: "preserve"`, so the override is required.

**`Objects are not valid as a React child` in a web render test**
A second React major has appeared at the repo root. `npm ls react` should show one copy; a hoisted
`react@18` is the cause, and no aliasing in the vitest config can fix it (see
[Two configuration traps](#two-configuration-traps)).

**`window.alert is not a function` in a hook test**
`happy-dom` does not implement it. Use `stubAlert()` from `testUtils`.

**A request that should be mocked produced a warning**
MSW is configured with `onUnhandledRequest: "warn"`, so a missing handler shows as a warning rather
than a failure. Add the handler to `tests/msw/handlers.ts`.

**An E2E spec fails during setup with "is the seed still applied?"**
The seed did not run, or ran against a different database. `globalSetup` truncates the database named
by `DATABASE_URL` and re-creates both users; check that the API server was started with
`DOTENV_CONFIG_PATH` pointed at `.env.test`.

**A green E2E run produced no trace, video, or screenshots**
Expected: all three record only on failure or retry. Pass `--trace=on` to override.

**Coverage dropped below the floor**
Add tests for the new branches, or — where the drop genuinely follows from deleting code — lower the
floor file in the same commit and say why. Lowering it quietly to make a build pass defeats the
purpose of having it.
