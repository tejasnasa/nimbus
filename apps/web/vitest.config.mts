import { defineConfig } from "vitest/config";

/**
 * Web test configuration.
 *
 * @important This app must run a single React copy. npm used to hoist
 *            `react@18.3.1` / `react-dom@18.3.1` to the repo root (a stale
 *            resolution, not a real constraint — `@excalidraw/excalidraw@0.18`
 *            and `jotai` both accept React 19), which left `@testing-library/react`
 *            — itself hoisted to the root — rendering with react-dom 18 and
 *            failing every render with "Objects are not valid as a React child".
 *            The root now pins React 19.2.4, so everything resolves to one copy.
 *            If a second React major ever reappears at the root, that is the
 *            cause, and no amount of aliasing here can paper over it: Vitest
 *            hands `node_modules` to Node, so a hoisted dependency's own imports
 *            never pass through Vite's resolver.
 */
export default defineConfig({
  // @important The shared tsconfig pins `jsx: "preserve"`, which is right for
  // Next.js — it runs its own transform — but leaves Vitest handing raw JSX to
  // the import analyser, which rejects it. Vite 8 transforms with Oxc, so the
  // override has to be `oxc`; the older `esbuild` key is still accepted but
  // silently ignored. Without this, every test file containing JSX fails to
  // parse, and a single unparseable file empties its whole project.
  oxc: { jsx: "automatic" },

  test: {
    passWithNoTests: true,
    // `json-summary` is what scripts/check-coverage.mjs reads; the ratchet
    // cannot see a package that only prints to the terminal.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      exclude: ["e2e/**"],
    },
    // Vitest does not read `.env` files. Without this, every module that reads a
    // public URL at import time sees `undefined` — `lib/auth-client.ts` throws
    // before a single test runs. These mirror `tests/msw/handlers.ts`.
    env: {
      NEXT_PUBLIC_BACKEND_URL: "http://localhost:3001",
      NEXT_PUBLIC_FRONTEND_URL: "http://localhost:3000",
    },
    projects: [
      {
        // Pure configuration/logic tests that need no DOM.
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/lib/**/*.test.{ts,tsx}"],
        },
      },
      {
        // Hooks and components: both need a DOM (renderHook/render mount React).
        // `msw` intercepts fetch at the network layer, so hooks under test see
        // realistic HTTP without a live API.
        extends: true,
        test: {
          name: "happy-dom",
          environment: "happy-dom",
          setupFiles: ["./tests/setup.ts"],
          // @important A single-element brace such as `{tsx}` silently matches
          // nothing here, and a pattern matching nothing looks exactly like a
          // directory containing no tests. Keep these written out.
          include: [
            "tests/unit/hooks/**/*.test.{ts,tsx}",
            "tests/components/**/*.test.tsx",
            "components/**/__tests__/**/*.test.tsx",
            "hooks/**/__tests__/**/*.test.tsx",
            "providers/**/__tests__/**/*.test.tsx",
          ],
        },
      },
    ],
  },
});
