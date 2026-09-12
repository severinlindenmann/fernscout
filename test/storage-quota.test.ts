import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { grant, spend } from "@/lib/credits";
import { EXTRA_STORAGE_BYTES, EXTRA_STORAGE_CREDITS } from "@/lib/credits/pricing";
import { journalBytes, storageFor, storageRefusal, withStorageQuota } from "@/lib/storageQuota";

/**
 * The ceiling over a journal's whole folder — B661.
 *
 * What is actually asserted here, one line each: that the count is the
 * *folder* and not the media directory (a photobook used to be free), that a
 * write past the ceiling is refused rather than half-written, that the owner
 * hears about it once rather than once per attempt, and that fifty credits
 * raise the ceiling for good.
 *
 * SQLite only. Nothing here races: `spend`'s concurrency is
 * `credits.test.ts`'s property and is held on its Postgres leg.
 */

let dir: string;
let data: string;

/**
 * A fresh journal name per test.
 *
 * `lib/rateLimit.ts` keeps its buckets in module memory, and the once-a-day
 * notice is keyed by journal and level — so a second test reusing one name
 * finds the first test's notice still counted and sees no mail at all.
 * Cheaper than a test-only reset on the limiter, and closer to the truth:
 * these really are different journals.
 */
let who: string;
let counter = 0;

