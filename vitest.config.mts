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
    include: ["test/**/*.test.ts", "test/**/*.test.tsx", "paid/test/**/*.test.ts", "paid/test/**/*.test.tsx"],
    // Only does anything when FERNSCOUT_TEST_CLOCK_OFFSET_DAYS is set — see
    // test/support/future-clock.ts and `npm run test:future-clock` (B1947).
    setupFiles: ["test/support/future-clock.ts", "test/support/per-file-database.ts"],
    // Postgres gets one database per worker (B2552), so files run in
    // parallel on every leg — see test/support/pg-workers.ts. B2714 adds the
    // loud line for a broken/missing ffmpeg, so a silently-skipped video
    // suite shows up in the run instead of just being quietly green.
    globalSetup: ["test/support/pg-workers.ts", "test/support/video-tools-notice.ts"],
    // Fourteen test files spawn a subprocess — `tsx` running a script, a shell
    // running a deploy check — and wait for it to finish. Vitest's default
    // `testTimeout` is 5 seconds, which is generous when such a file is the
    // only thing running and is not when it is one of 240-odd running at once:
    // B249 was a failure that appeared once in six runs, named nothing, and
    // then passed 12/12 the moment it was run by itself. The cost is that a
    // genuinely hung test now takes 30 seconds to say so instead of 5, against
    // a suite that takes 75; the alternative was the same line in fourteen
    // files, or assertions loosened to hide a timing problem.
    // Half the cores, not all but one: several sessions run the suite at once
    // on one machine, and each taking every core is what took it down (B2144).
    // A CI runner is nobody else's machine, so it takes them all (B2552).
    maxWorkers: process.env.CI ? "100%" : "50%",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
