import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Each test spins up its own in-process PGlite (WASM Postgres). Booting many
    // PGlite instances in parallel starves them and blows the hook timeout, so
    // run test files one at a time.
    fileParallelism: false,
  },
});
