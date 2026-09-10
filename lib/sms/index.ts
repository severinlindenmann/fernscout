import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { dataDir } from "../dataDir";
import { maskNumber } from "../whatsapp/index";
import { recordSms } from "./store";

/**
 * Sending SMS, without needing a Twilio account to build anything — B1316.
 *
 * The shape is `lib/whatsapp/index.ts`'s, which is `lib/mail/index.ts`'s: a
 * transport interface, a development transport that writes files, a real one
 * that spends money, and no caller outside this module knowing which is in
 * use. Unlike WhatsApp there is no template machinery — an SMS is a string
 * to a number, which is the whole reason this channel exists beside it.
 *
 * `lib/phoneVerify/twilio.ts` is *not* this: that is Twilio Verify, a
 * verification service that owns its own codes. This is the plain Messages
 * API, and the codes it carries are this repository's own
 * (lib/phoneVerify/codes.ts).
 */

export type SmsMessage = {
  /** E.164 digits, no `+` — `toE164`'s shape, same as WhatsApp's `to`. */
  to: string;
  body: string;
};

type SmsSendResult = { backend: string; reference: string | null };

type SmsTransport = {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
};

export class SmsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsApiError";
  }
}

/** Writes the payload it would have sent, and sends nothing. Under
 * `dataDir()` beside the dry-run phone codes, never under the content root:
 * an SMS belongs to the instance, not to any journal. */
class DryRunSmsTransport implements SmsTransport {
  readonly name = "dry-run";

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const dir = path.join(dataDir(), "sms");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${maskNumber(message.to)}.json`);
    fs.writeFileSync(file, JSON.stringify({ to: message.to, body: message.body }, null, 2) + "\n", "utf8");
    console.log(`[sms:dry-run] ${maskNumber(message.to)} -> ${file}`);
    return { backend: this.name, reference: null };
  }
}

/** The real one — Twilio's Messages API, raw fetch and Basic auth, the same
 * ~20 lines lib/phoneVerify/twilio.ts already spends on Verify. Deliberately
 * no `twilio` npm dependency. */
class TwilioSmsTransport implements SmsTransport {
  readonly name = "twilio";

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const { accountSid, authToken, from } = twilioCredentials();
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: `+${message.to}`, From: from, Body: message.body }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!response.ok) {
      throw new SmsApiError(body.message ?? `Twilio refused the message (HTTP ${response.status})`);
    }
    console.log(`[sms:twilio] ${maskNumber(message.to)} -> ${body.sid ?? "?"}`);
    return { backend: this.name, reference: body.sid ?? null };
  }
}

function twilioCredentials(): { accountSid: string; authToken: string; from: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    throw new SmsApiError("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER must all be set.");
  }
  return { accountSid, authToken, from: from.startsWith("+") ? from : `+${from}` };
}

function backendName(): string {
  const configured = loadServerConfig().features.sms.backend;
  return typeof configured === "string" ? configured : "dry-run";
}

function transportFor(name: string): SmsTransport {
  switch (name) {
    case "dry-run":
      return new DryRunSmsTransport();
    case "twilio":
      return new TwilioSmsTransport();
    default:
      // Unreachable: lib/capabilities.ts refuses an unknown backend at boot.
      throw new Error(`Unknown SMS backend "${name}".`);
  }
}

/**
 * Why this number cannot be reached from here, or null when it can.
 *
 * The instance's number may carry a sender restriction Twilio enforces per
 * recipient country — the live one is a Swiss mobile number that reaches
 * `+41` and nothing else (B1316; B1317 is the ceiling's own ticket). The
 * config says so (`features.sms.allowedPrefixes`) so a caller is refused
 * with a reason here, rather than Twilio accepting the message and a person
 * waiting for a code that never comes. Unset means no restriction.
 */
export function smsUnreachable(to: string): string | null {
  const prefixes = loadServerConfig().features.sms.allowedPrefixes;
  if (!Array.isArray(prefixes) || prefixes.length === 0) return null;
  const allowed = prefixes.filter((p): p is string => typeof p === "string");
  if (allowed.some((p) => to.startsWith(p.replace(/^\+/, "")))) return null;
  return `this server's number only reaches ${allowed.join(", ")} numbers`;
}

/**
 * Send one SMS. Throws with the honest reason rather than answering null —
 * every caller here (a passcode, an operator pressing send) has just been
 * asked for exactly this message, so a silent skip would be a lie waiting
 * for a screen to tell it.
 *
 * The row for /admin's list is bookkeeping and never costs the send: by the
 * time it is written the message has gone, and losing a message to an
 * accounting insert would be trading the product for the record —
 * `recordUsage`'s own reasoning, one channel over.
 */
export async function sendSms(message: SmsMessage): Promise<SmsSendResult> {
  if (!isEnabled("sms")) throw new SmsApiError("SMS is not enabled on this server.");
  const unreachable = smsUnreachable(message.to);
  if (unreachable) throw new SmsApiError(`This message cannot be delivered: ${unreachable}.`);

  const result = await transportFor(backendName()).send(message);

  try {
    const from = process.env.TWILIO_FROM_NUMBER ?? "";
    await recordSms({
      direction: "out",
      from: result.backend === "twilio" ? from.replace(/^\+/, "") : "",
      to: message.to,
      body: message.body,
      providerSid: result.reference,
    });
  } catch (err) {
    console.warn(`[sms] sent but not recorded for ${maskNumber(message.to)}:`, err);
  }

  return result;
}
