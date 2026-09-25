import "server-only";
import { loadServerConfig } from "../config";
import { sendSms } from "../sms";
import { issuePhoneCode, checkPhoneCode } from "./codes";
import type { CheckResult, PhoneVerifyBackend, StartResult } from "./types";

/**
 * The SMS backend — B1316. Unlike `./twilio.ts` (Twilio Verify, which owns
 * its own codes) this is a transport under the repository's own OTP
 * discipline: `./codes.ts` stores and counts, `lib/sms` delivers, and only
 * the delivery differs from `./dryRun.ts` — the same split B1222 settled for
 * the WhatsApp backend.
 *
 * The sentence is written here rather than in `site/locales/` because it
 * goes to a telephone, not to the UI: `t()` renders for a reader whose
 * locale a page negotiated, and this string is chosen by the signup route's
 * own locale pick before any page exists.
 */
const SENTENCES: Record<string, (code: string, site: string) => string> = {
  en: (code, site) => `${code} is your ${site} code. It expires in 30 minutes.`,
  de: (code, site) => `${code} ist dein Code für ${site}. Er läuft in 30 Minuten ab.`,
  hu: (code, site) => `${code} a(z) ${site} kódod. 30 percen belül lejár.`,
};

async function start(phone: string, locale: string): Promise<StartResult> {
  const { id, code } = await issuePhoneCode(phone);
  const sentence = SENTENCES[locale] ?? SENTENCES.en;
  await sendSms({ to: phone, body: sentence(code, loadServerConfig().site.name) });
  return { id };
}

async function check(id: string, code: string): Promise<CheckResult> {
  return checkPhoneCode(id, code);
}

export const smsPhoneVerify: PhoneVerifyBackend = { name: "sms", start, check };
