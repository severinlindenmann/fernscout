import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { usageSince } from "@/lib/usage";

/**
 * A failed or aborted Deepgram call still leaves a cost row — B2589.
 *
 * Before this ticket, `transcribeAudio` only called `recordUsage` after a
 * successful, parsed response — a refused request or a dropped connection
 * wrote nothing, although Deepgram bills the audio it already read. This
 * proves the fix directly against the database: a non-ok response that
 * still carries a measured duration is booked before the error is thrown,
 * never dropped.
 */
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-deepgram-fail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "deepgram-fail-secret-b2589";
  process.env.DEEPGRAM_API_KEY = "dummy-key";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { transcription: { enabled: true, backend: "deepgram" } },
    }),
  );
  clearConfigCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.DEEPGRAM_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a failed Deepgram call", () => {
  test("a non-ok response with a measured duration is booked before the throw", async () => {
    const { transcribeAudio } = await import("@/lib/helper/transcribe");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ metadata: { duration: 7 } }), { status: 500 }));
    try {
      await expect(transcribeAudio(Buffer.from("bytes"), "audio/webm", "en", "alex")).rejects.toThrow(
        "deepgram: 500",
      );
    } finally {
      fetchSpy.mockRestore();
    }

    const totals = await usageSince("1970-01-01T00:00:00.000Z", "alex");
    const deepgram = totals.find((t) => t.provider === "deepgram" && t.operation === "transcribe");
    expect(deepgram).toBeDefined();
    expect(deepgram?.calls).toBe(1);
    expect(deepgram?.seconds).toBe(7);
  });

  test("a dropped connection is booked at zero seconds rather than written off", async () => {
    const { transcribeAudio } = await import("@/lib/helper/transcribe");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("socket hang up"));
    try {
      await expect(transcribeAudio(Buffer.from("bytes"), "audio/webm", "en", "alex")).rejects.toThrow(
        "socket hang up",
      );
    } finally {
      fetchSpy.mockRestore();
    }

    const totals = await usageSince("1970-01-01T00:00:00.000Z", "alex");
    const deepgram = totals.find((t) => t.provider === "deepgram" && t.operation === "transcribe");
    expect(deepgram).toBeDefined();
    expect(deepgram?.calls).toBe(1);
    expect(deepgram?.seconds).toBe(0);
  });
});
