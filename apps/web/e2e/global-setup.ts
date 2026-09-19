import { execSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Seeds the database once, before any browser starts.
 *
 * The seed script lives in `apps/api` because it needs that package's Prisma
 * client, its auth instance (for password hashing), and its test fixtures.
 */
export default async function globalSetup() {
  const repoRoot = resolve(import.meta.dirname, "../../..");

  execSync("npx tsx scripts/seed_e2e.ts", {
    cwd: resolve(repoRoot, "apps/api"),
    stdio: "inherit",
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: resolve(repoRoot, ".env.test"),
      REDIS_TLS: "false",
    },
  });
}
