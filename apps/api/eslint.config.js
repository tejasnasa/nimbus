import { config } from "@nimbus/eslint-config/base";

/**
 * ESLint config for the Express + Socket.IO API server.
 *
 * The shared base config is the whole story for most files: there is no React
 * tree and no Next.js, and `dist/` is already ignored by the base. Rules are
 * left at their default severities (the shared config downgrades them to
 * warnings), so this gate reports without failing on the warnings the package
 * already carries.
 *
 * The one addition is a fence around `lib/ai/voiceEntitlements`, the only module
 * that returns a plaintext provider key. Only the meeting ticket redemption may
 * import it; anything that merely needs to know whether voice works imports
 * `lib/ai/voiceAvailability`. Test files are exempt so they can exercise it.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...config,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/lib/meeting/tickets.ts", "src/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["**/voiceEntitlements", "**/voiceEntitlements.js"],
              message:
                "voiceEntitlements returns a plaintext key. Only lib/meeting/tickets.ts may import it; use voiceAvailability to ask whether voice works.",
            },
          ],
        },
      ],
    },
  },
];
