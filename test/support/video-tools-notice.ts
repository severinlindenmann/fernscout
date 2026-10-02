// @scans test/**/*.test.ts test/**/*.test.tsx paid/test/**/*.test.ts
import fs from "node:fs";
import path from "node:path";
import { videoToolsAvailable } from "../../lib/ingest/video.ts";
import { runProcess } from "../../lib/ingest/run.ts";

/**
 * B2714 — a broken ffmpeg used to fail silently: `videoToolsAvailable()` is
 * false, every `describe.runIf(videoToolsAvailable())` just skips, and a
 * green run gives no sign the video suite never ran at all. This Mac's own
 * `/usr/local/bin/ffmpeg` is an x86_64 binary on arm64 (`spawnSync ffmpeg
 * Unknown system error -86`) — exactly this case, not "ffmpeg missing".
 *
 * One line, only when it happens, never failing the run (CI may legitimately
 * lack ffmpeg) unless `REQUIRE_VIDEO_TOOLS=1`. The count is derived from the
 * test files themselves rather than kept by hand, so it drifts with the
 * tests instead of the day somebody remembers to update a number.
 */
export default async function setup(): Promise<void> {
  if (await videoToolsAvailable()) return;
  const probe = await runProcess("ffmpeg", ["-version"], { timeout: 5_000 });
  const reason = probe.error?.message ?? "ffprobe is missing or unusable";
  const n = ["test", "paid/test"]
    .map((dir) => path.join(process.cwd(), dir))
    .filter((dir) => fs.existsSync(dir))
    .reduce((sum, dir) => sum + countSkippedVideoTests(dir), 0);
  console.warn(`\n⚠ ${n} video test${n === 1 ? "" : "s"} skipped: ffmpeg unusable: ${reason}\n`);
  if (process.env.REQUIRE_VIDEO_TOOLS === "1") {
    throw new Error(`REQUIRE_VIDEO_TOOLS=1 but ffmpeg is unusable: ${reason}`);
  }
}

/**
 * Counts `test()`/`it()` calls that never ran because they are either
 * guarded by `describe.runIf(await videoToolsAvailable())` or start with an
 * early `if (!(await videoToolsAvailable())) return;`. Static, not a run —
 * cheap enough to call on every cold start, and it does not need the suite
 * to actually execute to know what it would have skipped.
 */
export function countSkippedVideoTests(testDir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(testDir, { recursive: true }) as string[]) {
    if (!/\.test\.tsx?$/.test(entry)) continue;
    const full = path.join(testDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    const text = fs.readFileSync(full, "utf8");
    total += (text.match(/videoToolsAvailable\(\)\)\)\s*return;/g) ?? []).length;
    const blockRe = /describe\.runIf\(await videoToolsAvailable\(\)\)\([^{]*\{/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(text))) {
      const start = m.index + m[0].length - 1; // the block's opening '{'
      let depth = 1;
      let i = start + 1;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        i++;
      }
      total += (text.slice(start, i).match(/\b(test|it)\(/g) ?? []).length;
    }
  }
  return total;
}
