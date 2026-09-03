import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { contentRoot } from "../contentRoot";
import { buildMessage } from "./rfc822";
import { sendSmtp } from "./smtp";
import type { Mail, MailTransport, SendResult } from "./types";

export type { Mail, SendResult } from "./types";

/**
 * Sending mail, without needing a mail account to build anything.
 *
 * Development writes real `.eml` files you can open in any mail client, which
 * makes the whole digest and one-time-code flow testable with no credentials
 * anywhere. Production swaps the transport and nothing else changes: no caller
 * outside this module knows which one is in use.
 */

/**
 * A filename component for a `.eml` on disk — not `slugify` from lib/slug.ts.
 *
 * That one mints permanent public identifiers, and the rule it follows is the
 * point of it. What comes out of here is half of a local filename in a
 * gitignored folder — uniqueness is `writeEml`'s job, not this function's —
 * read by a person hunting for the mail they just triggered and deleted
 * afterwards. Nothing resolves it, so nothing breaks if it changes.
 */
function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "mail"
  );
}

/**
 * Where mail that belongs to no journal goes: `content/.mail/`.
 *
 * A signup code is the mail you get *before* you own a name, so it has no
 * `username` to be filed under. It is still this instance's data, and it still
 * carries a live one-time code, so it belongs under the content root with
 * everything else — not in whatever directory the process happened to be
 * started from. That is what this used to be, and B111 is what it cost: on the
 * deployed server the working directory is the code checkout, so every signup
 * code ever issued was sitting in plaintext in `/srv/fernscout/mail/` — outside
 * `DATA_DIR`, therefore outside the backup, in the directory `git pull` runs
 * in, and in a place no documentation mentioned and so nobody thought to clear.
 *
 * The leading dot follows `content/.deleted/` (`lib/tombstones.ts`): an
 * instance directory rather than a person's, skipped by the journal scan in
 * `lib/users.ts`, and impossible to collide with a journal because
 * `USERNAME_RE` admits no dot.
 */
const NO_JOURNAL_DIR = ".mail";

/**
 * The directory one message's `.eml` goes in — always inside `contentRoot()`.
 *
 * Files land under the user the mail belongs to (decision 23) — a digest names
 * every recipient, so it is not something to leave in a directory shared by
 * everyone on the instance. Both `content/<user>/mail/` and `content/.mail/`
 * are gitignored.
 */
