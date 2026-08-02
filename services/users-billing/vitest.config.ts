import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // schema.test.ts and signup.test.ts each run drizzle migrate() against the
    // same DATABASE_URL in beforeAll; running test files in parallel races
    // concurrent migrations against one Postgres catalog and flakes ~1 in 4-5
    // runs. Serialize files; tests within a file still run concurrently.
    fileParallelism: false,
  },
});