/** A journal with a ceiling of `limit` bytes and mail written to disk. */
async function setup(limit: number | null): Promise<void> {
  who = `alice${++counter}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-storage-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-storage-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(data, "storage.db")}`;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { credits: { enabled: true }, mail: { enabled: true, transport: "file" } },
      media: { perUserBytes: limit },
    }),
  );
  fs.mkdirSync(path.join(dir, who), { recursive: true });
  fs.writeFileSync(
    path.join(dir, who, "config.json"),
    JSON.stringify({
      title: "Alice",
      owner: { name: "Alice A", nickname: "Alice", email: "a@example.test" },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await getDatabase();
}

/** `n` bytes inside this test's journal. */
function write(bytes: number, ...parts: string[]): void {
  const file = path.join(dir, who, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
}

/** Every `.eml` this instance has written for this test's journal. */
function mails(): string[] {
  const at = path.join(data, "mail", who);
  return fs.existsSync(at) ? fs.readdirSync(at) : [];
}

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

describe("the whole file, kept in written order", { shuffle: false }, () => {
  describe("what counts against the ceiling", () => {
    beforeEach(() => setup(10_000));

    /**
     * The whole point of B661. Before it, only `trips/<id>/media` and
     * `originals` were counted, so a journal could sit at three times its
     * ceiling in photobook PDFs and still be told it had room.
     */
    test("every byte under the journal, photobooks and markdown included", async () => {
      // The journal's own config.json is already on disk and is already a file
      // somebody's disk is holding, so it counts too — measured rather than
      // assumed, and the assertion is about the three files added on top.
      const before = journalBytes(who);
      write(1_000, "trips", "alps", "media", "day-1", "01.jpg");
      write(2_000, "photobooks", "ord_1", "book-interior.pdf");
      write(500, "trips", "alps", "entries", "2026-01-01-a-day.md");

      // The photobook and the markdown are the two that used to be free.
      expect(journalBytes(who)).toBe(before + 3_500);
      expect((await storageFor(who)).usedBytes).toBe(before + 3_500);
    });

    test("a journal nobody has written to holds nothing", () => {
      expect(journalBytes("nobody")).toBe(0);
    });
  });

  describe("refusing a write", () => {
    beforeEach(() => setup(10_000));

    test("a write that fits is allowed and says nothing", async () => {
      write(1_000, "photobooks", "ord_1", "book.pdf");
      expect(await storageRefusal(who, 1_000)).toBeNull();
      expect(mails()).toHaveLength(0);
    });

    /** The batch is refused whole — the caller is told the total it would
     * reach, not which file broke it, because nothing is written either way. */
    test("a write that would go past the ceiling is refused", async () => {
      write(9_000, "photobooks", "ord_1", "book.pdf");
      const refusal = await storageRefusal(who, 2_000);
      expect(refusal).toContain("would take it to");
      expect(refusal).toContain("buy more room");
    });

    test("no ceiling means nothing is ever refused", async () => {
      await setup(null);
      write(50_000, "photobooks", "ord_1", "book.pdf");
      expect(await storageRefusal(who, 50_000)).toBeNull();
      expect((await storageFor(who)).limitBytes).toBeNull();
    });
  });

  describe("telling the owner", () => {
    beforeEach(() => setup(10_000));

    test("crossing the warning line mails once, not once per upload", async () => {
      write(8_000, "photobooks", "ord_1", "book.pdf");

      // 8_000 + 1_500 is 95% of 10_000 — over the line, still allowed.
      expect(await storageRefusal(who, 1_500)).toBeNull();
      expect(mails()).toHaveLength(1);

      // The second upload past the same line is silent. A mail per photograph
      // is how a warning ends up in a folder nobody opens.
      expect(await storageRefusal(who, 1_500)).toBeNull();
      expect(mails()).toHaveLength(1);
    });

    test("being refused mails too, and only once", async () => {
      write(9_500, "photobooks", "ord_1", "book.pdf");
      expect(await storageRefusal(who, 1_000)).not.toBeNull();
      expect(mails()).toHaveLength(1);
      expect(await storageRefusal(who, 1_000)).not.toBeNull();
      expect(mails()).toHaveLength(1);
    });
  });

  describe("buying more room", () => {
    beforeEach(() => setup(10_000));

    test("fifty credits add five gigabytes, and buying twice adds twice", async () => {
      expect((await storageFor(who)).limitBytes).toBe(10_000);

      await grant(who, EXTRA_STORAGE_CREDITS * 2);
      expect(await spend(who, EXTRA_STORAGE_CREDITS, "storage", `${who}/storage`)).toBe(true);
      expect((await storageFor(who)).limitBytes).toBe(10_000 + EXTRA_STORAGE_BYTES);
      expect((await storageFor(who)).purchasedBytes).toBe(EXTRA_STORAGE_BYTES);

      expect(await spend(who, EXTRA_STORAGE_CREDITS, "storage", `${who}/storage`)).toBe(true);
      expect((await storageFor(who)).limitBytes).toBe(10_000 + EXTRA_STORAGE_BYTES * 2);
    });

    test("a balance too small buys nothing and changes no ceiling", async () => {
      await grant(who, EXTRA_STORAGE_CREDITS - 1);
      expect(await spend(who, EXTRA_STORAGE_CREDITS, "storage", `${who}/storage`)).toBe(false);
      expect((await storageFor(who)).limitBytes).toBe(10_000);
      expect((await storageFor(who)).purchasedBytes).toBe(0);
    });

    /** The purchase is what a refusal is *for*: it has to let the write
     * through afterwards. */
    test("what was refused before the purchase is allowed after it", async () => {
      write(9_000, "photobooks", "ord_1", "book.pdf");
      expect(await storageRefusal(who, 2_000)).not.toBeNull();

      await grant(who, EXTRA_STORAGE_CREDITS);
      await spend(who, EXTRA_STORAGE_CREDITS, "storage", `${who}/storage`);
      expect(await storageRefusal(who, 2_000)).toBeNull();
    });

    /** The server's ceiling still narrows a journal that asks for more — a
     * purchase is added on top of the narrowed number, never instead of it. */
    test("a journal cannot widen its own ceiling by asking", async () => {
      fs.writeFileSync(
        path.join(dir, who, "config.json"),
        JSON.stringify({
          title: "Alice",
          owner: { name: "Alice A", nickname: "Alice", email: "a@example.test" },
          media: { perUserBytes: 10 ** 9 },
        }),
      );
      clearConfigCache();
      clearUserCache();
      expect((await storageFor(who)).limitBytes).toBe(10_000);
    });
  });

  describe("who may buy it", () => {
    beforeEach(() => setup(10_000));

    /**
     * The route spends the owner's credits, so it is the owner's own session or
     * nothing — `isOwner` alone would let a journal-scoped agent token through,
     * which is the whole reason the header is checked separately.
     */
    test("a bearer token is refused, and nothing is charged", async () => {
      const { POST } = await import("@/app/api/v1/[user]/storage/route");
      await grant(who, EXTRA_STORAGE_CREDITS);

      const response = await POST(
        new Request("https://example.test/api/v1/x/storage", {
          method: "POST",
          headers: { authorization: "Bearer fs_agent_whatever" },
        }),
        { params: Promise.resolve({ user: who }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "not_for_agents" });
      expect((await storageFor(who)).purchasedBytes).toBe(0);
    });
  });

  describe("parallel writes against one ceiling — B1556", () => {
    beforeEach(() => setup(10_000));

    /**
     * `storageRefusal` alone answers from a directory walk with nothing held:
     * two uploads that each individually fit could both pass the check before
     * either had written a byte, and both would proceed. `withStorageQuota` is
     * the fix — check and write, one step, serialised per journal — and this
     * is what it has to hold: five uploads of 3,000 bytes each against a
     * 10,000-byte ceiling (fitting three, not five) must land at most three of
     * them, and never take the journal past the ceiling plus one upload's own
     * size.
     *
     * `setTimeout` inside `write` rather than a synchronous `fs.writeFileSync`
     * alone is what actually exercises the lock: without it every call's
     * check and write would already run back-to-back on the same microtask
     * turn, and the race this ticket is about — another call's check landing
     * *between* this one's check and its write — would never get a chance to
     * happen even with no lock at all.
     */
    test("uploads that jointly exceed the ceiling refuse the ones that would tip it over", async () => {
      const bytesPerUpload = 3_000;
      const attempts = 5;
      const before = journalBytes(who);

      const results = await Promise.all(
        Array.from({ length: attempts }, (_, i) =>
          withStorageQuota(who, bytesPerUpload, () =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                write(bytesPerUpload, "trips", "alps", "media", "day-1", `${i}.jpg`);
                resolve();
              }, 5);
            }),
          ),
        ),
      );

      const accepted = results.filter((r) => r.ok).length;
      const refused = results.filter((r) => !r.ok);

      // 10_000 / 3_000 fits three whole uploads (9_000) and refuses a fourth
      // that would reach 12_000 — so exactly three land, never four or five.
      expect(accepted).toBe(3);
      expect(refused).toHaveLength(2);
      for (const r of refused) {
        if (!r.ok) expect(r.problem).toContain("would take it to");
      }

      // The property the ticket actually asks for: total bytes on disk never
      // exceeds the ceiling plus one upload's own size — which is what a
      // truly unguarded race (all five landing) would have blown past.
      const added = journalBytes(who) - before;
      expect(added).toBeLessThanOrEqual(10_000 + bytesPerUpload);
      expect(added).toBe(accepted * bytesPerUpload);
    });
  });

  describe("the photobook door", () => {
    /**
     * A source-level assertion, in the shape `test/postcard-orders.test.ts`
     * already uses: the guard is only worth having if every path that writes
     * real bytes goes through it, and the photobook route is the one that is not
     * an upload. Building a book in a test costs tens of seconds and a headless
     * renderer; reading the file it is built from does not.
     */
    test("ordering a photobook asks the same guard uploads do", () => {
      const source = fs.readFileSync("app/[user]/photobook/order/route.ts", "utf8");
      expect(source).toContain("storageRefusal");
      expect(source).toContain('back_("no_room")');
    });
  });
});
