import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { ContentRootNotWritableError } from "@/lib/contentRoot";
import { createJournal } from "@/lib/journals";
import { reconcile, release, reserve } from "@/lib/registry";

/**
 * B1064 — the lock that turns "does this email/number already own a
 * journal" from a directory scan into an atomic exclusive-create.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-registry-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: ["admin"] },
      features: { signup: { enabled: true }, auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the address and number lock", () => {
  test("one journal per proven email", () => {
    expect(reserve("alex", "alex@example.test", null)).toEqual({ ok: true });
    expect(reserve("robin", "alex@example.test", null)).toEqual({ ok: false, conflict: "email" });
  });

  test("one journal per proven number, independent of email", () => {
    expect(reserve("alex", "alex@example.test", "41760000001")).toEqual({ ok: true });
    expect(reserve("robin", "robin@example.test", "41760000001")).toEqual({
      ok: false,
      conflict: "tel",
    });
    // The email did not get claimed by the failed attempt.
    expect(reserve("robin", "robin@example.test", "41760000002")).toEqual({ ok: true });
  });

  test("release frees both locks for a fresh reservation", () => {
    reserve("alex", "alex@example.test", "41760000001");
    release("alex", "alex@example.test", "41760000001");
    expect(reserve("robin", "alex@example.test", "41760000001")).toEqual({ ok: true });
  });

  test("cannot create a journal with a number already proven for another — even though the two own different addresses and the disk scan alone would let both through", () => {
    const first = createJournal({
      username: "one",
      title: "One",
      ownerEmail: "one@example.test",
      ownerName: "Robin",
      ownerNickname: "Robin",
      ownerTel: "41760000009",
      ownerTelProvenAt: new Date().toISOString(),
      ownerTelProvenMethod: "sms",
    });
    expect(first.ok).toBe(true);

    const second = createJournal({
      username: "two",
      title: "Two",
      ownerEmail: "two@example.test",
      ownerName: "Alex",
      ownerNickname: "Alex",
      ownerTel: "41760000009",
      ownerTelProvenAt: new Date().toISOString(),
      ownerTelProvenMethod: "sms",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("tel_taken");
  });

  test("two 'concurrent' creates for one address: only one wins", async () => {
    // `createJournal` is synchronous fs work — there is no way to interleave
    // two calls within one Node process, which is exactly what makes the
    // underlying guarantee (`fs.writeFileSync` with `wx`, i.e. O_CREAT|O_EXCL)
    // safe even *across* processes: the atomicity is the kernel's, not a lock
    // this process holds only against itself. This test exercises both calls
    // from two microtasks to say the same thing the ticket asks for — a race
    // in submission order — while the atomicity itself lives at the OS call.
    const attempt = (username: string) =>
      Promise.resolve().then(() =>
        createJournal({
          username,
          title: "A journal",
          ownerEmail: "race@example.test",
          ownerName: "Robin",
          ownerNickname: "Robin",
        }),
      );
    const [a, b] = await Promise.all([attempt("first"), attempt("second")]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  test("reconcile rebuilds the registry from content/ with the same result", () => {
    createJournal({
      username: "wanderer",
      title: "A journal",
      ownerEmail: "wanderer@example.test",
      ownerName: "Robin",
      ownerNickname: "Robin",
      ownerTel: "41760000003",
      ownerTelProvenAt: new Date().toISOString(),
      ownerTelProvenMethod: "sms",
    });

    fs.rmSync(path.join(dir, ".registry"), { recursive: true, force: true });
    const result = reconcile();
    expect(result.problems).toEqual([]);
    expect(result.emails).toBe(1);
    expect(result.tels).toBe(1);

    // The lock is live again: a second journal for the same address is
    // refused exactly as it would have been before the wipe.
    expect(reserve("stranger", "wanderer@example.test", null)).toEqual({
      ok: false,
      conflict: "email",
    });
  });

  // B1246 — a registry directory this process cannot write into used to
  // surface as a raw, uncaught EACCES partway through `reserve()`.
  test("a registry directory nobody can write into is a named refusal, not a raw EACCES", () => {
    const registryDir = path.join(dir, ".registry");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.chmodSync(registryDir, 0o000);
    try {
      let thrown: unknown;
      try {
        reserve("alex", "alex@example.test", null);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ContentRootNotWritableError);
      expect((thrown as Error).message).toContain("chown");
    } finally {
      fs.chmodSync(registryDir, 0o755);
    }
  });
});