function mailDir(username?: string): string {
  const root = contentRoot();
  const dir = username
    ? path.join(root, username, "mail")
    : path.join(root, NO_JOURNAL_DIR);

  // A username reaches the filesystem as a directory name, which makes it a
  // security boundary (AGENTS.md). Every caller passes one that has already
  // been through `isValidUsername`; this is what keeps "every path this module
  // can produce is under the content root" a property rather than a habit, and
  // it is cheap enough to run on every message.
  const resolved = path.resolve(dir);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Refusing to write mail outside the content root: ${dir}`);
  }
  return dir;
}

/**
 * How many messages may share one timestamp, recipient and subject before the
 * write gives up rather than looking for another name. See `writeEml`.
 */
const MAX_SAME_NAME = 100;

/**
 * How long a `.eml` stays on disk. Two days.
 *
 * B57 said these files "stay there until somebody removes them", on the
 * reasoning that an operator turns `keepCopy` on to debug something and turns
 * it off again. Two things made that weaker than it read: `keepCopy` has been
 * on at fernscout.ch for days (B102), and since B111 these files live inside
 * `CONTENT_DIR`, which `scripts/backup.sh` archives wholesale — so a plaintext
 * credential now propagates into restic snapshots and lives for the retention
 * period of the backup rather than the life of the directory.
 *
 * The window comes from what the files are *for*: somebody reading the message
 * they just triggered. Two days covers a flow debugged on a Friday and looked
 * at again on a Sunday, and nothing in the codebase ever reads an old one.
 *
 * It is deliberately not tied to how long the *contents* stay valid, which
 * varies and is not this module's to know. A sign-in code expires in 30
 * minutes and a stale one is worthless; a journal-deletion link and a guest
 * invitation are single-use but long-lived, and those are the ones an old
 * `.eml` turns into a live credential in a directory nobody revisits.
 */
const KEPT_MAIL_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Delete the `.eml` files in one directory that are past `KEPT_MAIL_TTL_MS`.
 *
 * Swept on write rather than on a schedule: the thing that writes mail is the
 * only thing that needs to know mail exists, so this needs no cron, no systemd
 * unit and no new capability — all three of which would be more machinery than
 * the problem (B135).
 *
 * **Never throws.** A directory it cannot read is a warning and nothing more,
 * for the same reason `keepCopyOf` swallows its own failures: the message is
 * the point, and refusing to send mail because an old file would not delete
 * would be a worse bug than the one this fixes.
 *
 * Only `.eml`, only files, only this directory. Mail folders are gitignored
 * and shared with nothing, but "delete things older than two days" is the kind
 * of line that wants its blast radius stated rather than assumed.
 */
function sweepExpiredMail(dir: string): void {
  const cutoff = Date.now() - KEPT_MAIL_TTL_MS;
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".eml")) continue;
      const file = path.join(dir, entry.name);
      try {
        if (fs.statSync(file).mtimeMs >= cutoff) continue;
        fs.unlinkSync(file);
        removed++;
      } catch {
        // Raced with something else, or not ours to remove. The next message
        // written here tries again; one stubborn file is not worth a warning
        // on every send.
      }
    }
  } catch (error) {
    console.warn(`[mail] could not sweep ${displayPath(dir)}: ${(error as Error).message}`);
    return;
  }
  if (removed > 0) {
    console.log(
      `[mail] swept ${removed} expired .eml from ${displayPath(dir)} (older than 2 days)`,
    );
  }
}

/**
 * Write one message to disk, and return where it landed.
 *
 * Shared by the file transport, which is the only thing it does, and by
 * `keepCopy`, which layers it over a transport that really sends. One
 * function rather than two so the copy is byte-identical to the original
 * rather than approximately like it — a debugging aid that differs from the
 * real thing in some detail nobody has written down is worse than none.
 *
 * **The name is timestamp first, then recipient, then subject, then — only
 * when that is taken — a counter.** The timestamp leads because sorting the
 * folder by name is how a person finds the mail they just triggered; the
 * counter trails for the same reason, so a second message never displaces the
 * ordering of everything around it.
 *
 * The counter is B50. The name used to be the first three parts alone, and
 * `writeFileSync` truncates what is already there: two messages to one address
 * with one subject inside the same millisecond left one file, with no error
 * and no log line, and the second had eaten the first. Rare in a browser and
 * ordinary in a test or a burst — a digest run, a deletion asked for twice, an
 * ingest that notifies. Writing with `wx` turns that collision from data loss
 * into an `EEXIST` this function can answer, which is why the retry is here
 * rather than a random suffix on every filename: nothing about the common case
 * changes, and the uncommon one stops being silent.
 */
function writeEml(mail: Mail): string {
  const dir = mailDir(mail.username);
  fs.mkdirSync(dir, { recursive: true });

  // Before the write, not after, so the message just written is never a
  // candidate for its own sweep. Here rather than in the two callers because
  // the file transport and `keepCopy` produce the same files for the same
  // reasons, and a lifetime that applied to only one of them would be a
  // difference nobody could justify later (B135).
  sweepExpiredMail(dir);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}-${slug(mail.to)}-${slug(mail.subject)}`;
  const body = buildMessage(mail, senderAddress());

  // `wx` fails rather than truncating, so the loop claims a name and writes it
  // in one step: there is no window between "this one is free" and "it is
  // mine" for the next message to slip into.
  for (let n = 1; n <= MAX_SAME_NAME; n++) {
    const file = path.join(dir, n === 1 ? `${base}.eml` : `${base}-${n}.eml`);
    try {
      fs.writeFileSync(file, body, { flag: "wx" });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  // Only reachable if a hundred messages to one address, with one subject,
  // were written inside a single millisecond. Loud, because the alternative
  // is B50 again: this function's contract is that a message it was handed is
  // on disk when it returns, and silently returning somebody else's file is
  // how a mailbox comes to disagree with what was sent.
  throw new Error(`Too many messages named ${base} in the same millisecond.`);
}

/**
 * How to name the file in a log line.
 *
 * Relative while the content root is inside the working directory, which is
 * the development case and the only one where a relative path is the shorter
 * read. On a server the two are far apart — `/srv/fernscout` and
 * `/var/lib/fernscout` — and `../../var/lib/fernscout/content/…` is a path an
 * operator has to mentally re-join before they can cd to it.
 */
function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}

class FileTransport implements MailTransport {
  readonly name = "file";

  async send(mail: Mail): Promise<SendResult> {
    const file = writeEml(mail);

    // Printed as well as written: when a test or a script is waiting on a
    // one-time code, reading it out of the terminal beats hunting for a file.
    console.log(`[mail] ${mail.to} — "${mail.subject}" -> ${displayPath(file)}`);
    return { transport: this.name, reference: file };
  }
}

/** Logs and discards. For CI, where even writing files is noise. */
class ConsoleTransport implements MailTransport {
  readonly name = "console";

  async send(mail: Mail): Promise<SendResult> {
    console.log(`[mail:console] ${mail.to} — "${mail.subject}"`);
    return { transport: this.name, reference: "console" };
  }
}

/**
 * SMTP, for production (decision 17: Proton SMTP Submission).
 *
 * The client is `lib/mail/smtp.ts` and is tested against a real socket and a
 * real TLS upgrade in `test/smtp.test.ts` — which is what made it safe to
 * ship. This class is only the part that reads configuration: the capability
 * registry has already refused the boot if any of these variables is missing,
 * so by the time anything calls `send` they are known to be present.
 */
class SmtpTransport implements MailTransport {
  readonly name = "smtp";

  async send(mail: Mail): Promise<SendResult> {
    const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
    const result = await sendSmtp(buildMessage(mail, senderAddress()), {
      from: senderAddress(),
      to: mail.to,
      config: {
        host: process.env.SMTP_HOST!,
        port,
        user: process.env.SMTP_USER!,
        password: process.env.SMTP_PASSWORD!,
        // 465 is TLS from the first byte; 587 negotiates it with STARTTLS.
        secure: port === 465,
        // Servers log the EHLO name. Ours is the site's own host, which makes
        // a rejected send traceable to the instance that sent it.
        clientName: hostOf(loadServerConfig().site.url),
      },
    });

    // The recipient is logged, the message is not — a one-time code must not
    // end up in the journal.
    console.log(`[mail:smtp] ${mail.to} — "${mail.subject}" -> ${result.reference}`);
    return { transport: this.name, reference: result.reference };
  }
}

export function senderAddress(): string {
  return process.env.MAIL_FROM ?? `Fernscout <no-reply@${hostOf(loadServerConfig().site.url)}>`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "localhost";
  }
}

