import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

/**
 * Security review (D3/B2295) — `/{user}/i/<token>` was the personal invite's
 * own page. B2295 (one door for readers, B2291) removed it along with every
 * agent-reachable way to create a new `personal` invite (the v2/web doors
 * only ever write `guest` or `buddy` now — `INVITE_KINDS` in
 * `lib/api/v2/schemas/social.ts`), but an old `personal` row from before
 * that decision can still be sitting in `contact_invites`. Left alone,
 * `listInvitesWithLinks` would still build `/{user}/i/<token>` for it — an
 * address that 404s the moment anybody opens it.
 *
 * `url` is already `null` for a revoked, expired or undecryptable invite —
 * "the caller renders no copy action rather than an empty one" is this
 * file's own doc comment. A `personal` row joins that list for the same
 * reason: a link that cannot work is not something to hand the owner.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "invite-personal-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "88".repeat(32);
  process.env.SESSION_SECRET = "99".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "T",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
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
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a legacy personal invite is never handed a link", async () => {
  const { createInvite, listInvitesWithLinks } = await import("@/lib/contacts/invites");
  await createInvite(OWNER, { kind: "personal", name: "Old Link" });
  await createInvite(OWNER, { kind: "guest", name: "Ordinary Guest" });

  const invites = await listInvitesWithLinks(OWNER, "https://example.test");
  const personal = invites.find((i) => i.kind === "personal")!;
  const guest = invites.find((i) => i.kind === "guest")!;

  expect(personal.url).toBeNull();
  // The sibling guest invite still gets its ordinary link — this is not a
  // blanket "no links" regression.
  expect(guest.url).toContain("/invite/guest/");
});
