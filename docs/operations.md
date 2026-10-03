# Operations

How Nimbus is built, shipped, monitored and secured. This page covers the deployment topology, the
Docker image, all four CI/CD workflows, the security boundaries, and what to do when something is
broken.

## Contents

- [Deployment topology](#deployment-topology)
- [The Docker image](#the-docker-image)
- [The production stack](#the-production-stack)
- [CI/CD](#cicd)
- [What gates a merge](#what-gates-a-merge)
- [Production configuration](#production-configuration)
- [Security model](#security-model)
- [Observability](#observability)
- [Runbook](#runbook)
- [Design decisions and trade-offs](#design-decisions-and-trade-offs)
- [Related documentation](#related-documentation)

## Deployment topology

```mermaid
graph TB
    B["Browser"]

    subgraph V["Vercel"]
        W["apps/web — Next.js<br/>nimbus.tejasnasa.me"]
    end

    subgraph D["DigitalOcean droplet"]
        A["api container<br/>ghcr.io/tejasnasa/nimbus-api<br/>host 8080 to container 3001"]
        C["coturn — host network<br/>3478, relay 49152-65535"]
    end

    PG[("PostgreSQL")]
    R[("Redis")]

    B --> W
    B -->|"NEXT_PUBLIC_BACKEND_URL — absolute, no proxy"| A
    A --> PG
    A --> R
    A -.->|"mints time-limited credentials"| C
    B -.->|"WebRTC media, peer to peer"| C
```

The dotted edges are the two that do not carry application traffic: the API only *mints* TURN
credentials, and the media itself never passes through the API at all.

The two halves deploy independently: the web app to Vercel, the API as a Docker image on a droplet
alongside Coturn. They share nothing at runtime except an origin and a session secret.

The browser talks to the API **directly** at its own subdomain — there is no Next.js rewrite or proxy
in between. One CORS boundary, configured once.

## The Docker image

`apps/api/Dockerfile` is a three-stage build on `node:20-alpine`, using Turborepo's pruner so the
image only contains what the API needs:

| Stage       | What it does                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------- |
| **pruner**  | `turbo prune api --docker` — emits a minimal `out/json` + `out/full` workspace subset             |
| **builder** | `npm ci` from the pruned lockfile, then `npx turbo build --filter=api`                            |
| **runner**  | Copies `dist`, package manifests, `node_modules`, and `packages`; `CMD ["node", "dist/index.js"]` |

The build passes a throwaway `DATABASE_URL` (`postgresql://dummy:dummy@localhost:5432/dummy`) because
Prisma's tooling requires the variable to be present at build time even though the image makes no
database connection until it runs.

The Dockerfile declares `EXPOSE 3001`, matching the port the application actually listens on. Note
that `EXPOSE` is documentation-only in Docker — it binds nothing. The published port is the compose
file's mapping, which exposes the container's 3001 as host **8080**.

## The production stack

`docker-compose.yml` is copied to the droplet and runs two services:

### `api`

- Image `ghcr.io/tejasnasa/nimbus-api:latest`
- `restart: always`
- Ports `8080:3001` — host 8080 to container 3001
- `env_file: .env` — the droplet's own env file, never in the repo
- `NODE_ENV: production`

### `coturn`

- Image `coturn/coturn:latest`, `network_mode: host`
- `--use-auth-secret --static-auth-secret=${TURN_SECRET}` — the shared-secret scheme the API mints
  credentials against
- `--realm=turn.tejasnasa.me`, `--external-ip=${EXTERNAL_IP}`, relay ports **49152–65535**
- `--no-tls --no-dtls` — TURN over UDP/TCP only
- An explicit **denied peer range** covering loopback, link-local, and all RFC1918 private ranges

That last item is the security-relevant one: without it, a TURN server will relay to _any_ address,
which makes it a usable pivot into the host's private network. Denying private ranges is what stops a
TURN allocation from being used to probe internal services.

## CI/CD

Four workflows. The shape that matters is which ones gate a merge and which run on a schedule:

```mermaid
flowchart LR
    PR["pull_request"] --> CI["ci.yml<br/>lint · typecheck<br/>api · web · packages"]
    PUSH["push to main"] --> CI

    CI -->|"workflow_run: success"| DEP["deploy.yml<br/>build → GHCR → droplet"]
    CI -->|"workflow_run: failure"| STOP["no deploy"]

    CRON1["cron 23 3 * * *<br/>03:23 UTC"] --> E2E["e2e.yml<br/>local Playwright"]
    CRON2["cron 41 4 * * *<br/>04:41 UTC"] --> SMOKE["prod-smoke.yml<br/>drives the deployed site"]
```

Two edges carry the design intent. `deploy.yml` hangs off **CI completing successfully**, not off
`push` — so a commit CI is still judging, or is about to fail, never reaches production. And the two
nightly suites are separate from `ci.yml` entirely, because they boot servers and browsers and cost
minutes rather than seconds.

Full workflow detail follows.

### `ci.yml` — the merge gate

Triggers: `pull_request` on all branches, and `push` to `main`. Concurrency cancels superseded runs.

| Job                  | Services             | What it runs                                                         |
| -------------------- | -------------------- | -------------------------------------------------------------------- |
| **Lint & typecheck** | —                    | `turbo run check-types --affected`, then `turbo run lint --affected` |
| **API tests**        | Postgres 16, Redis 7 | `db:deploy`, `test:coverage --filter=api`, coverage ratchet          |
| **Web tests**        | —                    | `test:coverage --filter=web`, coverage ratchet                       |
| **Shared packages**  | Postgres 16, Redis 7 | `db:deploy`, tests for `utils`, `ui`, `db`, coverage ratchet         |

Service containers publish the same ports as `docker-compose.test.yml` (Postgres **5434**, Redis
**6381**) and carry health checks, so the jobs wait for readiness rather than racing it.

Two deliberate properties:

- **The lint step is `continue-on-error: true`.** `apps/web` runs `eslint --max-warnings 0` and carries
  a small number of standing warnings, so lint fails on an untouched checkout. `apps/api` lints without
  that flag and passes. The step should become blocking once the web warnings are cleared — until then,
  **a green CI run can still mean lint warnings**, so read the job output rather than the badge.
- **Coverage is a separate step after the tests**, not part of the test command. It reads
  `coverage/coverage-summary.json`, which is why each package must keep the `json-summary` reporter —
  the ratchet cannot see a package that only prints to the terminal.

E2E is deliberately **not** here: it boots two servers, two services and a browser, so it is minutes
rather than seconds.

### `deploy.yml` — the deploy

Triggers on `workflow_run` of **CI** completing on `main`, plus a manual `workflow_dispatch` escape
hatch to re-deploy the current `main` without a new commit.

**It is deliberately not triggered by `push`.** Deploying on push would ship a commit CI is still
judging — including one it is about to fail. Gating on `workflow_run` means only a commit that passed
the full suite reaches production, and it checks out the exact `head_sha` CI validated rather than
whatever `main` points at by the time the job starts.

Steps: build the image with `docker/build-push-action`, push to GHCR tagged `:latest`, `scp` the
compose file to the droplet, then `ssh` in and run `docker compose pull && docker compose up -d &&
docker image prune -f`.

`cancel-in-progress: false` — a half-cancelled deploy is worse than a queued one.

### `e2e.yml` — nightly local E2E

Trigger: cron **`23 3 * * *`** (03:23 UTC) and `workflow_dispatch`. The off-the-hour start is
deliberate: everything scheduled at `:00` competes for runners.

Boots Postgres and Redis, builds the API, applies migrations, installs **Chromium only** (WebKit and
Firefox are omitted to avoid tripling the download), runs `test:e2e`, and uploads the Playwright report
with `if: always()` and 14-day retention. There is no separate seed step — the suite's `globalSetup`
seeds the database itself.

### `prod-smoke.yml` — nightly production smoke

Trigger: cron **`41 4 * * *`** (04:41 UTC, clear of the local E2E run) and `workflow_dispatch` with a
`skip_ai` input for avoiding a real model call.

This suite drives the **deployed site**: it signs in through the real form, creates a workspace, and
exercises document persistence, chat delivery, real-time sync, NimbusBot replies and RBAC.

Three properties are deliberate and should not be "fixed":

- **There is no `pull_request` trigger, and there never should be.** The suite writes to production.
- **`cancel-in-progress: false`** — cancelling mid-run abandons created resources. It is bounded by a
  timeout instead.
- **Only the HTML report is uploaded, not `test-results/`.** A Playwright trace records action
  parameters, which for a sign-in flow means the password. Uploading traces would publish credentials
  as a build artifact.

## What gates a merge

| Gate                             | On PR           | Nightly      |
| -------------------------------- | --------------- | ------------ |
| Type check                       | ✅ blocking     | —            |
| Lint                             | ⚠️ non-blocking | —            |
| API tests + coverage ratchet     | ✅ blocking     | —            |
| Web tests + coverage ratchet     | ✅ blocking     | —            |
| Package tests + coverage ratchet | ✅ blocking     | —            |
| Local E2E                        | ❌              | ✅ 03:23 UTC |
| Production smoke                 | ❌              | ✅ 04:41 UTC |

The coverage ratchet compares each package against a committed `.coverage-floor`. It is a **ratchet,
not a target**: the floor is whatever the package last achieved, so it only fails on a regression.

> **Never lower a floor to make a build pass.** Add tests, or raise the floor in the same change that
> adds the coverage. New validation and fallback branches are the usual way an otherwise-passing change
> breaks it.

## Production configuration

The API validates its environment at boot and refuses to start on a missing required variable, naming
every one. See [getting-started.md](getting-started.md#environment-configuration) for the required /
optional split, and `.env.example` for the annotated list.

Production-specific concerns:

- **`AUTH_COOKIE_DOMAIN` must be set on the droplet.** The web app and API are on different subdomains,
  so the session cookie needs a cross-subdomain scope or sign-in will not persist. The production smoke
  suite exercises exactly this path — it signs in through the real form rather than injecting a
  storage state.
- **The free tier is optional.** Leaving `AI_API_KEY` unset is a supported configuration: the app
  boots, BYOK works, and free-tier users get a clear refusal with an add-key call to action.
- **`AI_CREDENTIAL_ENCRYPTION_KEY` is required and has no fallback.** There is no "unencrypted BYOK"
  mode by design.
- **`EXTERNAL_IP` is read by the Coturn compose service, not by the application.** It appears in the
  app's env file because the same file feeds the compose stack.
- **Changing the encryption key requires `AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`.** Set the new key as
  current and the old one as previous, let existing rows decrypt via the fallback, then re-save the
  credentials and unset the previous value. Rotating without the previous key makes every stored
  credential undecryptable, which surfaces as "your stored credential could not be read".

## Security model

### Trust boundaries

| Boundary               | Enforced by                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| Browser → web app      | better-auth session cookie; `proxy.ts` is UX only                          |
| Browser → API (REST)   | `authCheck` on every router                                                |
| Browser → API (socket) | handshake authenticator, before `connection`                               |
| API → Postgres/Redis   | connection string; TLS derived for Redis                                   |
| API → AI providers     | per-request key (BYOK or operator), never inherited from `OPENAI_BASE_URL` |
| droplet → Coturn       | shared secret; private peer ranges denied                                  |

Two of these deserve emphasis because they are easy to misread:

- **`apps/web/proxy.ts` is not a security boundary.** It checks for the _presence_ of a cookie and
  never verifies it. Every API request and every socket handshake re-validates independently. The
  proxy exists so a signed-out user does not see a flash of the dashboard.
- **Clients are constructed with `apiKey` and `baseURL` set explicitly, never inherited.** The
  API's `clientFactory` documents this: inheriting from `OPENAI_BASE_URL` is a production hazard,
  because a stray environment variable would silently redirect every AI call to an attacker-controlled
  endpoint. The explicit construction is the mitigation.

### Session cookies

Cookie attributes are **derived**, not hardcoded, from `BETTER_AUTH_URL` + `AUTH_COOKIE_DOMAIN`:

- HTTPS → `sameSite: "lax"`, `secure: true`, plus cross-subdomain scope when configured.
- HTTP (local development) → `sameSite: "lax"` only, because a `Secure` cookie over HTTP is one the
  browser refuses to store — which presents as "login silently does nothing".

The resolved attributes are logged at boot. That log line is the only observable signal that the
derivation matched the deployment, so it is worth checking after any env change.

### Credential encryption

BYOK keys are sealed with AES-256-GCM, AAD-bound to `<userId>:<providerId>`, in a versioned envelope.
The full scheme — including its **stated limits** — is in
[ai.md](ai.md#credential-storage). The short version:

> What this buys is blast-radius reduction for a realistic incident — a leaked backup, a read-only
> SQL injection, a stray log line. It is **not** a vault. The process holds the master key in its
> environment, so anyone with the container env and the database can decrypt everything.

UI copy must not imply otherwise.

### Redis transport

TLS is derived from the connection string's **host**, not just its scheme: `rediss://` always uses TLS,
while a `redis://` URL is decided by whether the host is loopback, private, or a bare service name
(plaintext) versus an FQDN (TLS). The reason this matters is that the failure is silent — forcing TLS
at a plaintext server, or omitting it at a TLS-only managed host, leaves ioredis emitting no `error`
event while the client never becomes ready. A connect watchdog logs the case after 10 seconds.

### Uploads

Avatars use **signed direct uploads** to Cloudinary. The API hands the client a signature, the cloud
name, an API key, and a deterministic `public_id` — never the API secret. The client posts the file
straight to Cloudinary. The deterministic id means one asset per user, so replacing an avatar
overwrites rather than accumulating orphans, and the signature is time-boxed (the endpoint sets
`Cache-Control: no-store`).

### Contact-form abuse

The contact endpoint is public and sends email, which makes it a spam target. The defence is a hidden
`nimbus_hp` honeypot field: a non-empty value returns the **same success envelope** a real submission
gets, so a bot cannot tell it was filtered. Rejections are logged operator-side. Returning a distinct
error would let a spammer tune against the signal.

## Observability

### Health endpoint

`GET /api/health` is public and probes Postgres and Redis concurrently, returning:

```json
{
  "status": "ok",
  "checks": {
    "database": { "ok": true },
    "redis": { "ok": false, "error": "…" }
  }
}
```

**200** when both are healthy, **503** otherwise. The per-dependency detail is why the response is
built with the `ServerResponse` constructor rather than the `serviceUnavailable()` factory, which
hardcodes a null payload.

The timeout mechanism is worth knowing because it is not obvious: both clients use
`maxRetriesPerRequest: null`, so ioredis **queues commands indefinitely** during an outage. A
`Promise.allSettled` over those clients would hang forever during exactly the outage the endpoint
exists to report. Each probe is therefore raced against a rejecting 1500ms deadline, and Redis is
short-circuited when its status is not `ready`.

### Logging

- **`morgan("dev")`** for request logging.
- **Boot logs** for the resolved cookie attributes and the listen port.
- **A 10-second Redis connect watchdog** for the silent-TLS-failure case.
- **One `warn` per process** for the free-tier capability assumption, deliberately not per-request so
  it does not bury itself.
- **Generic 500s to clients**, with the real error logged server-side. The terminal error handler never
  serializes internals.

## Runbook

**The deployed site is up but realtime features are dead.**
Check the API logs for the Redis watchdog line. This is almost always TLS derivation against a managed
Redis — `redis://` against an FQDN host negotiates TLS, and against a host that speaks plaintext it
hangs silently. Override with `REDIS_TLS`.

**Sign-in works locally but not in production.**
Check `AUTH_COOKIE_DOMAIN`. Different subdomains need cross-subdomain cookies, and the boot log line
prints what was resolved.

**"Your stored credential could not be read."**
The envelope failed to decrypt: wrong master key, a rotation without `AI_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`,
or a tampered row. The user re-adds their key; operator-side, check whether a rotation happened.

**Deploys stopped happening.**
`deploy.yml` triggers on CI _completing successfully_. If CI is red or was cancelled, no deploy runs —
by design. Check the CI run for the commit rather than the deploy job.

**The nightly smoke suite is failing.**
It drives production, so a failure can mean either a real regression or drift in the seeded accounts'
credentials. Check the uploaded report; note that traces are off, so you get the report but not a
trace.

**Coverage ratchet failed on a change that only added branches.**
Expected — that is what the ratchet is for. Add tests for the new branches rather than lowering the
floor.

**`prisma migrate deploy` fails in CI with no `DATABASE_URL`.**
Turbo's strict env filtering. Add the variable to `db:deploy`'s `passThroughEnv` in `turbo.json`.

## Design decisions and trade-offs

### Why deploy on CI success rather than on push?

Because the two are not the same event, and the gap is where broken code ships. A `push` trigger
deploys the commit immediately — including a commit CI is still testing and may be about to fail.
Gating on `workflow_run` means only a commit that passed every suite reaches production, and checking
out `head_sha` means you deploy the commit that was validated rather than whatever `main` points at by
the time the job runs.

The cost is latency: the deploy waits for CI. That is the right trade for a production environment.

### Why is E2E nightly instead of per-PR?

Because it costs minutes, not seconds — two servers, two services, a browser, and a seeded database.
Running it on every PR would make the feedback loop slow enough that people would work around it. The
nightly cadence catches integration regressions within a day, and the production smoke suite separately
catches deployment-specific problems. The alternative — a fast, flaky E2E suite people learn to ignore —
is worse than a slow, reliable one they trust.

### Why does the production smoke suite never run on a pull request?

Because it writes to production. A PR could otherwise cause arbitrary workspace creation and message
traffic in the live environment, on every push, including from a fork. `workflow_dispatch` gives an
explicit manual path when someone needs to verify a deploy immediately.

### Why no traces in the production smoke suite?

Because a Playwright trace records `fill` values, and the first thing this suite fills is a sign-in
form — so the trace would contain a working production password, uploaded as a build artifact retained
for 14 days. The HTML report gives enough to diagnose a failure without publishing credentials.

### Why deny private peer ranges in Coturn?

Because a TURN server relays to whatever address a client asks for. Without the deny list, a TURN
allocation can be used to reach the droplet's own private network — a pivot into internal services
from a public, unauthenticated-by-design relay. The deny ranges cover loopback, link-local and RFC1918.

### Why is the health check a race rather than a client timeout?

Because the clients are configured to queue rather than fail. With `maxRetriesPerRequest: null`, a
Redis command issued during an outage never rejects — it waits for a connection that may never come.
A health check built on `Promise.allSettled` alone would report "still checking" forever during the
one scenario it exists to detect. Racing an independent deadline is what converts a hang into a
reportable failure.

### Why keep the lint step non-blocking?

A pragmatic stopgap, not a principle. `apps/web` runs `eslint --max-warnings 0` and carries standing
warnings, so a blocking lint step would fail every PR including ones that touched nothing related. The
honest framing: **the lint gate is currently advisory.** The fix is to clear the warnings and remove
`continue-on-error`, at which point a green run means what it appears to mean.

## Related documentation

- [getting-started.md](getting-started.md) — environment variables and local setup.
- [ai.md](ai.md#credential-storage) — the encryption scheme referenced throughout the security model.
- [api.md](api.md) — the health endpoint and the `/api` conventions.
- [testing.md](testing.md) — the suites these workflows run, and the coverage ratchet.
- [architecture.md](architecture.md) — the two-process model this deploys.
