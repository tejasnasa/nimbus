# Nimbus developer entry points.
#
# Wraps every command the repo needs — setup, development, quality gates,
# Prisma, the test suites, and the operational scripts — so that a contributor
# does not have to remember which workspace owns which task.
#
# The test stack mirrors .env.test: Postgres on 5434, Redis on 6381. Those ports
# are deliberately offset from the 5433/6380 used by the sibling Illume project,
# which may already be running on a developer machine.
#
# Run `make` (or `make help`) for the list of targets.
#
# Notes that are easy to get wrong:
#   - Prisma tasks live in `packages/database`, not the root. There is no
#     `npm run db:push`; use `make db-migrate` to create and apply a migration.
#   - `check-types` and `dev` both depend on a generated Prisma client, and
#     `@nimbus/db` resolves through `dist`, so the first run also builds it.
#   - `make lint` reports warnings without failing on them: apps/api has a
#     standing warning count and its lint script deliberately omits
#     `--max-warnings 0`. apps/web and packages/ui do enforce zero.

TEST_DATABASE_URL ?= postgresql://nimbus:nimbus@localhost:5434/nimbus_test

# Defaults for the parameterised targets.
W    ?= apps/api
FILE ?=
SUITE ?=
ARGS ?=

.PHONY: help install \
        dev dev-api dev-web build build-api build-web start-web \
        check-types lint format format-check ci \
        db-generate db-migrate db-deploy \
        test-infra-up test-infra-down test-infra-reset test-schema \
        test test-api test-web test-packages test-suite test-file test-watch \
        test-coverage test-coverage-check \
        test-e2e test-e2e-ui test-e2e-seed test-e2e-prod \
        seed-smoke-users seed-smoke-users-apply probe-ai \
        prod-up prod-down prod-logs \
        clean

help: ## List available targets
	@grep -hE '^(##@|[a-zA-Z0-9_-]+:.*?## )' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} \
		       /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next} \
		       {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

##@ Setup

install: ## Install every workspace's dependencies from the root
	npm install

##@ Development

dev: ## Run the API and the web app together (API :3001, web :3000)
	npm run dev

dev-api: ## Run only the API with nodemon + tsx watch
	npm run dev -w apps/api

dev-web: ## Run only the web app (next dev --port 3000)
	npm run dev -w apps/web

build: ## Build every workspace
	npm run build

start-web: ## Serve the built web app (run `make build-web` first)
	npm run start -w apps/web

build-api: ## Build only the API
	npx turbo run build --filter=api

build-web: ## Build only the web app
	npx turbo run build --filter=web

##@ Quality

check-types: ## Type-check every workspace (builds @nimbus/db on a cold cache)
	npm run check-types

lint: ## Lint every workspace (apps/api warnings are non-blocking)
	npm run lint

format: ## Rewrite formatting with Prettier
	npm run format

format-check: ## Check formatting without writing (what CI would reject)
	npx prettier --check "**/*.{ts,tsx,md}"

ci: check-types lint test ## Run the local equivalent of the CI gate

##@ Database

db-generate: ## Generate the Prisma client (needed before the first typecheck)
	npx turbo run db:generate

db-migrate: ## Create and apply a migration against your dev database
	npx turbo run db:migrate

db-deploy: ## Apply existing migrations (production / CI path)
	npx turbo run db:deploy

##@ Test infrastructure

test-infra-up: ## Start the test Postgres + Redis containers
	docker compose -f docker-compose.test.yml up -d

test-infra-down: ## Stop the test containers (keeps the data volume)
	docker compose -f docker-compose.test.yml down

test-infra-reset: ## Stop the containers and delete the test data volume
	docker compose -f docker-compose.test.yml down -v

test-schema: ## Apply Prisma migrations to the test database
	DATABASE_URL="$(TEST_DATABASE_URL)" npx turbo run db:deploy --filter=@nimbus/db

##@ Test suites

test: ## Run every workspace's test suite (bypassing the turbo cache)
	npx turbo run test --force

test-api: ## Run only the API suite
	npx turbo run test --filter=api

test-web: ## Run only the web suite
	npx turbo run test --filter=web

test-packages: ## Run only the shared packages' suites
	npx turbo run test --filter="./packages/*"

test-suite: ## Run one API shard, e.g. `make test-suite SUITE=smoke`
	cd apps/api && npx vitest run src/__tests__/$(SUITE)

test-file: ## Run one test file, e.g. `make test-file FILE=src/__tests__/smoke/boot.test.ts`
	cd $(W) && npx vitest run $(FILE)

test-watch: ## Watch one workspace's tests, e.g. `make test-watch W=apps/web`
	npm run test:watch -w $(W)

test-coverage: ## Run every suite with coverage
	npx turbo run test:coverage --force

test-coverage-check: test-coverage ## Fail if any package's coverage dropped below its floor
	node scripts/check-coverage.mjs apps/api apps/web packages/utils packages/ui packages/database

##@ End-to-end

test-e2e: test-infra-up ## Run the Playwright suite (starts both servers itself)
	npm run test:e2e -w apps/web

test-e2e-ui: test-infra-up ## Run the Playwright suite in interactive UI mode
	npm run test:e2e:ui -w apps/web

test-e2e-seed: test-infra-up ## Re-seed the E2E fixtures without running the suite
	npm run seed:e2e -w apps/api

test-e2e-prod: ## Run the production smoke suite (writes to the deployed stack)
	npm run test:e2e:prod -w apps/web

##@ Operations

seed-smoke-users: ## Report what the smoke-user seed would do (read-only)
	cd apps/api && npx tsx scripts/seed_smoke_users.ts

seed-smoke-users-apply: ## Create or repair the two smoke-suite accounts
	cd apps/api && SMOKE_SEED_CONFIRM=yes npx tsx scripts/seed_smoke_users.ts

probe-ai: ## Probe the live AI providers, e.g. `make probe-ai ARGS="--provider groq"`
	cd apps/api && npx tsx scripts/probe_ai_providers.ts $(ARGS)

prod-up: ## Start the production compose stack (api + coturn; needs .env)
	docker compose up -d

prod-down: ## Stop the production compose stack
	docker compose down

prod-logs: ## Follow the production compose logs
	docker compose logs -f

##@ Housekeeping

clean: ## Remove build output and turbo caches (keeps node_modules, keeps the Prisma client)
	rm -rf .turbo apps/*/.turbo packages/*/.turbo
	rm -rf apps/web/.next apps/api/dist packages/*/dist
