import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  CODE_TTL_MINUTES,
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  RELAY_LINK_TTL_MS,
  SESSION_SCOPE,
  SESSION_TTL_MS,
  generateCode,
  issueCode,
  issueRelayLink,
  issueStandingLink,
  listSessions,
  resolveSession,
  revokeCodes,
  revokeSession,
  verifyCode,
  verifyLink,
  signInUrl,
} from "@/lib/auth";

/**
 * The whole flow, with no mail account and no database server: SQLite in a temp
 * file, codes read straight from the return value the mail would have carried.
 */

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-auth-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  // The TTL tests move the clock. Left set, the offset leaks into every test
  // that runs after them in this file and expiry assertions start depending on
  // execution order.
  vi.useRealTimers();
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.AUTH_DEV_CODE;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("codes", () => {
  test("are six digits", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  test("AUTH_DEV_CODE fixes the code, so end-to-end tests need no inbox", () => {
    process.env.AUTH_DEV_CODE = "123456";
    expect(generateCode()).toBe("123456");
  });

  /**
   * What a route does when the mail it just issued a code for will not send.
   *
   * The code is written before the mail goes out, and issuing one consumes
   * every earlier one — so a send that throws used to leave a live code nobody
   * had been told about, having just killed the one the person still had in
   * their inbox. `revokeCodes` is what the routes call to put that right.
   */
  test("revokeCodes takes back a code that was never sent", async () => {
    const { code } = await issueCode("ana", "reader@example.test", "guest");
    await revokeCodes("ana", "reader@example.test", "guest");
    expect((await verifyCode("ana", "reader@example.test", code, "guest")).ok).toBe(false);
  });

  test("revoking one address's code leaves another's alone", async () => {
    const mine = await issueCode("ana", "reader@example.test", "guest");
    const theirs = await issueCode("ana", "other@example.test", "guest");
    await revokeCodes("ana", "reader@example.test", "guest");
    expect((await verifyCode("ana", "reader@example.test", mine.code, "guest")).ok).toBe(false);
    expect((await verifyCode("ana", "other@example.test", theirs.code, "guest")).ok).toBe(true);
  });

  test("and leaves a code of a different kind for the same address alone", async () => {
    const guest = await issueCode("ana", "reader@example.test", "guest");
    await revokeCodes("ana", "reader@example.test", "agent");
    expect((await verifyCode("ana", "reader@example.test", guest.code, "guest")).ok).toBe(true);
  });

  /**
   * B40. The window is a product decision, not a security parameter — what
   * stops guessing is the attempt counter, not the clock. These pin the
   * decision so a future edit to `CODE_TTL_MS` is a deliberate one.
   */
  test("a code still works after twenty-five minutes", async () => {
    const { code } = await issueCode("ana", "reader@example.test", "guest");
    vi.setSystemTime(new Date(Date.now() + 25 * 60 * 1000));
    expect((await verifyCode("ana", "reader@example.test", code, "guest")).ok).toBe(true);
  });

  test("and not after thirty-five", async () => {
    const { code } = await issueCode("ana", "reader@example.test", "guest");
    vi.setSystemTime(new Date(Date.now() + 35 * 60 * 1000));
    expect((await verifyCode("ana", "reader@example.test", code, "guest")).ok).toBe(false);
  });

  test("the published number matches the enforced one", () => {
    // Three locale files and four mail bodies quote this. They interpolate
    // CODE_TTL_MINUTES rather than spelling it out, and this is what keeps the
    // two definitions from drifting the way "ten minutes" did.
    expect(CODE_TTL_MINUTES).toBe(String(CODE_TTL_MS / 60_000));
    expect(CODE_TTL_MS).toBe(30 * 60 * 1000);
  });

  test("a correct code produces a session", async () => {
    const { code } = await issueCode("ana", "reader@example.test", "guest");
    const result = await verifyCode("ana", "reader@example.test", code, "guest");
    expect(result.ok).toBe(true);
  });

  test("the address is matched case-insensitively", async () => {
    const { code } = await issueCode("ana", "Reader@Example.test", "guest");
    const result = await verifyCode("ana", "reader@EXAMPLE.test", code, "guest");
    expect(result.ok).toBe(true);
  });

  test("a code is single use", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    expect((await verifyCode("ana", "r@example.test", code, "guest")).ok).toBe(true);
    expect((await verifyCode("ana", "r@example.test", code, "guest")).ok).toBe(false);
  });

  test("requesting a new code invalidates the previous one", async () => {
    const first = await issueCode("ana", "r@example.test", "guest");
    await issueCode("ana", "r@example.test", "guest");
    const result = await verifyCode("ana", "r@example.test", first.code, "guest");
    expect(result.ok).toBe(false);
  });

  test("a wrong code five times burns it, and the right one then fails too", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect((await verifyCode("ana", "r@example.test", "000000", "guest")).ok).toBe(false);
    }
    const result = await verifyCode("ana", "r@example.test", code, "guest");
    expect(result.ok).toBe(false);
  });

  test("a code for one user does not work for another", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    expect((await verifyCode("bea", "r@example.test", code, "guest")).ok).toBe(false);
  });

  /** A read code must never be redeemable for a token that writes. */
  test("a guest code cannot be redeemed as an agent code", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    expect((await verifyCode("ana", "r@example.test", code, "agent")).ok).toBe(false);
  });

  test("an expired code is refused", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    const { db } = await getDatabase();
    await db
      .updateTable("login_codes")
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .execute();
    expect((await verifyCode("ana", "r@example.test", code, "guest")).ok).toBe(false);
  });

  test("the code is never stored in the clear", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    const { db } = await getDatabase();
    const rows = await db.selectFrom("login_codes").selectAll().execute();
    expect(rows[0].code_hash).not.toBe(code);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * B27. The welcome mail's link. It is the owner's first way into their own
 * journal, where an agent has just left drafts inside a private trip — both
 * invisible without a session — and it may be opened a week later.
 */
describe("the standing sign-in link", () => {
  test("still works long after an ordinary code would have expired", async () => {
    const token = await issueStandingLink("ana", "owner@example.test");
    vi.setSystemTime(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));
    expect((await verifyLink("ana", token)).ok).toBe(true);
  });

  /**
   * The property the whole design turns on. `issueCode` supersedes outstanding
   * codes for an address, and before this the sweep took the welcome link with
   * them — so "permanent" ended the first time the owner asked to sign in,
   * which is the most likely next thing to happen.
   */
  test("survives the owner asking for an ordinary code", async () => {
    const token = await issueStandingLink("ana", "owner@example.test");
    await issueCode("ana", "owner@example.test", "guest");
    expect((await verifyLink("ana", token)).ok).toBe(true);
  });

  test("and survives that code being redeemed", async () => {
    const token = await issueStandingLink("ana", "owner@example.test");
    const { code } = await issueCode("ana", "owner@example.test", "guest");
    expect((await verifyCode("ana", "owner@example.test", code, "guest")).ok).toBe(true);
    expect((await verifyLink("ana", token)).ok).toBe(true);
  });

  /**
   * What bounds a permanent link. Exposure is the risk with any link — they
   * are prefetched by scanners and pasted into chat windows — and single use
   * is what stops it being replayable for ever.
   */
  test("is single use, which is what makes permanence safe", async () => {
    const token = await issueStandingLink("ana", "owner@example.test");
    expect((await verifyLink("ana", token)).ok).toBe(true);
    expect((await verifyLink("ana", token)).ok).toBe(false);
  });

  test("produces a guest session and never an agent one", async () => {
    // Decision 24. Reading the journal on your phone must not put a credential
    // that can rewrite it in your pocket.
    const token = await issueStandingLink("ana", "owner@example.test");
    const result = await verifyLink("ana", token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toBe(SESSION_SCOPE.guest);
    expect(await resolveSession(result.token, "agent")).toBeNull();
  });

  test("carries no code anybody could be given", async () => {
    // The row needs a code_hash because the column is NOT NULL. The value
    // hashed is generated and never returned, so there is no code in existence
    // that could redeem the row and retire its link.
    await issueStandingLink("ana", "owner@example.test");
    const { db } = await getDatabase();
    const row = await db
      .selectFrom("login_codes")
      .selectAll()
      .where("link_standing", "=", 1)
      .executeTakeFirstOrThrow();
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    // Six digits is the entire space a code could occupy.
    for (const guess of ["000000", "123456", "999999"]) {
      expect((await verifyCode("ana", "owner@example.test", guess, "guest")).ok).toBe(false);
    }
  });

  test("one journal's standing link does not open another's", async () => {
    const token = await issueStandingLink("ana", "owner@example.test");
    expect((await verifyLink("bea", token)).ok).toBe(false);
  });

  test("an ordinary link still expires with its code", async () => {
    // The default must not have moved. Every row written before this change,
    // and every one written by `issueCode`, dies with the code beside it.
    const { linkToken } = await issueCode("ana", "reader@example.test", "guest");
    vi.setSystemTime(new Date(Date.now() + 35 * 60 * 1000));
    expect((await verifyLink("ana", linkToken!)).ok).toBe(false);
  });
});

/**
 * B29 — the link an agent hands over in the conversation.
 *
 * The author's decision was that an agent may carry an authentication URL: it
 * already holds an agent token for the same journal, which is strictly more
 * powerful, so the link grants it nothing new. What *is* new is that a
 * credential belonging to the person passes through a transcript — and a
 * transcript outlives the conversation. Hence a short life, which is the only
 * thing separating this from the welcome mail's permanent one.
 */
describe("the relayed sign-in link", () => {
  test("works, and produces a guest session like any other link", async () => {
    const token = await issueRelayLink("ana", "owner@example.test");
    const result = await verifyLink("ana", token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toBe(SESSION_SCOPE.guest);
    // Decision 24 holds: a reading credential never becomes a writing one.
    expect(await resolveSession(result.token, "agent")).toBeNull();
  });

  test("is single use", async () => {
    const token = await issueRelayLink("ana", "owner@example.test");
    expect((await verifyLink("ana", token)).ok).toBe(true);
    expect((await verifyLink("ana", token)).ok).toBe(false);
  });

  /** The property that makes it safe to put in a transcript. */
  test("expires, unlike the mail's copy", async () => {
    const relay = await issueRelayLink("ana", "owner@example.test");
    const standing = await issueStandingLink("ana", "owner@example.test");

    vi.setSystemTime(new Date(Date.now() + RELAY_LINK_TTL_MS + 60_000));

    expect((await verifyLink("ana", relay)).ok).toBe(false);
    // The one in the inbox is unaffected — that is the whole difference.
    expect((await verifyLink("ana", standing)).ok).toBe(true);
  });

  test("is still live a minute after it was issued", async () => {
    const token = await issueRelayLink("ana", "owner@example.test");
    vi.setSystemTime(new Date(Date.now() + 60_000));
    expect((await verifyLink("ana", token)).ok).toBe(true);
  });

  test("does not survive an ordinary code being issued", async () => {
    // It is not standing, so `revokeCodes` sweeps it — correct, and the
    // opposite of the welcome link, which must survive exactly that.
    const relay = await issueRelayLink("ana", "owner@example.test");
    const standing = await issueStandingLink("ana", "owner@example.test");
    await issueCode("ana", "owner@example.test", "guest");

    expect((await verifyLink("ana", relay)).ok).toBe(false);
    expect((await verifyLink("ana", standing)).ok).toBe(true);
  });

  test("carries no code anybody could be given", async () => {
    await issueRelayLink("ana", "owner@example.test");
    for (const guess of ["000000", "123456", "999999"]) {
      expect((await verifyCode("ana", "owner@example.test", guess, "guest")).ok).toBe(false);
    }
  });
});

describe("sessions", () => {
  async function login(kind: "guest" | "agent") {
    const { code } = await issueCode("ana", "r@example.test", kind);
    const result = await verifyCode("ana", "r@example.test", code, kind);
    if (!result.ok) throw new Error("expected the login to succeed");
    return result;
  }

  test("a guest session lasts about a year, an agent token seven days", async () => {
    const guest = await login("guest");
    const agent = await login("agent");
    const days = (iso: string) => (new Date(iso).getTime() - Date.now()) / 86_400_000;
    expect(days(guest.expiresAt)).toBeGreaterThan(360);
    expect(days(agent.expiresAt)).toBeGreaterThan(6);
    expect(days(agent.expiresAt)).toBeLessThan(8);
    expect(SESSION_TTL_MS.agent).toBeLessThan(SESSION_TTL_MS.guest);
  });

  test("scopes differ: agents write, guests read", async () => {
    expect((await login("agent")).scope).toBe("write:content");
    expect((await login("guest")).scope).toBe("read");
  });

  test("a token resolves to its session", async () => {
    const { token } = await login("guest");
    const session = await resolveSession(token, "guest");
    expect(session?.email).toBe("r@example.test");
    expect(session?.owner).toBe("ana");
  });

  /** The crossover guard: two classes, two channels, no interchange. */
  test("an agent token is refused where a guest cookie is expected", async () => {
    const { token } = await login("agent");
    expect(await resolveSession(token, "guest")).toBeNull();
    expect(await resolveSession(token, "agent")).not.toBeNull();
  });

  test("a guest cookie is refused where a bearer token is expected", async () => {
    const { token } = await login("guest");
    expect(await resolveSession(token, "agent")).toBeNull();
  });

  test("an unknown or empty token resolves to nothing", async () => {
    expect(await resolveSession("fs_guest_nonsense", "guest")).toBeNull();
    expect(await resolveSession(undefined, "guest")).toBeNull();
    expect(await resolveSession("", "guest")).toBeNull();
  });

  test("revoking stops the very next request", async () => {
    const { token } = await login("guest");
    const session = await resolveSession(token, "guest");
    await revokeSession(session!.id);
    expect(await resolveSession(token, "guest")).toBeNull();
  });

  test("an expired session is refused", async () => {
    const { token } = await login("guest");
    const { db } = await getDatabase();
    await db
      .updateTable("sessions")
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .execute();
    expect(await resolveSession(token, "guest")).toBeNull();
  });

  test("the token is never stored in the clear", async () => {
    const { token } = await login("guest");
    const { db } = await getDatabase();
    const rows = await db.selectFrom("sessions").selectAll().execute();
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the admin listing shows sessions and never a token", async () => {
    await login("guest");
    const rows = await listSessions("ana");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("fs_guest_");
  });

  test("sessions are scoped to their owner", async () => {
    await login("guest");
    expect(await listSessions("bea")).toHaveLength(0);
  });
});

/**
 * The one-click link in a sign-in email.
 *
 * The link and the six-digit code are two credentials on one row, and the
 * whole design rests on them being consumed *separately* — see
 * `005-signin-link`. These are the tests that hold that apart.
 */
describe("the sign-in link", () => {
  test("a guest code carries one; an agent code does not", async () => {
    const guest = await issueCode("ana", "reader@example.test", "guest");
    expect(guest.linkToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    // An agent is a program with no cookie jar. A URL that silently opens a
    // browser session is the wrong shape of credential to mail one.
    const agent = await issueCode("ana", "reader@example.test", "agent");
    expect(agent.linkToken).toBeUndefined();
  });

  test("redeeming it opens a read session and nothing wider", async () => {
    const { linkToken } = await issueCode("ana", "reader@example.test", "guest");
    const result = await verifyLink("ana", linkToken!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^fs_guest_/);
    expect(result.scope).toBe("read");
  });

  test("it works exactly once", async () => {
    const { linkToken } = await issueCode("ana", "reader@example.test", "guest");
    expect((await verifyLink("ana", linkToken!)).ok).toBe(true);
    expect((await verifyLink("ana", linkToken!)).ok).toBe(false);
  });

  test("a link followed by a mail scanner does not cost the reader their code", async () => {
    // The failure this whole split exists to prevent: a corporate scanner
    // fetches every URL in an incoming message, and the reader — who has not
    // even opened it yet — finds their code already spent.
    const { code, linkToken } = await issueCode("ana", "reader@example.test", "guest");
    await verifyLink("ana", linkToken!);

    const byHand = await verifyCode("ana", "reader@example.test", code, "guest");
    expect(byHand.ok).toBe(true);
  });

  test("but using the code retires the link with it", async () => {
    const { code, linkToken } = await issueCode("ana", "reader@example.test", "guest");
    expect((await verifyCode("ana", "reader@example.test", code, "guest")).ok).toBe(true);
    expect((await verifyLink("ana", linkToken!)).ok).toBe(false);
  });

  test("an expired link is refused", async () => {
    const { linkToken } = await issueCode("ana", "reader@example.test", "guest");
    const { db } = await getDatabase();
    await db
      .updateTable("login_codes")
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .execute();
    const result = await verifyLink("ana", linkToken!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  test("asking for a new code invalidates the previous link", async () => {
    const first = await issueCode("ana", "reader@example.test", "guest");
    await issueCode("ana", "reader@example.test", "guest");
    expect((await verifyLink("ana", first.linkToken!)).ok).toBe(false);
  });

  test("a link cannot be redeemed against another journal", async () => {
    const { linkToken } = await issueCode("ana", "reader@example.test", "guest");
    expect((await verifyLink("bea", linkToken!)).ok).toBe(false);
  });

  test("a guest link cannot be redeemed as an agent token", async () => {
    // The kinds are not interchangeable — decision 24. If this ever passes,
    // a link mailed to a reader has become a credential that can write.
    const { linkToken } = await issueCode("ana", "reader@example.test", "guest");
    expect((await verifyLink("ana", linkToken!, "agent")).ok).toBe(false);
  });

  test("the token is never stored in the clear", async () => {
    const { linkToken } = await issueCode("ana", "reader@example.test", "guest");
    const { db } = await getDatabase();
    const rows = await db.selectFrom("login_codes").selectAll().execute();
    expect(rows[0].link_hash).not.toBe(linkToken);
    expect(rows[0].link_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a made-up token is refused", async () => {
    await issueCode("ana", "reader@example.test", "guest");
    expect((await verifyLink("ana", "not-a-real-token")).ok).toBe(false);
  });

  test("the url carries no address, only the token", async () => {
    // A forwarded link must not also disclose who reads this journal.
    const url = signInUrl("https://x.test", "ana", "TOKEN123");
    expect(url).toBe("https://x.test/ana/s/TOKEN123");
    expect(url).not.toContain("@");
  });
});
