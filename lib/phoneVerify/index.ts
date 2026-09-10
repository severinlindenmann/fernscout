import "server-only";
import { isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { dryRunPhoneVerify } from "./dryRun";
import { smsPhoneVerify } from "./sms";
import { twilioPhoneVerify } from "./twilio";
import { whatsappPhoneVerify } from "./whatsapp";
import type { CheckResult, PhoneVerifyBackend, StartResult } from "./types";

export type { CheckResult, StartResult } from "./types";

/** Configured under `features.signup`, the same way `features.whatsapp` and
 * `features.mail` each name their own backend — see `lib/capabilities.ts`'s
 * `PHONE_VERIFY_BACKEND_ENV`. */
function backendName(): string {
  const configured = loadServerConfig().features.signup.phoneBackend;
  return typeof configured === "string" ? configured : "dry-run";
}

function backend(): PhoneVerifyBackend {
  switch (backendName()) {
    case "dry-run":
      return dryRunPhoneVerify;
    case "twilio":
      return twilioPhoneVerify;
    case "whatsapp":
      return whatsappPhoneVerify;
    case "sms":
      return smsPhoneVerify;
    // B1316: in inbound mode the only codes that exist came from the SMS
    // fallback — the request route branches on phoneProofMode() and on the
    // channel before ever calling start() here, so this case only ever
    // answers check(), which is the shared lifecycle in ./codes.ts.
    case "whatsapp-inbound":
      return smsPhoneVerify;
    default:
      // Unreachable: lib/capabilities.ts refuses an unknown backend at boot.
      throw new Error(`Unknown phone verification backend "${backendName()}".`);
  }
}

/**
 * Which *shape* the signup phone step takes — B1234. `"code"` is every
 * backend that sends a passcode; `"whatsapp-inbound"` inverts the
 * direction: the person messages us (lib/phoneVerify/inboundLink.ts) and no
 * code exists at all. The routes branch on this before ever asking for a
 * code backend, which is why the switch below needs no case for it.
 */
export function phoneProofMode(): "code" | "whatsapp-inbound" {
  return backendName() === "whatsapp-inbound" ? "whatsapp-inbound" : "code";
}

/**
 * Whether the inbound mode also offers "get the code by SMS" — B1316. Only
 * meaningful beside `whatsapp-inbound` (every code mode already delivers a
 * code) and only when the SMS capability can actually send: the fallback is
 * for the person with no WhatsApp, and offering it while it cannot deliver
 * would be the contact-us dead-end with an extra step.
 */
export function smsFallbackOffered(): boolean {
  return phoneProofMode() === "whatsapp-inbound" && isEnabled("sms");
}

export function startVerification(phone: string, locale: string): Promise<StartResult> {
  return backend().start(phone, locale);
}

export function checkVerification(id: string, code: string): Promise<CheckResult> {
  return backend().check(id, code);
}
