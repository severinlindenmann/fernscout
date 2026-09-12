import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import type { Mail } from "@/lib/mail/types";

/**
 * B857 — the mail that gets somebody in has to be in their language.
 *
 * A Hungarian tester signed up with `accept-language: hu` throughout and a
 * journal whose `defaultLocale` was `hu`, and every letter she was sent was
 * English — subject and body alike. Asked where she would stop, she said: at
 * the first one. The content layer was already fluent; the layer that gets a
 * person into it spoke one language.
 *
 * The rule these tests pin down, in order: the journal's `defaultLocale` when
 * a journal is known, the request's `accept-language` when none is, English
 * when neither names a language this instance ships chrome for. And the one
 * thing that is never translated — the journal's own title, which is the
 * owner's words in whatever language they chose (B316).
 */

const sent: Mail[] = [];

vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn(async (mail: Mail) => {
    sent.push(mail);
    return { transport: "test", reference: "test" };
  }),
  sendTransactional: vi.fn(async (mail: Mail) => {
    sent.push(mail);
    return { transport: "test", reference: "test" };
  }),
}));

/** The owner's own words, in their own language. Nothing may translate this. */
const TITLE = "Balkáni útinapló";
const JOURNAL = "hulog";
const OWNER = "owner@example.test";

let dir: string;
let caller = 0;

function post(url: string, body: unknown, acceptLanguage?: string) {
  caller += 1;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${caller}`,
      ...(acceptLanguage ? { "accept-language": acceptLanguage } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-mail-locale-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "57".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test", defaultUser: JOURNAL },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        signup: { enabled: true },
        mail: { enabled: true, transport: "console" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, JOURNAL, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, JOURNAL, "config.json"),
    JSON.stringify({
      title: TITLE,
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER },
      defaultLocale: "hu",
      locales: ["hu"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  vi.spyOn(console, "log").mockImplementation(() => {});

  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  sent.length = 0;
});

/** Subject and body together — a German body under an English subject reads
 * as a phishing attempt to exactly the person this task is for. */
function whole(mail: Mail): string {
  return `${mail.subject}\n${mail.text}`;
}

describe("a journal that says it is Hungarian gets Hungarian mail", () => {
  test("the sign-in code, subject and body", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    const response = await POST(
      post("https://example.test/api/auth/codes", {
        user: JOURNAL,
        email: "reader@example.test",
        for: "read",
      }),
    );
    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);

    expect(sent[0].subject).toBe(`Bejelentkezés ide: ${TITLE}`);
    expect(sent[0].text).toContain("Vagy jelentkezz be kézzel ezzel a kóddal:");
    expect(sent[0].text).toContain("Koppints a gombra");
    // Not a word of the English original survives, in either part.
    expect(whole(sent[0])).not.toContain("Sign in to");
    expect(whole(sent[0])).not.toContain("Tap the button");
    expect(sent[0].html).toContain("Vagy jelentkezz be kézzel ezzel a kóddal:");
    // The date the mail was asked for is written in the reader's language too,
    // with no doubled full stop where Hungarian already ends the day with one.
    expect(sent[0].text).toMatch(/Kérve ekkor: \d{2}:\d{2} UTC, \S+ \d+\. Ha van/);
  });

  test("the agent code, which arrives after the journal exists", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    const response = await POST(
      post("https://example.test/api/auth/codes", {
        user: JOURNAL,
        email: OWNER,
        for: "write",
      }),
    );
    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);

    expect(sent[0].subject).toBe("Az ügynökkódod ide: Testbed");
    expect(sent[0].text).toContain("Ügynök-hozzáférési kód");
    expect(whole(sent[0])).not.toContain("Your Fernscout agent code");
    expect(whole(sent[0])).not.toContain("Agent access code");
  });

  test("the journal's own title is carried through, never translated", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    await POST(
      post("https://example.test/api/auth/codes", {
        user: JOURNAL,
        email: "reader@example.test",
        for: "read",
      }),
    );
    expect(sent[0].subject).toContain(TITLE);
    expect(sent[0].text).toContain(TITLE);
  });

  test("the journal wins over a device asking for something else", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    await POST(
      post(
        "https://example.test/api/auth/codes",
        { user: JOURNAL, email: "reader@example.test", for: "read" },
        "de-DE,de;q=0.9",
      ),
    );
    expect(sent[0].subject).toBe(`Bejelentkezés ide: ${TITLE}`);
  });
});

describe("before a journal exists, the request's own language decides", () => {
  test("accept-language: de gets a German signup code", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    const response = await POST(
      post("https://example.test/api/auth/codes", { email: "neu@example.test", for: "signup" }, "de"),
    );
    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);

    expect(sent[0].subject).toBe("Dein Code, um auf Testbed ein Reisetagebuch zu beginnen");
    expect(sent[0].text).toContain("Dein Code lautet");
    expect(whole(sent[0])).not.toContain("Your code");
  });

  test("quality values are honoured, so hu;q=0.9 behind an unknown language still wins", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    await POST(
      post("https://example.test/api/auth/codes", { email: "uj@example.test", for: "signup" }, "sq,hu;q=0.9"),
    );
    expect(sent[0].subject).toBe("A kódod, amellyel útinaplót indíthatsz itt: Testbed");
  });

  test("a language this instance does not speak falls back to English", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    await POST(
      post("https://example.test/api/auth/codes", { email: "someone@example.test", for: "signup" }, "sq-AL"),
    );
    expect(sent[0].subject).toBe("Your code to start a journal on Testbed");
    expect(sent[0].text).toMatch(/Your code is \d{6}\./);
  });

  // B1134: the body field an agent sends on somebody's behalf wins outright
  // over whatever the request's own browser-set header says — no
  // reconciliation between the two, no warning either way.
  test("a locale in the body wins outright over accept-language", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    await POST(
      post(
        "https://example.test/api/auth/codes",
        { email: "kettonyelvu@example.test", locale: "hu", for: "signup" },
        "de",
      ),
    );
    expect(sent[0].subject).toBe("A kódod, amellyel útinaplót indíthatsz itt: Testbed");
  });

  test("no accept-language at all is English", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    await POST(post("https://example.test/api/auth/codes", { email: "quiet@example.test", for: "signup" }));
    expect(sent[0].subject).toBe("Your code to start a journal on Testbed");
  });
});
