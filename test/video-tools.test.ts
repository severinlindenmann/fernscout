import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Deciding whether ffmpeg is on this machine.
 *
 * The answer is cached, because two `-version` spawns on every upload would be
 * absurd. What it must not cache is a *guess*: the check spawns two binaries
 * with a five-second cap each, and a machine busy enough to miss that cap is
 * not a machine without ffmpeg. It happened here — a suite run alongside a
 * Next.js build recorded ffmpeg as missing, which silently skipped three
 * `describe.runIf` tests in test/ingest-run.test.ts and timed out a fourth in
 * test/media-upload.test.ts, ten seconds of detection inside a five-second
 * budget.
 *
 * On a server the same moment is worse than a red test: video uploads are
 * refused with "ffmpeg is not installed" until somebody restarts the process.
 *
 * So: "the binary is not there" is a fact and is remembered. "The check did
 * not finish" is not an answer and must be asked again.
 */

let dir: string;
let realPath: string;

/** A stand-in on PATH that hands straight over to the real tool. */
function shim(name: string, executable: boolean) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nexec /usr/bin/env true "$@"\n`);
  fs.chmodSync(file, executable ? 0o755 : 0o644);
}

/** A fresh module, so each test starts with an empty cache. */
async function freshVideoTools() {
  vi.resetModules();
  return import("@/lib/ingest/video");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tools-"));
  realPath = process.env.PATH ?? "";
  // Nothing but our own shims, so the real ffmpeg on this machine cannot
  // answer for them. /usr/bin is kept for the `env` the shims call.
  process.env.PATH = `${dir}:/usr/bin:/bin`;
});

afterEach(() => {
  process.env.PATH = realPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("videoToolsAvailable", () => {
  test("is true when both tools run", async () => {
    shim("ffmpeg", true);
    shim("ffprobe", true);
    const { videoToolsAvailable } = await freshVideoTools();
    expect(videoToolsAvailable()).toBe(true);
  });

  test("is false when they are not on PATH at all", async () => {
    const { videoToolsAvailable } = await freshVideoTools();
    expect(videoToolsAvailable()).toBe(false);
  });

  test("does not spawn again once it has a real answer", async () => {
    shim("ffmpeg", true);
    shim("ffprobe", true);
    const { videoToolsAvailable } = await freshVideoTools();
    expect(videoToolsAvailable()).toBe(true);

    // Take the tools away. A cached "yes" must survive, or every upload pays
    // for two more spawns.
    fs.rmSync(path.join(dir, "ffmpeg"));
    fs.rmSync(path.join(dir, "ffprobe"));
    expect(videoToolsAvailable()).toBe(true);
  });

  test("asks again after a check that could not finish", async () => {
    // A binary that is there but cannot be run is not a binary that is
    // missing — it stands in here for the timeout and the failed fork that
    // this actually happened through, because both arrive the same way: a
    // spawn error that is not ENOENT.
    shim("ffmpeg", false);
    shim("ffprobe", false);
    const { videoToolsAvailable } = await freshVideoTools();
    expect(videoToolsAvailable()).toBe(false);

    // The machine recovers. Nothing else happens — no restart, no reset.
    fs.chmodSync(path.join(dir, "ffmpeg"), 0o755);
    fs.chmodSync(path.join(dir, "ffprobe"), 0o755);
    expect(videoToolsAvailable()).toBe(true);
  });

  test("remembers a genuine absence rather than asking forever", async () => {
    const { videoToolsAvailable } = await freshVideoTools();
    expect(videoToolsAvailable()).toBe(false);

    // ffmpeg turning up mid-process is not a case worth paying two spawns per
    // upload to notice; ENOENT is a fact, and facts are cached.
    shim("ffmpeg", true);
    shim("ffprobe", true);
    expect(videoToolsAvailable()).toBe(false);
  });
});
