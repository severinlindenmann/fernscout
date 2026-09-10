import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../dataDir";
import { issuePhoneCode, checkPhoneCode } from "./codes";
import type { CheckResult, PhoneVerifyBackend, StartResult } from "./types";

/**
 * The dry-run phone verification backend — no provider, no account, runs
 * locally exactly as AGENTS.md requires.
 *
 * The code lifecycle lives in `./codes.ts` (shared with the WhatsApp
 * backend since B1222); what is "dry-run" about this module is only the
 * delivery — the code is written to disk and sent nowhere.
 */

function phoneDir(): string {
  return path.join(dataDir(), "phone");
}

/** A number with everything but its last four digits replaced — the same
 * masking `lib/whatsapp/index.ts` uses for a log line. */
function mask(tel: string): string {
  // Digits only in the visible suffix, the same defence lib/whatsapp's own
  // maskNumber applies — this value is also used to build a filename below.
  const digits = tel.replace(/\D/g, "");
  return digits.length <= 4 ? "•".repeat(digits.length) : `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

async function start(phone: string, locale: string): Promise<StartResult> {
  const { id, code } = await issuePhoneCode(phone);

  // Written where mail already goes when there is no journal to write it
  // under yet — the same reasoning `<dataDir>/mail/.mail/` follows for a
  // signup code. Never sent anywhere: this is the whole of "dry-run".
  const dir = phoneDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    path.join(dir, `${stamp}-${mask(phone)}.json`),
    JSON.stringify({ phone, code, locale }, null, 2) + "\n",
    "utf8",
  );
  console.log(`[phone:dry-run] ${mask(phone)} code=${code}`);

  return { id };
}

async function check(id: string, code: string): Promise<CheckResult> {
  return checkPhoneCode(id, code);
}

export const dryRunPhoneVerify: PhoneVerifyBackend = { name: "dry-run", start, check };
