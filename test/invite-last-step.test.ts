import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B937 — the step nobody was told about.
 *
 * The invitation works, and the reader's path has a fourth step that is
 * invisible from every screen: she opens the link, names herself, proves her
 * address with a mailed code, and lands `pending`. The owner approves her.
 * **She still cannot read anything**, because confirming a contact who was not
 * pre-approved deliberately sets no session cookie (`approveContact` is the
 * only thing that grants, and a pending contact holds nothing). What opens the
 * journal is the approval mail — one press on the standing link
 * `sendApprovedMail` has carried since B319, spent through `/{user}/s/…` the
 * way B142 built it.
 *
 * The mechanism is right and is not touched here. What was missing is that
 * anybody says so, and there are two halves to that:
 *
 * - **the path is really walkable end to end** — asserted below by walking it,
 *   with no second sign-in anybody had to guess at; and
 * - **both people are told about the last step** — the reader on the queue
 *   screen, the owner when the link is handed over, in every maintained
 *   language.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const READER = "daughter@example.test";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

/** The text/plain part of a `.eml`, decoded — `test/invite-one-click.test.ts`. */
function plainTextOf(eml: string): string {
  const part = eml.split(/--fs-[\w-]+\r?\n/).find((p) => p.includes("text/plain"));
  const body = part?.split(/\r?\n\r?\n/).slice(1).join("\n") ?? "";
  return Buffer.from(body.replace(/\r?\n/g, ""), "base64").toString("utf8");
}

function mailsTo(email: string): string[] {
  const mailDir = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(mailDir)) return [];
  const slug = email.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return fs
    .readdirSync(mailDir)
    .filter((f) => f.includes(slug))
    .sort()
    .map((f) => plainTextOf(fs.readFileSync(path.join(mailDir, f), "utf8")));
}

/** Ana's own guest-cookie session — `/api/contacts/admin` refuses any
 *  `Authorization` header outright since the security review (F5, B2295). */
async function signInOwnerCookie(): Promise<void> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!result.ok) throw new Error("no owner cookie");
  jar.cookies.fs_session = result.token;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-last-step-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "cc".repeat(32);
  process.env.SESSION_SECRET = "dd".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

describe("a reader who follows every instruction reaches the journal", () => {
  test("link, code, queue, approval — and the approval mail is the way in", async () => {
    // The owner's link, handed over — `invitePutResponse` directly, the way
    // `/api/web/[user]/invites` (Studio › Readers' own door) makes one now.
    // B2295 (one door for readers, B2291) removed the agent bearer route
    // this used to go through.
    const invites = await import("@/lib/contacts/invitesResponse");
    const inviteId = crypto.randomUUID();
    const made = (await (
      await invites.invitePutResponse(
        OWNER,
        inviteId,
        new Request(`https://example.test/api/web/ana/invites`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({ kind: "guest" }),
        }),
      )
    ).json()) as { url?: string };
    const link = made.url?.split("/").pop();
    expect(link).toBeTruthy();

    // She opens it and names herself. A code is mailed.
    const redeem = await import("@/app/api/contacts/redeem/route");
    const ask = async (body: Record<string, unknown>) =>
      (await (
        await redeem.POST(
          new Request("https://example.test/api/contacts/redeem", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ user: OWNER, kind: "guest", token: link, ...body }),
          }),
        )
      ).json()) as { status?: string };
    jar.cookies = {};
    expect(await ask({ name: "Mira", email: READER })).toEqual({ status: "code" });

    const code = mailsTo(READER)[0]?.match(/\b(\d{6})\b/)?.[1];
    expect(code, "the code mail").toBeTruthy();

    const confirm = await import("@/app/api/contacts/confirm/route");
    const confirmed = await confirm.POST(
      new Request("https://example.test/api/contacts/confirm", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: OWNER, email: READER, code }),
      }),
    );
    expect((await confirmed.json()) as { status?: string }).toMatchObject({ status: "pending" });

    // She is in the queue and holds nothing — the mechanism this ticket does
    // not change. Whatever the confirmation did, it did not sign her in.
    const { getContactByEmail } = await import("@/lib/contacts");
    const row = await getContactByEmail(OWNER, READER);
    expect(row?.status).toBe("pending");
    const { isJournalGuest } = await import("@/lib/contacts/session");
    expect(await isJournalGuest(OWNER)).toBe(false);

    // The owner approves, on their own page. This is the only thing that
    // grants, and it is where the mail she needs is sent from.
    // `/api/contacts/admin` refuses any bearer outright since the security
    // review (F5, B2295) — the owner's own cookie is the only door now.
    await signInOwnerCookie();
    const admin = await import("@/app/api/contacts/admin/route");
    const approved = await admin.POST(
      new Request("https://example.test/api/contacts/admin", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: OWNER, action: "approve", id: row!.id }),
      }),
    );
    expect(approved.status).toBe(200);

    // **The last step arrives rather than having to be sought.** No second
    // request for a code, no six digits to find: the approval letter carries
    // the standing link, and pressing it is the whole of it.
    const letter = mailsTo(READER).at(-1) ?? "";
    const signIn = letter.match(/https:\/\/example\.test\/ana\/s\/([\w-]+)/);
    expect(signIn, "the approval mail must carry the sign-in link").not.toBeNull();

    const auth = await import("@/app/api/auth/links/redeem/route");
    const spent = await auth.POST(
      new Request("https://example.test/api/auth/links/redeem", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: OWNER, token: signIn![1], for: "read" }),
      }),
    );
    expect(spent.status).toBe(200);

    // And now she is in.
    expect(await isJournalGuest(OWNER), "the approval mail is the way in").toBe(true);
  });
});

describe("both of them are told about it", () => {
  /**
   * The sentence each screen has to keep, per language. A phrase rather than
   * a whole string, so wording may be improved without this failing — but the
   * claim itself ("a mail signs you in") cannot be dropped silently.
   */
  const READER_SAYS = { en: "signs you in", de: "anmeldet", hu: "beléptet" };
  const OWNER_SAYS = { en: "signs them in", de: "anmeldet", hu: "belépteti" };

  test.each(MAINTAINED_LOCALES)("%s", async (locale) => {
    const { translateIn } = await import("@/lib/locales");
    // The reader, on the "you are in the queue" screen.
    expect(translateIn(locale, "invite.waitingBody", { title: "T" })).toContain(
      READER_SAYS[locale],
    );
    // The owner, wherever the link is handed over: the panel on their own
    // pages. `agent.tool.inviteGuestDone` used to say the same thing from the
    // conversation — B2295 (one door for readers, B2291) removed the tool it
    // belonged to.
    expect(translateIn(locale, "me.inviteGuestBody")).toContain(OWNER_SAYS[locale]);
  });
});
