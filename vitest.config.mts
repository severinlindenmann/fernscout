import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolves the `@/*` alias straight from tsconfig.json.
    tsconfigPaths: true,
    // `server-only` throws on import outside a React Server Component. The
    // modules it guards are plain filesystem readers, so under test it is
    // replaced with a no-op.
    alias: [
      {
        find: /^server-only$/,
        replacement: new URL("test/stubs/server-only.ts", import.meta.url).pathname,
      },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // SQLite runs in memory, one database per handle, so files can't collide.
    // Postgres can't: every file that opts into POSTGRES_TEST_URL points at the
    // same database and each of them drops the schema on the way in. Serialise
    // the files only when that variable is set — the suite is under a second
    // either way. See test/support/dialects.ts.
    fileParallelism: !process.env.POSTGRES_TEST_URL,
  },
});
