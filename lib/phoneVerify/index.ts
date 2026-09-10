import "server-only";
import { loadServerConfig } from "../config";
import { dryRunPhoneVerify } from "./dryRun";
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
    default:
      // Unreachable: lib/capabilities.ts refuses an unknown backend at boot.
      throw new Error(`Unknown phone verification backend "${backendName()}".`);
  }
}

export function startVerification(phone: string, locale: string): Promise<StartResult> {
  return backend().start(phone, locale);
}

export function checkVerification(id: string, code: string): Promise<CheckResult> {
  return backend().check(id, code);
}
