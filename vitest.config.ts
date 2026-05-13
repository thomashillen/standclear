import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` is a Next.js bundler hint with no real package
      // on disk — see `vitest.server-only-stub.ts`.
      "server-only": path.resolve(__dirname, "vitest.server-only-stub.ts"),
    },
  },
  test: {
    // jsdom by default so hooks have window/document/localStorage.
    // Pure-logic tests (e.g. lib/stopsIndex.test.ts) and Node-only tests
    // (e.g. app/api/trains/route.test.ts) override per-file via a
    // `// @vitest-environment node` directive at the top.
    environment: "jsdom",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "data"],
    setupFiles: ["./vitest.setup.ts"],
    restoreMocks: true,
  },
});
