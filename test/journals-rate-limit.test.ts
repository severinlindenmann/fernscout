import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "@/app/api/v1/journals/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { SIGNUP_OWNER, issueCode, verifyCode } from "@/lib/auth";

/**
 * B217 — the token survives a mistake; the IP budget did not.
 *
 * B55 made a signup token survive a refused creation, deliberately and in
 * writing: `/agent.md` says a taken username is worth correcting rather than
 * starting over, so somebody picking a name does not have to go back to their
 * inbox each time one is gone. The rate limiter did not honour that. It sat
 * ahead of authentication and validation and counted *attempts*, five an hour
 * per address — so an agent helping somebody choose a name got three or four
 * corrections and was then locked out for the rest of the hour, holding a
 * token that was still perfectly good.
 *
 * Two buckets now: creations that happened, and refusals. Enumeration is still
 * a sequence of refusals and still costs, which is why the second bucket
 * exists at all rather than refusals simply being free.
 *
 * **Every test here pins its own address and keeps it for the whole test.**
 * That is the opposite of `test/signup-token.test.ts`, which rotates the
 * header per call precisely to keep this limiter out of the way; here the
 * limiter is the subject, so a rotating address would test nothing. The
 * limiter's map is module-level and outlives a test, so the addresses must not
 * collide between tests either.
 */

let dir: string;

async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(SIGNUP_OWNER, email, "signup");
  const result = await verifyCode(SIGNUP_OWNER, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");
  return result.token;
}

function create(ip: string, token: string, body: Record<string, unknown>) {
  return POST(
    new Request("https://example.test/api/v1/journals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    }),
  );
}

const GOOD = { title: "A journal", ownerName: "Robin Traveller", ownerNickname: "Robin" };
/** Refused by `createJournal` every time, and cheap: no journal is written. */
const NOT_A_NAME = { ...GOOD, username: "Has Capitals" };

type Refusal = { error?: string; reason?: string; retryAfter?: number; message?: string };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-journal-limits-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b217-test-secret-b217-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { signup: { enabled: true }, auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("correcting a name from one address", () => {
  /**
   * The acceptance line, as written. It passed before the change too — four
   * refusals plus one success is exactly the five the old single bucket
   * allowed — so it is the guarantee, not the regression test. The next one is
   * the one that fails without the fix.
   */
  test("four refusals then a success, and the success is not refused", async () => {
    const ip = "203.0.113.10";
    const token = await signupToken("four@example.test");

    for (const attempt of ["Has Capitals", "also bad", "", "one more space"]) {
      const refused = await create(ip, token, { ...GOOD, username: attempt });
      expect(refused.status, `"${attempt}" was not refused`).toBe(400);
    }

    const made = await create(ip, token, { ...GOOD, username: "fifth-time-lucky" });
    expect(made.status).toBe(201);
    expect(getUser("fifth-time-lucky")?.title).toBe("A journal");
  });

  /** The conversation the old limiter cut off. Six corrections is not a lot
   * when somebody is thinking aloud about a name, and the seventh call is the
   * one that matters. */
  test("six refusals then a success, and the success is still not refused", async () => {
    const ip = "203.0.113.11";
    const token = await signupToken("six@example.test");

    for (let i = 0; i < 6; i++) {
      expect((await create(ip, token, NOT_A_NAME)).status).toBe(400);
    }

    const made = await create(ip, token, { ...GOOD, username: "seventh" });
    expect(made.status).toBe(201);
    expect(getUser("seventh")).not.toBeNull();
  });
});

describe("what still costs", () => {
  /** The counter-argument the task asks to be weighed honestly: the limit also
   * exists to make name enumeration expensive, and enumeration is exactly a
   * sequence of refusals. So they are not free — only counted apart. */
  test("a run of refusals is stopped, well short of unlimited", async () => {
    const ip = "203.0.113.12";
    const token = await signupToken("sweeper@example.test");

    for (let i = 0; i < 20; i++) {
      expect((await create(ip, token, NOT_A_NAME)).status, `attempt ${i + 1}`).toBe(400);
    }

    const stopped = await create(ip, token, NOT_A_NAME);
    expect(stopped.status).toBe(429);
    const body = (await stopped.json()) as Refusal;
    expect(body.reason).toBe("failed_attempts");
    // And it says the token is not the problem, so an agent does not report a
    // dead credential to somebody holding a live one.
    expect(body.message).toContain("token is still good");
  });

  /** The strict budget is untouched: five journals an hour per address, and
   * only journals count towards it. */
  test("five creations from one address, and the sixth waits", async () => {
    const ip = "203.0.113.13";
    for (let i = 0; i < 5; i++) {
      // A fresh address each time — three journals per owner is a separate
      // rule (MAX_JOURNALS_PER_EMAIL) and is not what this test is about.
      const token = await signupToken(`maker${i}@example.test`);
      expect((await create(ip, token, { ...GOOD, username: `journal-${i}` })).status).toBe(201);
    }

    const sixth = await signupToken("maker5@example.test");
    const stopped = await create(ip, sixth, { ...GOOD, username: "journal-5" });
    expect(stopped.status).toBe(429);
    const body = (await stopped.json()) as Refusal;
    expect(body.reason).toBe("journals_created");
    expect(body.message).toContain("created 5 journals");
    expect(getUser("journal-5")).toBeNull();
    // Unchanged, and still in the header as well as the body.
    expect(typeof body.retryAfter).toBe("number");
    expect(stopped.headers.get("Retry-After")).toBe(String(body.retryAfter));
  });

  /**
   * The two are told apart, which is the whole of the third acceptance line: a
   * bare `too_many_requests` reads as "the server is busy", and the person
   * waiting is told the wrong thing.
   */
  test("the two 429s do not say the same thing", async () => {
    const ip = "203.0.113.14";
    const token = await signupToken("teller@example.test");
    for (let i = 0; i < 20; i++) await create(ip, token, NOT_A_NAME);

    const refusals = (await (await create(ip, token, NOT_A_NAME)).json()) as Refusal;
    expect(refusals.error).toBe("too_many_requests");
    expect(refusals.reason).toBe("failed_attempts");
    expect(refusals.message).toContain("refused in the last hour");
    expect(refusals.message).not.toContain("created 5 journals");
  });
});
