import "server-only";
import fs from "node:fs";
import path from "node:path";
import { hasSwitchedOff, isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { contentRoot } from "../contentRoot";
import { maskNumber } from "./index";

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

async function sendCloud(to: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must both be set to reply.");
  }
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`WhatsApp reply refused (HTTP ${response.status}): ${detail.slice(0, 200)}`);
  }
}

function sendDryRun(to: string, body: string, username: string | null): void {
  const dir = outputDir(username);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    path.join(dir, `${stamp}-${maskNumber(to)}.json`),
    JSON.stringify({ to, body }, null, 2) + "\n",
    "utf8",
  );
  console.log(`[whatsapp:reply:dry-run] ${maskNumber(to)} -> ${body}`);
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

/**
 * Send a plain-text reply — the fixed strings `lib/whatsapp/dispatch.ts`
 * assembles, never a model's own words in this ticket (that is B1056/B1061).
 *
 * `username` is null for a stranger reply, since nobody owns the number this
 * message is answering into yet.
 */
export async function sendServiceReply(to: string, body: string, username: string | null): Promise<void> {
  if (!isEnabled("whatsappInbound")) return;
  if (username && hasSwitchedOff("whatsapp", username)) return;
  if (backendName() === "cloud") {
    await sendCloud(to, body);
  } else {
    sendDryRun(to, body, username);
  }
}
