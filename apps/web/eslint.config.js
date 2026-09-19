import { nextJsConfig } from "@nimbus/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    // Playwright specs and configuration. Two rules misfire on them:
    // `react-hooks/rules-of-hooks` reads a fixture's `use(...)` callback as a
    // React Hook call, and `turbo/no-undeclared-env-vars` expects env reads to
    // be declared on a turbo task — but the suite is invoked through npm, not
    // through turbo, so there is no task to declare them on.
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
