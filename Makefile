# Nimbus developer entry points.
#
# The test stack mirrors .env.test: Postgres on 5434, Redis on 6381. Those ports
# are deliberately offset from the 5433/6380 used by the sibling Illume project,
# which may already be running on a developer machine.
#
# Run `make` (or `make help`) for the list of targets.

TEST_DATABASE_URL ?= postgresql://nimbus:nimbus@localhost:5434/nimbus_test

.PHONY: help test-infra-up test-infra-down test-infra-reset test-schema test \
        test-api test-web test-suite test-coverage test-coverage-check test-e2e \
        test-e2e-seed

help: ## List available targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

test-infra-up: ## Start the test Postgres + Redis containers
	docker compose -f docker-compose.test.yml up -d

test-infra-down: ## Stop the test containers (keeps the data volume)
	docker compose -f docker-compose.test.yml down

test-infra-reset: ## Stop the containers and delete the test data volume
	docker compose -f docker-compose.test.yml down -v

test-schema: ## Apply Prisma migrations to the test database
	DATABASE_URL="$(TEST_DATABASE_URL)" npx turbo run db:deploy --filter=@nimbus/db

test: ## Run every workspace's test suite (bypassing the turbo cache)
	npx turbo run test --force

test-api: ## Run only the API suite
	npx turbo run test --filter=api

test-web: ## Run only the web suite
	npx turbo run test --filter=web

test-suite: ## Run one API shard, e.g. `make test-suite SUITE=smoke`
	cd apps/api && npx vitest run src/__tests__/$(SUITE)

test-coverage: ## Run every suite with coverage
	npx turbo run test:coverage --force

test-coverage-check: test-coverage ## Fail if any package's coverage dropped below its floor
	node scripts/check-coverage.mjs apps/api apps/web packages/utils packages/ui packages/database

test-e2e: test-infra-up ## Run the Playwright suite (starts both servers itself)
	npm run test:e2e -w apps/web

test-e2e-seed: ## Re-seed the E2E fixtures without running the suite
	npm run seed:e2e -w apps/api
