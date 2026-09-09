import "server-only";
import fs from "node:fs";
import path from "node:path";
import { hasSwitchedOff, isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { contentRoot } from "../contentRoot";
import { holdAnswer } from "./held";
import { maskNumber } from "./index";
import type { WhatsappOutbound } from "./render";
import { isWindowOpen } from "./window";

/**
 * A free-form reply inside an open conversation window — B1058.
 *
 * `types.ts`'s `WhatsappMessage` is deliberately template-only, because that
 * is the whole truth for an **announcement**: nobody messaged first, so
 * outside the 24-hour window nothing else is deliverable. This module is the
 * other half of that same fact, not an exception to it — inbound message
 * *opens* the window, and inside it "any of the service message types may be
 * sent with no template" (B1057's own research). So a reply here is
 * deliberately the plainest shape Meta allows: `type: "text"`, no template
 * name, no approval needed, and it is refused (this module does not even try
 * it) unless something inbound has just proven the window is open — which is
 * always true of a caller reached from `lib/whatsapp/dispatch.ts`.
 *
 * Gated by `whatsappInbound`, never by `whatsapp` — replying is the
 * conversational channel's own capability, and turning off day announcements
 * must not silently kill somebody's writing door.
 */

const GRAPH_VERSION = "v25.0";

function outputDir(username: string | null): string {
  const root = contentRoot();
  return path.join(root, username ?? ".whatsapp", "whatsapp-replies");
}

/**
 * `outbound` into the Cloud API's own message shape — B1056.
 *
 * Three of the vocabulary WhatsApp actually offers: plain text, up to three
 * reply buttons, or one list of up to ten rows. `lib/whatsapp/render.ts` is
 * what already enforced the ceilings; this only translates the result into
 * what Meta's endpoint wants.
 */
function payloadFor(to: string, outbound: WhatsappOutbound): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (outbound.kind === "text") {
    return { ...base, type: "text", text: { body: outbound.body } };
  }
  if (outbound.kind === "buttons") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: outbound.body },
        action: {
          buttons: outbound.buttons.map((button) => ({
            type: "reply",
            reply: { id: button.id, title: button.title },
          })),
        },
      },
    };
  }
  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: outbound.body },
      action: {
        button: outbound.buttonLabel,
        sections: [{ rows: outbound.rows.map((row) => ({ id: row.id, title: row.title })) }],
      },
    },
  };
}

async function sendCloud(to: string, outbound: WhatsappOutbound): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must both be set to reply.");
  }
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payloadFor(to, outbound)),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`WhatsApp reply refused (HTTP ${response.status}): ${detail.slice(0, 200)}`);
  }
}

function sendDryRun(to: string, outbound: WhatsappOutbound, username: string | null): void {
  const dir = outputDir(username);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    path.join(dir, `${stamp}-${maskNumber(to)}.json`),
    JSON.stringify({ to, ...outbound }, null, 2) + "\n",
    "utf8",
  );
  const summary =
    outbound.kind === "text"
      ? outbound.body
      : `${outbound.body} [${outbound.kind}: ${
          outbound.kind === "buttons"
            ? outbound.buttons.map((b) => b.title).join(" / ")
            : outbound.rows.map((r) => r.title).join(" / ")
        }]`;
  console.log(`[whatsapp:reply:dry-run] ${maskNumber(to)} -> ${summary}`);
}

function backendName(): string {
  // The same backend the announcement channel uses — one Meta account, one
  // set of credentials, whichever `features.whatsapp.backend` names. Reading
  // `whatsapp`'s own config here rather than inventing a second `backend`
  // setting under `whatsappInbound` is a small reuse: there is only ever one
  // real backend (`cloud`) either way.
  const configured = loadServerConfig().features.whatsapp.backend;
  return typeof configured === "string" ? configured : "dry-run";
}

/** What actually happened to a reply — B1061. A caller that only ever
 *  `await`ed this before still compiles and still behaves the same; the
 *  result exists for the one caller (`lib/whatsapp/dispatch.ts`) that needs
 *  to tell a held answer from a sent one. */
export type ReplyOutcome = { sent: true } | { sent: false; held: boolean };

/**
 * Send a plain-text reply — the fixed strings `lib/whatsapp/dispatch.ts`
 * assembles for the disclosure, the acknowledgement and the stranger
 * sentence. Every model-drawn answer goes through `sendOutboundReply` below
 * instead, since B1056 gave it a shape richer than plain text.
 *
 * `username` is null for a stranger reply, since nobody owns the number this
 * message is answering into yet.
 */
export async function sendServiceReply(to: string, body: string, username: string | null): Promise<ReplyOutcome> {
  return sendOutboundReply(to, { kind: "text", body }, username);
}

/**
 * Send whatever `lib/whatsapp/render.ts` drew from a turn's `Block[]` — text,
 * reply buttons, or a list — B1056.
 *
 * **Refused, not sent, outside an open window** — B1061. "Never initiate" is
 * absolute: this is the one place every reply on this channel passes
 * through, so it is the one place that rule can actually be enforced rather
 * than trusted of every caller. A `username`-less (stranger) reply skips the
 * check — there is no journal to have opened a window under, and it is
 * always a same-request reply to the message that just arrived, so it is
 * trivially inside one. Everything else is held (`lib/whatsapp/held.ts`)
 * rather than sent as a template or dropped, per the owner's own decision:
 * this channel has no templates for anything but the day announcement.
 */
export async function sendOutboundReply(
  to: string,
  outbound: WhatsappOutbound,
  username: string | null,
): Promise<ReplyOutcome> {
  if (!isEnabled("whatsappInbound")) return { sent: false, held: false };
  if (username && hasSwitchedOff("whatsapp", username)) return { sent: false, held: false };
  if (username && !isWindowOpen(username, to)) {
    holdAnswer(username, to, outbound);
    return { sent: false, held: true };
  }
  if (backendName() === "cloud") {
    await sendCloud(to, outbound);
  } else {
    sendDryRun(to, outbound, username);
  }
  return { sent: true };
}
