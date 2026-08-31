import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { contentRoot } from "../contentRoot";
import { buildMessage } from "./rfc822";
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
 * Writes the message to disk instead of sending it.
 *
 * Files land under the user the mail belongs to (decision 23) — a digest names
 * every recipient, so it is not something to leave in a directory shared by
 * everyone on the instance. `content/<user>/mail/` is gitignored.
 */
class FileTransport implements MailTransport {
  readonly name = "file";

  async send(mail: Mail): Promise<SendResult> {
    const dir = mail.username
      ? path.join(contentRoot(), mail.username, "mail")
      : path.join(process.cwd(), "mail");
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${slug(mail.to)}-${slug(mail.subject)}.eml`);
    fs.writeFileSync(file, buildMessage(mail, senderAddress()));

    // Printed as well as written: when a test or a script is waiting on a
    // one-time code, reading it out of the terminal beats hunting for a file.
    console.log(`[mail] ${mail.to} — "${mail.subject}" -> ${path.relative(process.cwd(), file)}`);
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
 * Deliberately not implemented yet: it needs a paid mailbox to test against,
 * and shipping an untested SMTP client would be worse than shipping none. The
 * capability registry already knows which variables it needs, so turning it on
 * without them fails at boot rather than at send time.
 */
class SmtpTransport implements MailTransport {
  readonly name = "smtp";

  async send(): Promise<SendResult> {
    throw new Error(
      "The SMTP transport is not implemented yet. Set features.mail.transport to " +
        `"file" for development. See docs/plans/W07-mail.md.`,
    );
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
  return transportFor(transportName()).send(mail);
}

/** For tests and scripts that want the file transport regardless of config. */
export async function sendMailWith(name: string, mail: Mail): Promise<SendResult> {
  return transportFor(name).send(mail);
}
