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
    // Fourteen test files spawn a subprocess — `tsx` running a script, a shell
    // running a deploy check — and wait for it to finish. Vitest's default
    // `testTimeout` is 5 seconds, which is generous when such a file is the
    // only thing running and is not when it is one of 240-odd running at once:
    // B249 was a failure that appeared once in six runs, named nothing, and
    // then passed 12/12 the moment it was run by itself. The cost is that a
    // genuinely hung test now takes 30 seconds to say so instead of 5, against
    // a suite that takes 75; the alternative was the same line in fourteen
    // files, or assertions loosened to hide a timing problem.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
