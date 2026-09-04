import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { sendMail, sendMailWith } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { buildMessage } from "@/lib/mail/rfc822";

let dir: string;

function writeConfig(mail: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { mail },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

/**
 * A journal on disk, with its own answer to `features.mail`.
 *
 * The fixture used to be a bare `mkdir`, which was enough while `sendMail`
 * asked only the server whether it could send. Since B60 it asks the journal
 * too, and a directory with no `config.json` is not a journal at all — so
 * "ana" has to be one, and saying whether her mail is on is the whole point of
 * most of what follows.
 */
function writeJournal(username: string, mail: boolean) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: "A journal",
      owner: { name: "Ana", nickname: "Ana", email: "ana@example.test" },
      features: { mail: { enabled: mail } },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-mail-"));
  process.env.CONTENT_DIR = dir;
  writeJournal("ana", true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.MAIL_FROM;
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const SAMPLE = {
  preheader: "Three new days",
  title: "Three new days since you last looked",
  blocks: [
    { kind: "paragraph" as const, text: "Here is what happened." },
    { kind: "item" as const, title: "Hoi An", meta: "26 August", href: "https://x.test/a" },
    { kind: "button" as const, text: "Read the trip", href: "https://x.test" },
  ],
  footer: "You are getting this because you asked to follow the trip.",
  unsubscribeUrl: "https://x.test/stop?t=abc",
};

/**
 * B135. Nothing in the codebase ever deleted a `.eml`. B57 accepted that on the
 * reasoning that an operator turns `keepCopy` on to debug something and turns
 * it off again — but it has been on at fernscout.ch for days, and since B111
 * these files live inside `CONTENT_DIR`, which `scripts/backup.sh` archives
 * wholesale. A journal-deletion link or a guest invitation is single-use but
 * long-lived, so an old copy is a live credential in a directory nobody
 * revisits, now also propagating into every snapshot.
 *
 * The lifetime is enforced by the only thing that has to know mail exists: the
 * function that writes it.
 */
describe("kept mail expires", () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** Backdate a file the way age is actually judged — by mtime. */
  function age(file: string, ms: number) {
    const when = new Date(Date.now() - ms);
    fs.utimesSync(file, when, when);
  }

  async function sendOne(subject: string) {
    writeConfig({ enabled: true, transport: "file" });
    const result = await sendMail(renderMail("ana@example.test", subject, SAMPLE, "ana"));
    if (!result) throw new Error("mail was not sent");
    return result;
  }

  test("a stale .eml is gone after the next message, and a fresh one is not", async () => {
    const first = await sendOne("the old one");
    const mailDir = path.dirname(first.reference);

    const fresh = path.join(mailDir, "fresh.eml");
    fs.writeFileSync(fresh, "still wanted");
    age(first.reference, 3 * DAY);
    age(fresh, 1 * DAY);

    await sendOne("the new one");

    expect(fs.existsSync(first.reference)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  test("the message just written is never swept by its own write", async () => {
    const result = await sendOne("keep me");
    expect(fs.existsSync(result.reference)).toBe(true);
  });

  test("only .eml files are touched", async () => {
    const first = await sendOne("one");
    const mailDir = path.dirname(first.reference);

    const bystander = path.join(mailDir, "notes.txt");
    fs.writeFileSync(bystander, "not mail");
    age(bystander, 30 * DAY);
    age(first.reference, 30 * DAY);

    await sendOne("two");

    expect(fs.existsSync(first.reference)).toBe(false);
    expect(fs.existsSync(bystander)).toBe(true);
  });

  test("only this directory — a stale copy under another journal is left alone", async () => {
    const first = await sendOne("ana's");
    age(first.reference, 30 * DAY);

    const otherDir = path.join(dir, "bo", "mail");
    fs.mkdirSync(otherDir, { recursive: true });
    const other = path.join(otherDir, "old.eml");
    fs.writeFileSync(other, "bo's");
    age(other, 30 * DAY);

    await sendOne("ana's again");

    expect(fs.existsSync(first.reference)).toBe(false);
    // Swept on write, so another journal's folder waits for its own next
    // message. That is the accepted limit of the approach, not an oversight.
    expect(fs.existsSync(other)).toBe(true);
  });

  test("a sweep that cannot read the directory still sends the message", async () => {
    const first = await sendOne("one");
    const mailDir = path.dirname(first.reference);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readdir = vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("EACCES");
    });

    try {
      const result = await sendOne("two");
      expect(fs.existsSync(result.reference)).toBe(true);
      expect(path.dirname(result.reference)).toBe(mailDir);
      expect(warn).toHaveBeenCalled();
    } finally {
      readdir.mockRestore();
    }
  });

  test("a file it cannot delete costs neither the send nor a warning", async () => {
    const first = await sendOne("one");
    age(first.reference, 30 * DAY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("EPERM");
    });

    try {
      const result = await sendOne("two");
      expect(fs.existsSync(result.reference)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      unlink.mockRestore();
    }
  });

  /** The copy path and the file transport share `writeEml`, so they share the
   * lifetime. A window that applied to only one of them would be a difference
   * nobody could justify later. */
  test("a kept copy is swept on the same terms", async () => {
    writeConfig({ enabled: true, transport: "console", keepCopy: true });
    await sendMail(renderMail("ana@example.test", "first", SAMPLE, "ana"));

    const mailDir = path.join(dir, "ana", "mail");
    const [stale] = fs.readdirSync(mailDir).map((f) => path.join(mailDir, f));
    age(stale, 5 * DAY);

    await sendMail(renderMail("ana@example.test", "second", SAMPLE, "ana"));

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.readdirSync(mailDir).filter((f) => f.endsWith(".eml"))).toHaveLength(1);
  });
});

describe("the message format", () => {
  test("is a multipart message with both alternatives", () => {
    const mail = renderMail("reader@example.test", "Subject", SAMPLE);
    const raw = buildMessage(mail, "Fernscout <no-reply@example.test>");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("text/plain; charset=UTF-8");
    expect(raw).toContain("text/html; charset=UTF-8");
  });

  test("encodes a subject that is not plain ASCII", () => {
    const mail = renderMail("r@example.test", "Grüsse aus Hội An", SAMPLE);
    const raw = buildMessage(mail, "a@b.test");
    expect(raw).toContain("=?UTF-8?B?");
    // The raw header must not carry the unencoded bytes.
    expect(raw.split("\r\n\r\n")[0]).not.toContain("Grüsse");
  });

  test("carries one-click unsubscribe headers when there is a link", () => {
    const mail = renderMail("r@example.test", "S", SAMPLE);
    expect(mail.headers?.["List-Unsubscribe"]).toBe("<https://x.test/stop?t=abc>");
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  test("omits those headers when there is nothing to unsubscribe from", () => {
    const mail = renderMail("r@example.test", "S", { ...SAMPLE, unsubscribeUrl: undefined });
    expect(mail.headers?.["List-Unsubscribe"]).toBeUndefined();
  });
});

describe("the text alternative", () => {
  test("is never empty, and carries every link", () => {
    const mail = renderMail("r@example.test", "S", SAMPLE);
    expect(mail.text.length).toBeGreaterThan(40);
    expect(mail.text).toContain("https://x.test/a");
    expect(mail.text).toContain("https://x.test");
    expect(mail.text).toContain("Hoi An");
  });

  test("holds no HTML tags", () => {
    const mail = renderMail("r@example.test", "S", SAMPLE);
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });
});

describe("escaping", () => {
  test("content cannot break out of the HTML", () => {
    const mail = renderMail("r@example.test", "S", {
      ...SAMPLE,
      title: '</h1><script>alert(1)</script>',
      blocks: [{ kind: "paragraph", text: '<img onerror="x">' }],
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain('<img onerror');
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

describe("transports", () => {
  test("mail off means nothing is sent and nothing throws", async () => {
    writeConfig({ enabled: false, transport: "file" });
    const result = await sendMail(renderMail("r@example.test", "S", SAMPLE));
    expect(result).toBeNull();
  });

  test("the file transport needs no credentials and writes a real .eml", async () => {
    writeConfig({ enabled: true, transport: "file" });
    const result = await sendMail(renderMail("reader@example.test", "Hello", SAMPLE, "ana"));
    expect(result?.transport).toBe("file");

    const written = fs.readFileSync(result!.reference, "utf8");
    expect(written).toContain("To: reader@example.test");
    expect(written).toContain("Subject: Hello");
    expect(written.startsWith("From:")).toBe(true);
  });

  test("a user's mail is written under that user, not a shared folder", async () => {
    writeConfig({ enabled: true, transport: "file" });
    const result = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
    expect(result!.reference).toContain(path.join("ana", "mail"));
  });

  /**
   * B111 — the fallback used to be `process.cwd()`.
   *
   * A signup code is the mail you get *before* you own a name, so it carries no
   * username. On the deployed server the working directory is the code
   * checkout, so every one of them was written in plaintext to
   * `/srv/fernscout/mail/`: outside `DATA_DIR`, outside the backup, and in a
   * place no documentation named, so nobody knew there was anything to clear.
   * Nothing about this is visible to a reader of the code, which is why it is
   * asserted rather than left to be noticed.
   */
  test("mail with no journal lands in content/.mail/, not the working directory", async () => {
    writeConfig({ enabled: true, transport: "file" });
    const result = await sendMail(renderMail("newcomer@example.test", "Your code", SAMPLE));

    expect(path.dirname(result!.reference)).toBe(path.join(dir, ".mail"));
    expect(fs.readdirSync(path.join(dir, ".mail"))).toHaveLength(1);
    expect(result!.reference.startsWith(path.join(process.cwd(), "mail"))).toBe(false);
  });

  test("every path the file transport can produce is under the content root", async () => {
    writeConfig({ enabled: true, transport: "file" });

    const withUser = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
    const without = await sendMail(renderMail("r@example.test", "S", SAMPLE));
    for (const result of [withUser, without]) {
      expect(path.resolve(result!.reference).startsWith(path.resolve(dir) + path.sep)).toBe(true);
    }
  });

  /**
   * A username is a directory name and therefore a security boundary
   * (AGENTS.md). Every caller passes one that has already been validated, so
   * this cannot happen today — the point is that it stays impossible when a
   * caller is added, rather than quietly writing somewhere else.
   */
  test("a username that would escape the content root is refused, not written", async () => {
    writeConfig({ enabled: true, transport: "file" });
    // Back through `sendMail`, which is the call that matters. An earlier
    // draft of B60 declined anything whose journal would not resolve, which
    // made this pass without the path guard ever running; the gate now asks
    // only whether the journal said no, so an unresolvable one reaches
    // `mailDir` — where being unable to escape is the actual boundary.
    await expect(
      sendMail(renderMail("r@example.test", "S", SAMPLE, "../../elsewhere")),
    ).rejects.toThrow(/outside the content root/);
  });

  test("MAIL_FROM sets the sender when it is configured", async () => {
    process.env.MAIL_FROM = "Trip <hello@example.test>";
    writeConfig({ enabled: true, transport: "file" });
    const result = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
    expect(fs.readFileSync(result!.reference, "utf8")).toContain(
      "From: Trip <hello@example.test>",
    );
  });

  /**
   * B151 — an umlaut used to take its vowel with it.
   *
   * The `.eml` name's slug never normalised, so a composed character was not
   * folded to its base letter but deleted outright: "Grüße vom Weg" became
   * `gr-e-vom-weg`, with both the `ü` and the `ß` gone and the word with them.
   * Nothing resolves these names — they are development filenames in a
   * gitignored folder, and since B50 they cannot collide — so the cost is
   * exactly one thing: a person debugging a German or Hungarian mail flow
   * reads a filename that has silently dropped the word they are looking for.
   *
   * **Which expansion, and why not the other one.** `ß` is spelled out and the
   * accents come off, but `lib/slug.ts`'s transliteration table is
   * deliberately not carried over — `ü` is `u` here and `ue` there, so this
   * subject is `grusse-vom-weg` on disk and `gruesse-vom-weg` in a permalink.
   * The table's job is keeping "Rückfahrt" and a jolt apart in an address
   * somebody has already shared. Nothing here is shared, resolved or
   * permanent, so the guarantee is not worth coupling the two rules — B77
   * rejected unifying them and B86 restated why. Recognisable is the whole
   * requirement.
   *
   * Asserted on the two letters that behave differently: `ü`, which NFD can
   * decompose, and `ß`, which it cannot, so it needs the line of its own that
   * `lib/postcard/filename.ts` does not have either.
   */
  test("a subject's umlauts and ß survive into the filename", async () => {
    writeConfig({ enabled: true, transport: "file" });

    const sent = await sendMail(renderMail("r@example.test", "Grüße vom Weg", SAMPLE, "ana"));
    expect(path.basename(sent!.reference)).toContain("grusse-vom-weg");

    // The accent folds to its base letter rather than being dropped …
    const zurich = await sendMail(renderMail("r@example.test", "Zürich", SAMPLE, "ana"));
    expect(path.basename(zurich!.reference)).toContain("zurich");

    // … and not to the two-letter form the public slug rule uses.
    expect(path.basename(zurich!.reference)).not.toContain("zuerich");

    // Vietnamese keeps its vowels for the same reason German does.
    const hoiAn = await sendMail(renderMail("r@example.test", "Hội An", SAMPLE, "ana"));
    expect(path.basename(hoiAn!.reference)).toContain("hoi-an");

    // A subject with no ASCII left in it still names a file rather than
    // producing an empty component — the fallback this copy has and
    // `lib/slug.ts` spells `entry`.
    const greek = await sendMail(renderMail("r@example.test", "Καλημέρα", SAMPLE, "ana"));
    expect(path.basename(greek!.reference)).toContain("mail");
  });

  /**
   * B50 — two messages in one millisecond used to leave one file.
   *
   * The name was timestamp, recipient and subject, and `writeFileSync`
   * truncates: a second message with all three the same overwrote the first,
   * with no error and no log line. Found while writing B38's tests, where a
   * pair of deletion confirmations passed about nine runs in ten.
   *
   * The clock is frozen rather than raced. Sending twice and hoping the
   * millisecond ticks over is the flake this task exists to remove, so a test
   * written that way would assert nothing on the runs that matter — it has to
   * be the same millisecond every time, on every machine.
   */
  test("two identical messages in one millisecond leave two files", async () => {
    writeConfig({ enabled: true, transport: "file" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T18:00:00.000Z"));
    try {
      const first = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
      const second = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));

      expect(second!.reference).not.toBe(first!.reference);
      expect(fs.readdirSync(path.join(dir, "ana", "mail"))).toHaveLength(2);
      // Both are readable, and neither is a truncated remnant of the other.
      for (const sent of [first, second]) {
        expect(fs.readFileSync(sent!.reference, "utf8")).toContain("Subject: S");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The timestamp stays in front. Sorting the folder by name is how a person
   * finds the mail they just triggered, so a counter that led would reorder
   * everything around it to solve a collision nobody saw.
   */
  test("the counter trails the timestamp, so the folder still sorts by time", async () => {
    writeConfig({ enabled: true, transport: "file" });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-03T18:00:00.000Z"));
      await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
      await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
      vi.setSystemTime(new Date("2026-09-03T18:00:01.000Z"));
      const last = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));

      // Sorting the names must put them in the order they were sent. A
      // counter in front of the timestamp would sort the second message of
      // 18:00:00 after the only message of 18:00:01.
      const names = fs.readdirSync(path.join(dir, "ana", "mail")).sort();
      expect(names).toHaveLength(3);
      expect(names.at(-1)).toBe(path.basename(last!.reference));
      expect(names.every((n) => n.startsWith("2026-09-03T18-00-0"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the console transport sends nothing anywhere", async () => {
    const result = await sendMailWith("console", renderMail("r@example.test", "S", SAMPLE));
    expect(result.reference).toBe("console");
  });

  /**
   * The wire protocol has its own tests, against a real socket, in
   * `test/smtp.test.ts`. What matters here is the seam: the transport reads
   * its configuration from the environment, and says so when it cannot reach
   * the server rather than failing somewhere unrecognisable.
   */
  test("smtp reports an unreachable server as an unreachable server", async () => {
    writeConfig({ enabled: true, transport: "smtp" });
    process.env.SMTP_HOST = "127.0.0.1";
    // Port 1 is reserved and nothing listens on it.
    process.env.SMTP_PORT = "1";
    process.env.SMTP_USER = "agent@example.test";
    process.env.SMTP_PASSWORD = "unused";
    try {
      await expect(
        sendMailWith("smtp", renderMail("r@example.test", "S", SAMPLE)),
      ).rejects.toThrow(/ECONNREFUSED|connect|timed out/i);
    } finally {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
    }
  });
});

/**
 * `features.mail.keepCopy` — send it for real, and leave a readable copy.
 *
 * The default is the important half. Turning this on puts one-time codes and
 * deletion links on disk in plaintext, so a test that the *absence* of the
 * setting writes nothing is guarding a security property, not a preference.
 */
describe("keeping a copy of mail that was really sent", () => {
  function mailDir() {
    return path.join(dir, "ana", "mail");
  }

  function copies(): string[] {
    return fs.existsSync(mailDir()) ? fs.readdirSync(mailDir()) : [];
  }

  test("absent keepCopy writes nothing — the default that must not regress", async () => {
    writeConfig({ enabled: true, transport: "console" });
    await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
    expect(copies()).toEqual([]);
  });

  test("keepCopy: false is still off", async () => {
    writeConfig({ enabled: true, transport: "console", keepCopy: false });
    await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
    expect(copies()).toEqual([]);
  });

  test("keepCopy leaves a copy of a message the console transport 'sent'", async () => {
    writeConfig({ enabled: true, transport: "console", keepCopy: true });
    const result = await sendMail(renderMail("reader@example.test", "Hello", SAMPLE, "ana"));

    // The send still reports the real transport: a copy is not a delivery.
    expect(result?.transport).toBe("console");

    const written = copies();
    expect(written).toHaveLength(1);
    const body = fs.readFileSync(path.join(mailDir(), written[0]), "utf8");
    expect(body).toContain("To: reader@example.test");
    expect(body).toContain("Subject: Hello");
  });

  /**
   * The copy is a re-render, not the exact bytes that went down the socket.
   * Two things in a message are generated per render: the `Date:` header, at
   * second resolution, and the multipart boundary, which is random
   * (`lib/mail/rfc822.ts:22`). Time is frozen here and the boundary is
   * normalised, so what remains compared is every header and both bodies —
   * which is everything a person reading the copy is reading it for.
   */
  test("the copy matches what the file transport would write", async () => {
    const mail = renderMail("reader@example.test", "Hello", SAMPLE, "ana");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));

    const withoutBoundary = (text: string) =>
      text.replace(/fs-[a-z0-9]+-[a-z0-9]+/g, "BOUNDARY");

    writeConfig({ enabled: true, transport: "file" });
    const viaFile = await sendMail(mail);
    const fileText = fs.readFileSync(viaFile!.reference, "utf8");
    fs.rmSync(mailDir(), { recursive: true, force: true });

    writeConfig({ enabled: true, transport: "console", keepCopy: true });
    await sendMail(mail);
    const copyText = fs.readFileSync(path.join(mailDir(), copies()[0]), "utf8");

    expect(withoutBoundary(copyText)).toBe(withoutBoundary(fileText));

    // The thing it is actually for. The parts are base64, so "readable" means
    // recoverable by anything that opens an .eml — decode it and check the
    // content really is in there, rather than trusting the byte comparison to
    // imply it.
    const parts = copyText
      .split(/--fs-[a-z0-9-]+/)
      .map((p) => p.split(/\r?\n\r?\n/).slice(1).join("\n").trim())
      .filter(Boolean);
    const decoded = parts.map((p) => Buffer.from(p, "base64").toString("utf8")).join("\n");
    expect(decoded).toContain("Three new days since you last looked");
    vi.useRealTimers();
  });

  test("a copy of mail that belongs to no journal is kept under the content root", async () => {
    writeConfig({ enabled: true, transport: "console", keepCopy: true });

    // Compared rather than asserted absent: a checkout that ran the old code
    // may still have a stale `mail/` sitting in it, and this test is about
    // what *this* send writes, not about what somebody forgot to delete.
    const cwdMail = path.join(process.cwd(), "mail");
    const before = fs.existsSync(cwdMail) ? fs.readdirSync(cwdMail) : [];

    await sendMail(renderMail("newcomer@example.test", "Your code", SAMPLE));

    expect(fs.readdirSync(path.join(dir, ".mail"))).toHaveLength(1);
    expect(fs.existsSync(cwdMail) ? fs.readdirSync(cwdMail) : []).toEqual(before);
  });

  test("a copy that cannot be written does not fail the send", async () => {
    writeConfig({ enabled: true, transport: "console", keepCopy: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A file where the directory has to go: mkdir fails, the send must not.
    fs.writeFileSync(mailDir(), "not a directory");

    const result = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));

    expect(result?.transport).toBe("console");
    expect(warn).toHaveBeenCalled();
  });

  describe("over a transport that really sends", () => {
    afterEach(() => {
      for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"]) {
        delete process.env[k];
      }
    });

    /**
     * There is deliberately no "smtp succeeded and left a copy" test here.
     * `SmtpTransport` builds its TLS options from the environment and has no
     * way to be handed a CA, the client correctly refuses a server that does
     * not offer STARTTLS (`test/smtp.test.ts`), and the fake server's
     * certificate is self-signed — so a *successful* send cannot be driven
     * through `sendMail` from a test. B58 is that gap.
     *
     * What is covered instead: the console transport above proves a copy is
     * kept for a transport that is not `file`, which is the whole of the new
     * behaviour, and the test below proves the ordering against a real smtp
     * attempt.
     */
    test("a send that fails leaves no copy behind", async () => {
      writeConfig({ enabled: true, transport: "smtp", keepCopy: true });
      process.env.SMTP_HOST = "127.0.0.1";
      process.env.SMTP_PORT = "1";
      process.env.SMTP_USER = "agent@example.test";
      process.env.SMTP_PASSWORD = "unused";
      process.env.MAIL_FROM = "Fernscout <no-reply@example.test>";

      await expect(
        sendMail(renderMail("r@example.test", "S", SAMPLE, "ana")),
      ).rejects.toThrow();
      expect(copies()).toEqual([]);
    });
  });
});
