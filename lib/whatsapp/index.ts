import "server-only";
import fs from "node:fs";
import path from "node:path";
import { hasSwitchedOff, isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { contentRoot } from "../contentRoot";
import { sendTemplate, uploadMedia, WhatsappApiError, type CloudCredentials } from "./cloud";
import type { WhatsappMessage, WhatsappSendResult, WhatsappTransport } from "./types";


/**
 * Sending WhatsApp, without needing a Meta account to build anything.
 *
 * The shape is `lib/mail/index.ts`'s, on purpose and not by coincidence: a
 * backend interface, a development backend that writes files you can read,
 * and a production one that really sends — with no caller outside this module
 * knowing which is in use. The rule in AGENTS.md that no feature needs a paid
 * account to develop or test is what forces it, and a WhatsApp Business
 * account is harder to get than an SMTP login: it wants a phone number that
 * has never had WhatsApp on it, and a template approved by Meta over 24
 * hours.
 *
 * ## What the dry-run backend writes, and why it is JSON
 *
 * A `.eml` is a real format a real client opens, which is what makes the mail
 * one worth writing. There is no such thing for WhatsApp — no file a phone
 * will render — so the useful artefact is the exact payload that *would* have
 * gone to Meta, which is what a person debugging a rejected template needs to
 * read. The photograph is recorded by size and type rather than embedded: the
 * bytes are already on disk in the trip's own media folder, and a base64 copy
 * of every photograph ever announced is a directory that grows without
 * bound.
 */

const DEFAULT_BACKEND = "dry-run";

/**
 * Where one journal's dry-run payloads land: `content/<user>/whatsapp/`.
 *
 * Gitignored, and under the content root like everything else — B111 is the
 * record of what happens when a feature writes next to the code instead: on
 * the deployed server that is the git checkout, outside `DATA_DIR`, outside
 * the backup, and in a place no documentation mentions.
 */
function outputDir(username: string | undefined): string {
  const root = contentRoot();
  const dir = username
    ? path.join(root, username, "whatsapp")
    : path.join(root, ".whatsapp");

  // A username is a directory name and therefore a security boundary
  // (AGENTS.md). Callers pass one that has already been validated; this is
  // what keeps "every path this module writes is under the content root" a
  // property rather than a habit.
  const resolved = path.resolve(dir);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Refusing to write WhatsApp payloads outside the content root: ${dir}`);
  }
  return dir;
}

/**
 * A number with everything but its last four digits replaced.
 *
 * Logs go to the operator's journal and, on this instance, to stdout that
 * systemd keeps. A full number there is a personal detail of somebody who
 * gave it for postcards, sitting in a file nobody thinks of as containing
 * personal details — the same reasoning `features.logging` uses for never
 * recording an IP. Four digits is enough to tell two recipients apart while
 * reading a run.
 */
export function maskNumber(to: string): string {
  return to.length <= 4 ? "•".repeat(to.length) : `${"•".repeat(to.length - 4)}${to.slice(-4)}`;
}

/** Writes the payload it would have sent, and sends nothing. */
class DryRunTransport implements WhatsappTransport {
  readonly name = "dry-run";

  async send(message: WhatsappMessage): Promise<WhatsappSendResult> {
    const dir = outputDir(message.username);
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${maskNumber(message.to)}-${message.template}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          to: message.to,
          template: message.template,
          language: message.language,
          body: message.body,
          buttonPath: message.buttonPath,
          photo: message.photo
            ? { contentType: message.photo.contentType, bytes: message.photo.data.length }
            : null,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(
      `[whatsapp:dry-run] ${maskNumber(message.to)} — ${message.template}/${message.language} -> ${displayPath(file)}`,
    );
    return { backend: this.name, reference: file };
  }
}

/** The real one. Credentials come from the environment, never from config. */
class CloudTransport implements WhatsappTransport {
  readonly name = "cloud";

  async send(message: WhatsappMessage): Promise<WhatsappSendResult> {
    const credentials = cloudCredentials();

    // The photograph first: a failed upload must not produce a message with a
    // header parameter Meta cannot resolve. Best-effort, matching
    // `photoAttachment` in the mail path — a picture that will not upload
    // costs the picture, not the announcement.
    let mediaId: string | null = null;
    if (message.photo) {
      try {
        mediaId = await uploadMedia(credentials, message.photo);
      } catch (error) {
        console.warn(
          `[whatsapp] photo upload failed for ${maskNumber(message.to)}: ${(error as Error).message}`,
        );
      }
    }

    // A template whose approved header is an image cannot be sent without
    // one. Sending it headerless is refused by Meta anyway; saying so here
    // gives the operator the actual reason rather than a Graph error code.
    if (message.photo && !mediaId) {
      throw new WhatsappApiError(
        "The header photograph could not be uploaded, and this template's header is required.",
      );
    }

    const id = await sendTemplate(credentials, message, mediaId);
    console.log(
      `[whatsapp:cloud] ${maskNumber(message.to)} — ${message.template}/${message.language} -> ${id}`,
    );
    return { backend: this.name, reference: id };
  }
}

/**
 * The credentials, read at send time rather than at import.
 *
 * `lib/capabilities.ts` has already refused to report the feature as on
 * without them, so this throwing means somebody changed the environment under
 * a running process — worth an exception rather than a silent skip.
 */
function cloudCredentials(): CloudCredentials {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new WhatsappApiError(
      "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must both be set.",
    );
  }
  return { token, phoneNumberId };
}

function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}

function backendName(): string {
  const configured = loadServerConfig().features.whatsapp.backend;
  return typeof configured === "string" ? configured : DEFAULT_BACKEND;
}

function transportFor(name: string): WhatsappTransport {
  switch (name) {
    case "dry-run":
      return new DryRunTransport();
    case "cloud":
      return new CloudTransport();
    default:
      // Unreachable: lib/capabilities.ts refuses an unknown backend at boot.
      throw new Error(`Unknown WhatsApp backend "${name}".`);
  }
}

/**
 * Send one message on a journal's behalf.
 *
 * Gated by the server's capability *and* the journal's own switch, the two
 * questions `sendMail` keeps separate for the reasons written there. There is
 * no `sendTransactional` counterpart and there must not be: every letter that
 * earns mail's exemption — a sign-in code, a deletion link, an operator alert
 * — is addressed to somebody exercising control of the journal, and none of
 * them goes to WhatsApp. This channel carries announcements only, so a
 * journal that switched it off has said the only thing there is to say.
 *
 * Returns null when the feature is off rather than throwing: a caller
 * announcing a new day must not fail because nobody configured WhatsApp.
 */
export async function sendWhatsapp(
  message: WhatsappMessage,
): Promise<WhatsappSendResult | null> {
  if (!isEnabled("whatsapp")) return null;
  if (message.username && hasSwitchedOff("whatsapp", message.username)) return null;
  return transportFor(backendName()).send(message);
}
