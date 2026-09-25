import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess } from "@/lib/ingest/run";

/**
 * Ingest's external tools run beside the server, not instead of it.
 *
 * ffmpeg, ffprobe and the HEIC decoders were run with `spawnSync`, reached
 * from the upload routes, so a clip being transcoded held every other request
 * on the process until it finished. The first block here is the property that
 * matters — the event loop keeps turning while a slow ffmpeg runs — and the
 * rest pins the parts of `spawnSync`'s answer the callers read, which
 * `runProcess` has to keep giving them.
 *
 * Shims on `PATH` stand in for the tools, so this runs the same on a machine
 * with no ffmpeg at all.
 */

let dir: string;
let realPath: string;

function shim(name: string, body: string) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-spawn-"));
  realPath = process.env.PATH ?? "";
  process.env.PATH = `${dir}:/usr/bin:/bin`;
});

afterEach(() => {
  process.env.PATH = realPath;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

describe("a transcode in progress", () => {
  test("does not stop the process answering anything else", async () => {
    // A second of "encoding", then an empty output; the poster call (the one
    // writing to pipe:1) answers at once with a few bytes.
    shim(
      "ffmpeg",
      [
        'for last; do :; done',
        'case "$last" in',
        '  pipe:1) printf "JPEG" ;;',
        '  *) sleep 1; : > "$last" ;;',
        "esac",
      ].join("\n"),
    );
    shim("ffprobe", `echo '{"format":{"duration":"3"},"streams":[{"width":640,"height":360}]}'`);
    const { transcodeVideo } = await import("@/lib/ingest/video");

    const started = performance.now();
    let finishedAt: number | null = null;
    const transcode = transcodeVideo(path.join(dir, "in.mov"), path.join(dir, "out", "clip.mp4")).then(
      (result) => {
        finishedAt = performance.now();
        return result;
      },
    );

    // What another request amounts to, from the loop's point of view: a
    // callback that wants to run soon. Under `spawnSync` it waited out the
    // whole encode.
    const tick = await new Promise<number>((resolve) => setTimeout(() => resolve(performance.now()), 20));
    expect(finishedAt).toBeNull();
    expect(tick - started).toBeLessThan(500);

    const result = await transcode;
    expect(finishedAt! - started).toBeGreaterThanOrEqual(900);
    expect(result).toMatchObject({ width: 640, height: 360 });
    expect(result.poster.toString()).toBe("JPEG");
  }, 15_000);
});

describe("runProcess keeps spawnSync's answer", () => {
  test("a missing binary is ENOENT, with no status", async () => {
    const run = await runProcess("fernscout-no-such-tool", ["-version"]);
    expect(run.status).toBeNull();
    expect(run.error?.code).toBe("ENOENT");
  });

  test("a binary that will not execute is an error that is not ENOENT", async () => {
    shim("stuck", "exit 0");
    fs.chmodSync(path.join(dir, "stuck"), 0o644);
    const run = await runProcess("stuck", []);
    expect(run.error).toBeDefined();
    expect(run.error?.code).not.toBe("ENOENT");
  });

  test("the exit status and stderr come back as written", async () => {
    shim("fails", 'echo "bad input" >&2\nexit 3');
    const run = await runProcess("fails", [], { stderr: "pipe" });
    expect(run.status).toBe(3);
    expect(run.error).toBeUndefined();
    expect(run.stderr.toString().trim()).toBe("bad input");
  });

  test("stdout is collected whole", async () => {
    shim("talks", 'printf "%s" "$1"');
    const run = await runProcess("talks", ["hello"], { stdout: "pipe" });
    expect(run.status).toBe(0);
    expect(run.stdout.toString()).toBe("hello");
  });

  test("a timeout kills it and says ETIMEDOUT", async () => {
    shim("hangs", "exec sleep 30");
    const started = Date.now();
    const run = await runProcess("hangs", [], { timeout: 200 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(run.status).toBeNull();
    expect(run.error?.code).toBe("ETIMEDOUT");
  });

  test("output past maxBuffer kills it and says ENOBUFS", async () => {
    shim("floods", "exec yes");
    const run = await runProcess("floods", [], { stdout: "pipe", maxBuffer: 64 * 1024 });
    expect(run.status).toBeNull();
    expect(run.error?.code).toBe("ENOBUFS");
    expect(run.stdout.length).toBeLessThanOrEqual(64 * 1024);
  });

  test("stdin is closed, so a tool that reads it does not wait", async () => {
    shim("reads", "cat");
    const run = await runProcess("reads", [], { stdout: "pipe", timeout: 5_000 });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
  });
});

describe("a spawn that throws instead of emitting error", () => {
  // macOS answers a binary for the wrong architecture with
  // `spawn Unknown system error -86` thrown from `spawn()` itself, not as an
  // `error` event. `spawnSync` returned that as `error`; so must this.
  function spawnThrows() {
    vi.doMock("node:child_process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:child_process")>()),
      spawn: () => {
        const error: NodeJS.ErrnoException = new Error("spawn Unknown system error -86");
        error.code = "Unknown system error -86";
        error.errno = -86;
        throw error;
      },
    }));
  }

  afterEach(() => {
    vi.doUnmock("node:child_process");
  });

  test("resolves with the error rather than rejecting", async () => {
    spawnThrows();
    const { runProcess: run } = await import("@/lib/ingest/run");
    const result = await run("ffmpeg", ["-version"], { stdout: "pipe" });
    expect(result.status).toBeNull();
    expect(result.error?.message).toContain("-86");
    expect(result.stdout.length).toBe(0);
  });

  test("the video tools read as absent", async () => {
    spawnThrows();
    const { videoToolsAvailable } = await import("@/lib/ingest/video");
    await expect(videoToolsAvailable()).resolves.toBe(false);
  });
});
