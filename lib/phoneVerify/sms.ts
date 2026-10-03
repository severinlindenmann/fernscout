import "server-only";
import { loadServerConfig } from "../config";
import { translateIn } from "../locales";
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
 * B2439: the sentence used to be its own `SENTENCES` table here rather than
 * in `site/locales/` — now it is `code.phoneVerify`, resolved through the
 * same `translateIn` every other message uses, so a fifth language does not
 * need a second place to be added.
 */

async function start(phone: string, locale: string): Promise<StartResult> {
  const { id, code } = await issuePhoneCode(phone);
  // B2813: the last line is the WebOTP origin binding ("@host #code") — the
  // host is the configured site url's, never a literal.
  const { name, url } = loadServerConfig().site;
  const sentence = translateIn(locale, "code.phoneVerify", { code, site: name, host: new URL(url).host });
  await sendSms({ to: phone, body: sentence, template: "code.sms" });
  return { id };
}

async function check(id: string, code: string): Promise<CheckResult> {
  return checkPhoneCode(id, code);
}

export const smsPhoneVerify: PhoneVerifyBackend = { name: "sms", start, check };
