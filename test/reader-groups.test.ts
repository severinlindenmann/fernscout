import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Reader groups — TIX-6.
 *
 * The property everything here circles: **a group is a label for who is
 * told, never a way in or out.** A link's group sorts the people who ask
 * through it, but it never lets anybody in, never moves somebody who is
 * already in another group, and an id from another journal is refused rather
 * than stored. Deleting a group loses nobody their access.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
    delete: (name: string) => {
      delete jar.cookies[name];
    },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const OTHER = "blake";
const OTHER_EMAIL = "blake@example.test";
let dir: string;

function journalConfig(title: string, email: string) {
  return JSON.stringify({
    title,
    owner: { name: "Owner Person", nickname: "Owner", email },
    defaultLocale: "en",
    locales: ["en"],
    baseCurrency: "CHF",
    features: { auth: { enabled: true }, contacts: { enabled: true } },
  });
}

function writeConfigs() {
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
  for (const [user, title, email] of [
    [OWNER, "Two Backpacks", OWNER_EMAIL],
    [OTHER, "Blake's Book", OTHER_EMAIL],
  ]) {
    fs.mkdirSync(path.join(dir, user), { recursive: true });
    fs.writeFileSync(path.join(dir, user, "config.json"), journalConfig(title, email));
  }
}

function mails(to: string): string[] {
  const mailDir = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(mailDir)) return [];
  return fs
    .readdirSync(mailDir)
    .map((f) => fs.readFileSync(path.join(mailDir, f), "utf8"))
    .filter((eml) => eml.includes(`To: ${to}`))
    .map((eml) =>
      [...eml.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
        .map((m) => Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8"))
        .join("\n"),
    );
}
const lastCode = (text: string) => text.match(/(?<![#\w])(\d{6})(?!\w)/)?.[1] ?? "";
const codeMailed = (to: string) => lastCode(mails(to).at(-1) ?? "");

async function signIn(user: string, email: string) {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(user, email, "guest");
  const session = await verifyCode(user, email, code, "guest");
  if (!session.ok) throw new Error("sign-in failed");
  jar.cookies = { fs_session: session.token };
}

function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://example.test${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response) {
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function createGroupVia(user: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/web/[user]/groups/route");
  return json(await POST(req("POST", `/api/web/${user}/groups`, body, headers), { params: Promise.resolve({ user }) }));
}

async function groupId(name: string): Promise<string> {
  const { listGroups } = await import("@/lib/contacts/groups");
  return (await listGroups(OWNER)).find((g) => g.name === name)!.id;
}

async function newLink(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/web/[user]/invites/route");
  const res = await POST(req("POST", `/api/web/${OWNER}/invites`, body), { params: Promise.resolve({ user: OWNER }) });
  const out = (await res.json()) as { joinUrl?: string; error?: string; group?: string | null };
  return { status: res.status, body: out, code: out.joinUrl?.split("/j/")[1] ?? "" };
}

async function joinStep(code: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/j/[code]/step/route");
  const res = await POST(req("POST", `/j/${code}/step`, body), { params: Promise.resolve({ code }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function joinAs(code: string, name: string, email: string) {
  const owner = { ...jar.cookies };
  jar.cookies = {};
  await joinStep(code, { action: "send", name, channel: "email", value: email });
  const out = await joinStep(code, { action: "verify", name, channel: "email", value: email, code: codeMailed(email) });
  jar.cookies = owner;
  return out;
}

async function contactByEmail(email: string) {
  const { getContactByEmail } = await import("@/lib/contacts");
  return (await getContactByEmail(OWNER, email))!;
}

async function setGroup(contactId: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/web/[user]/readers/group/route");
  return json(await POST(req("POST", `/api/web/${OWNER}/readers/group`, { contactId, ...body }), { params: Promise.resolve({ user: OWNER }) }));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tix6-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  writeConfigs();
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
  await signIn(OWNER, OWNER_EMAIL);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the owner's own groups", () => {
  test("create, refuse a duplicate name and an empty or long one", async () => {
    expect((await createGroupVia(OWNER, { name: "Family" })).status).toBe(201);
    expect((await createGroupVia(OWNER, { name: "Friends", color: 1 })).status).toBe(201);
    expect((await createGroupVia(OWNER, { name: " family " })).body?.error).toBe("duplicate_name");
    expect((await createGroupVia(OWNER, { name: "" })).body?.error).toBe("invalid_name");
    expect((await createGroupVia(OWNER, { name: "x".repeat(31) })).body?.error).toBe("invalid_name");
  });

  test("at most GROUP_LIMIT groups", async () => {
    const { GROUP_LIMIT, listGroups } = await import("@/lib/contacts/groups");
    const have = (await listGroups(OWNER)).length;
    for (let i = have; i < GROUP_LIMIT; i++) expect((await createGroupVia(OWNER, { name: `G${i}` })).status).toBe(201);
    expect((await createGroupVia(OWNER, { name: "One too many" })).body?.error).toBe("too_many");
    const { deleteGroup } = await import("@/lib/contacts/groups");
    for (const g of (await listGroups(OWNER)).filter((g) => g.name.startsWith("G"))) await deleteGroup(OWNER, g.id);
  });

  test("only the owner's cookie opens the door; a bearer token and a stranger are refused", async () => {
    expect((await createGroupVia(OWNER, { name: "Nope" }, { authorization: "Bearer fs_agent_x" })).status).toBe(403);
    jar.cookies = {};
    expect((await createGroupVia(OWNER, { name: "Nope" })).status).toBe(403);
    await signIn(OTHER, OTHER_EMAIL);
    expect((await createGroupVia(OWNER, { name: "Nope" })).status).toBe(403);
  });
});

describe("invite links carry a group", () => {
  test("a link refuses another journal's group id", async () => {
    await signIn(OTHER, OTHER_EMAIL);
    expect((await createGroupVia(OTHER, { name: "Theirs" })).status).toBe(201);
    const { listGroups } = await import("@/lib/contacts/groups");
    const theirs = (await listGroups(OTHER))[0].id;
    await signIn(OWNER, OWNER_EMAIL);
    const link = await newLink({ kind: "guest", name: "Sneaky", group: theirs });
    expect(link.status).toBe(404);
  });

  test("somebody new who asks through the link waits, in the link's group — and is not let in", async () => {
    const family = await groupId("Family");
    const link = await newLink({ kind: "guest", name: "Family chat", group: family });
    expect(link.status).toBe(201);
    expect(link.body.group).toBe(family);
    const out = await joinAs(link.code, "Marco Rossi", "marco@example.test");
    expect(out.json.status).toBe("waiting");
    const marco = await contactByEmail("marco@example.test");
    expect(marco.status).toBe("pending");
    expect(marco.groupId).toBe(family);
    expect(marco.askedGroupId).toBeNull();
  });

  test("somebody already in another group is not moved; the offer waits for Keep or Move", async () => {
    const family = await groupId("Family");
    const friends = await groupId("Friends");
    const friendsLink = await newLink({ kind: "guest", name: "Friends chat", group: friends });
    await joinAs(friendsLink.code, "Chris Meier", "chris@example.test");
    const chris = await contactByEmail("chris@example.test");
    expect(chris.groupId).toBe(friends);

    const familyLink = await newLink({ kind: "guest", name: "Family chat 2", group: family });
    await joinAs(familyLink.code, "Chris Meier", "chris@example.test");
    const again = await contactByEmail("chris@example.test");
    expect(again.groupId).toBe(friends);
    expect(again.askedGroupId).toBe(family);

    expect((await setGroup(again.id, { asked: "move" })).status).toBe(200);
    const moved = await contactByEmail("chris@example.test");
    expect(moved.groupId).toBe(family);
    expect(moved.askedGroupId).toBeNull();
    expect((await setGroup(again.id, { asked: "keep" })).status).toBe(409);
  });

  test("Keep answers the question without moving them, and Let in still works after", async () => {
    const family = await groupId("Family");
    const friends = await groupId("Friends");
    const link = await newLink({ kind: "guest", name: "Friends 2", group: friends });
    await joinAs(link.code, "Dana Keep", "dana@example.test");
    const familyLink = await newLink({ kind: "guest", name: "Family 3", group: family });
    await joinAs(familyLink.code, "Dana Keep", "dana@example.test");
    const dana = await contactByEmail("dana@example.test");
    expect(dana.askedGroupId).toBe(family);
    expect((await setGroup(dana.id, { asked: "keep" })).status).toBe(200);
    const { POST } = await import("@/app/api/web/[user]/readers/letin/route");
    const res = await POST(req("POST", `/api/web/${OWNER}/readers/letin`, { contactId: dana.id }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(res.status).toBe(200);
    const after = await contactByEmail("dana@example.test");
    expect(after.status).toBe("active");
    expect(after.groupId).toBe(friends);
    expect(after.askedGroupId).toBeNull();
  });
});

describe("moving one person", () => {
  test("into a group, into none, and never into another journal's group", async () => {
    const friends = await groupId("Friends");
    const marco = await contactByEmail("marco@example.test");
    expect((await setGroup(marco.id, { group: friends })).status).toBe(200);
    expect((await contactByEmail("marco@example.test")).groupId).toBe(friends);
    expect((await setGroup(marco.id, { group: null })).status).toBe(200);
    expect((await contactByEmail("marco@example.test")).groupId).toBeNull();
    const { listGroups } = await import("@/lib/contacts/groups");
    const theirs = (await listGroups(OTHER))[0].id;
    expect((await setGroup(marco.id, { group: theirs })).status).toBe(404);
    expect((await contactByEmail("marco@example.test")).groupId).toBeNull();
  });

  test("Add a person takes a group, and refuses one that is not the owner's", async () => {
    const { POST } = await import("@/app/api/web/[user]/readers/route");
    const family = await groupId("Family");
    const ok = await POST(req("POST", `/api/web/${OWNER}/readers`, { name: "Eva Graf", email: "eva@example.test", group: family }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(ok.status).toBe(200);
    expect((await contactByEmail("eva@example.test")).groupId).toBe(family);
    const bad = await POST(req("POST", `/api/web/${OWNER}/readers`, { name: "Fay", email: "fay@example.test", group: "nope" }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(bad.status).toBe(404);
  });
});

describe("deleting a group", () => {
  test("lets go of its people and links, keeps their access, and Undo puts them back", async () => {
    const family = await groupId("Family");
    const eva = await contactByEmail("eva@example.test");
    expect(eva.status).toBe("active");
    const { DELETE } = await import("@/app/api/web/[user]/groups/[id]/route");
    const deleted = await json(
      await DELETE(req("DELETE", `/api/web/${OWNER}/groups/${family}`), { params: Promise.resolve({ user: OWNER, id: family }) }),
    );
    expect(deleted.status).toBe(200);
    const members = deleted.body?.members as { contactIds: string[]; inviteIds: string[] };
    expect(members.contactIds).toContain(eva.id);
    expect(members.inviteIds.length).toBeGreaterThan(0);
    const after = await contactByEmail("eva@example.test");
    expect(after.groupId).toBeNull();
    expect(after.status).toBe("active");
    const { hasReadGrant } = await import("@/lib/grants");
    expect(await hasReadGrant(OWNER, eva.id, new Date())).toBe(true);

    const restored = await createGroupVia(OWNER, { name: "Family", members });
    expect(restored.status).toBe(201);
    const newId = (restored.body?.group as { id: string }).id;
    expect((await contactByEmail("eva@example.test")).groupId).toBe(newId);
  });

  test("a link whose group is gone puts nobody anywhere", async () => {
    const { createGroup, deleteGroup } = await import("@/lib/contacts/groups");
    const temp = await createGroup(OWNER, { name: "Temp" });
    if (!temp.ok) throw new Error("setup");
    const link = await newLink({ kind: "guest", name: "Temp link", group: temp.value.id });
    await deleteGroup(OWNER, temp.value.id);
    await joinAs(link.code, "Gil Late", "gil@example.test");
    expect((await contactByEmail("gil@example.test")).groupId).toBeNull();
  });
});