function transportName(): string {
  const configured = loadServerConfig().features.mail.transport;
  return typeof configured === "string" ? configured : "file";
}

function transportFor(name: string): MailTransport {
  switch (name) {
    case "file":
      return new FileTransport();
    case "console":
      return new ConsoleTransport();
    case "smtp":
      return new SmtpTransport();
    default:
      // Unreachable: lib/capabilities.ts refuses an unknown transport at boot.
      throw new Error(`Unknown mail transport "${name}".`);
  }
}

/**
 * Send one message.
 *
 * Returns null when mail is switched off, rather than throwing: a caller
 * announcing a new day should not fail because nobody configured mail. The
 * *capability* check is what makes that safe — a transport that is on but
 * unconfigured has already failed the boot.
 */
export async function sendMail(mail: Mail): Promise<SendResult | null> {
  if (!isEnabled("mail")) return null;

  const name = transportName();
  const result = await transportFor(name).send(mail);

  // Only after the send resolved. A `.eml` on disk for a message that never
  // left is a debugging aid that lies, and the person reading it is by
  // definition already confused about what happened.
  if (name !== "file" && keepsCopy()) keepCopyOf(mail);

  return result;
}

/**
 * Whether to write a copy of every message to disk — `features.mail.keepCopy`.
 *
 * **Absent means off, and that default is load-bearing.** Turning this on
 * writes sign-in codes, guest invitations and journal-deletion links to
 * `content/<user>/mail/` — and signup codes, which belong to no journal yet,
 * to `content/.mail/` — in plaintext. Anyone who can read the filesystem — a
 * backup, a snapshot, another process on the box — can then sign in as any
 * reader of that journal, or finish a deletion.
 *
 * They no longer stay forever: `KEPT_MAIL_TTL_MS` gives them two days, swept
 * whenever the next message is written to the same directory (B135). That
 * bounds the exposure and does not remove it — a file is readable for those
 * two days, and a directory nothing writes to again is never swept at all.
 *
 * It exists because the alternative was worse in the case that actually
 * arose: on an instance sending real mail, the deletion-confirmation link and
 * every sign-in code are unreadable to whoever is testing, so the flows that
 * matter most cannot be verified at all. This is the file transport's one good
 * property, made available to a server that also has to really send.
 */
function keepsCopy(): boolean {
  return loadServerConfig().features.mail.keepCopy === true;
}

/** Never throws. The mail has gone; a full disk is not a reason to tell a
 * caller it failed, because the caller's remedy is to send it again. */
function keepCopyOf(mail: Mail): void {
  try {
    const file = writeEml(mail);
    console.log(`[mail] copy kept -> ${displayPath(file)}`);
  } catch (error) {
    console.warn(`[mail] could not keep a copy for ${mail.to}: ${(error as Error).message}`);
  }
}

/** For tests and scripts that want the file transport regardless of config. */
export async function sendMailWith(name: string, mail: Mail): Promise<SendResult> {
  return transportFor(name).send(mail);
}
