import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * What a server with no ffmpeg says about video — B692.
 *
 * `/api/health` reported the video formats from the constant, always, and
 * `/agent.md` printed the same row from the same place. On an instance where
 * the tools are missing — which is what following docs/runbook.md gave you
 * until B693 — that told every caller mp4, mov and webm were accepted while
 * every one of them was refused after the upload.
 *
 * The tools are found by spawning them, and the answer is cached, so each
 * assertion here needs a fresh module graph with `PATH` already set.
 */

let dir: string;
let realPath: string;

/** Nothing on `PATH` but an empty directory, so the real ffmpeg on this
 *  machine cannot answer. /usr/bin stays for the shell itself. */
function hideVideoTools() {
  process.env.PATH = `${dir}:/usr/bin:/bin`;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-no-ffmpeg-"));
  realPath = process.env.PATH ?? "";
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "alex" } }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  process.env.PATH = realPath;
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

describe("a server that cannot convert a clip", () => {
  test("does not offer video formats in its health", async () => {
    hideVideoTools();
    vi.resetModules();
    // What `register()` does at boot, and the only thing that may spawn.
    const { videoToolsAvailable } = await import("@/lib/ingest/video");
    videoToolsAvailable();
    const { GET } = await import("@/app/api/health/route");
    const body = (await (await GET(new Request("https://t.test/api/health"))).json()) as {
      media: { videoFormats: string[]; video?: { reason: string } };
    };

    expect(body.media.videoFormats).toEqual([]);
    expect(body.media.video?.reason).toMatch(/ffmpeg/);
  });

  test("and says so in the guide, where an agent reads what to send", async () => {
    hideVideoTools();
    vi.resetModules();
    const { videoToolsAvailable } = await import("@/lib/ingest/video");
    videoToolsAvailable();
    const { agentGuide } = await import("@/lib/api/documentation");
    const row = agentGuide()
      .split("\n")
      .find((line) => line.startsWith("| video |"));

    expect(row).toBeDefined();
    expect(row).toContain("not accepted on this instance");
    // The numbers are not the answer here: a ceiling on something that will be
    // refused whatever its size is an invitation to try.
    expect(row).not.toMatch(/at most/);
  });

  test("while a server that can says exactly what it takes", async () => {
    // The real PATH, and therefore the real answer. Skipped where this machine
    // has no ffmpeg either — there the case above is the only one there is.
    vi.resetModules();
    const { videoToolsAvailable } = await import("@/lib/ingest/video");
    if (!videoToolsAvailable()) return;

    const { agentGuide } = await import("@/lib/api/documentation");
    const row = agentGuide()
      .split("\n")
      .find((line) => line.startsWith("| video |"));

    expect(row).toContain("mp4");
    expect(row).toContain("at most");

    const { GET } = await import("@/app/api/health/route");
    const body = (await (await GET(new Request("https://t.test/api/health"))).json()) as {
      media: { videoFormats: string[]; video?: unknown };
    };
    expect(body.media.videoFormats).toContain("mp4");
    expect(body.media.video).toBeUndefined();
  });

  /**
   * The finding a review made of B692 — B695.
   *
   * `videoToolsAvailable()` spawns two processes, holds its caller for up to
   * ten seconds, and deliberately does not cache an inconclusive answer, so it
   * spawns again next time. Reading it from `/api/health` — public,
   * unauthenticated, and read by every agent before an upload — made a cheap
   * GET into a process amplifier, at its worst on a machine already loaded
   * enough to make the check inconclusive.
   */
  test("neither public document spawns a process to answer", async () => {
    // Shims that leave a trace when run, on a PATH that has nothing else.
    // Watching the filesystem rather than the module: `node:child_process` is
    // frozen and cannot be spied on, and this is the honest question anyway —
    // was a process started.
    const trace = path.join(dir, "spawned");
    for (const name of ["ffmpeg", "ffprobe"]) {
      const shim = path.join(dir, name);
      fs.writeFileSync(shim, `#!/bin/sh\necho x >> ${trace}\nexit 0\n`);
      fs.chmodSync(shim, 0o755);
    }
    process.env.PATH = `${dir}:/usr/bin:/bin`;
    vi.resetModules();

    const { GET } = await import("@/app/api/health/route");
    const { agentGuide } = await import("@/lib/api/documentation");
    for (let i = 0; i < 5; i++) {
      await GET(new Request("https://t.test/api/health"));
      agentGuide();
    }

    expect(fs.existsSync(trace)).toBe(false);

    // And the shims really would have left one, so the assertion above is
    // about the callers and not about a broken fixture.
    const { videoToolsAvailable } = await import("@/lib/ingest/video");
    videoToolsAvailable();
    expect(fs.existsSync(trace)).toBe(true);
  });

  /** And with nothing known either way, the formats are offered: "we have not
   *  asked yet" is not "this server refuses clips", and the upload still
   *  refuses cleanly if it comes to that. */
  test("an unasked question is not answered as a no", async () => {
    hideVideoTools();
    vi.resetModules();
    const { videoToolsKnown } = await import("@/lib/ingest/video");
    expect(videoToolsKnown()).toBeNull();

    const { GET } = await import("@/app/api/health/route");
    const body = (await (await GET(new Request("https://t.test/api/health"))).json()) as {
      media: { videoFormats: string[]; video?: unknown };
    };
    expect(body.media.videoFormats).toContain("mp4");
    expect(body.media.video).toBeUndefined();
  });
});
