#!/usr/bin/env node
/**
 * Coverage ratchet.
 *
 * Compares each package's measured coverage against its `.coverage-floor` file
 * and exits non-zero if any metric has dropped. A ratchet, not a hard gate: the
 * floor is whatever the package last achieved, so coverage can only go up
 * unless someone edits the floor deliberately in review.
 *
 * Usage:
 *   node scripts/check-coverage.mjs apps/api apps/web
 *
 * Requires the package to have been run with the `json-summary` reporter, which
 * writes `coverage/coverage-summary.json`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const METRICS = ["statements", "branches", "functions", "lines"];

const packages = process.argv.slice(2);

if (packages.length === 0) {
  console.error("Usage: node scripts/check-coverage.mjs <package-dir> [...]");
  process.exit(2);
}

let failed = false;
let checked = 0;

for (const pkg of packages) {
  const floorPath = join(pkg, ".coverage-floor");
  const summaryPath = join(pkg, "coverage", "coverage-summary.json");

  if (!existsSync(floorPath)) {
    console.log(`· ${pkg}: no .coverage-floor, skipping`);
    continue;
  }

  if (!existsSync(summaryPath)) {
    console.error(`✗ ${pkg}: no coverage summary at ${summaryPath}`);
    console.error("  Run the package's tests with the json-summary reporter first.");
    failed = true;
    continue;
  }

  const floor = JSON.parse(readFileSync(floorPath, "utf8"));
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const totals = summary.total ?? {};

  checked += 1;
  const regressions = [];

  for (const metric of METRICS) {
    const required = floor[metric];
    if (typeof required !== "number") continue;

    const actual = totals[metric]?.pct;
    if (typeof actual !== "number") {
      regressions.push(`${metric}: missing from the summary (floor ${required}%)`);
      continue;
    }

    if (actual < required) {
      regressions.push(`${metric}: ${actual}% < floor ${required}%`);
    } else {
      console.log(`  ${metric}: ${actual}% (floor ${required}%)`);
    }
  }

  if (regressions.length > 0) {
    console.error(`✗ ${pkg}: coverage regressed`);
    for (const line of regressions) console.error(`    ${line}`);
    console.error(
      `    Either add tests, or raise the floor deliberately in ${floorPath}.`,
    );
    failed = true;
  } else {
    console.log(`✓ ${pkg}: coverage at or above floor`);
  }
}

if (checked === 0) {
  console.log("No packages with a coverage floor were checked.");
}

process.exit(failed ? 1 : 0);
