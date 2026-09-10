import "server-only";
import { sendWhatsappCode } from "../whatsapp";
import { authTemplateFor } from "../whatsapp/settings";
import { issuePhoneCode, checkPhoneCode } from "./codes";
import type { CheckResult, PhoneVerifyBackend, StartResult } from "./types";

/**
 * WhatsApp — the live backend since B1222, which put Twilio Verify on hold.
 *
 * Unlike Verify, WhatsApp is a *transport*: it delivers a message and
 * decides nothing about codes. So the code lifecycle stays ours
 * (`./codes.ts` — the same hash-only, five-attempt, thirty-minute
 * discipline the dry-run backend uses), and this module differs from
 * dry-run only in where the code goes: an approved authentication template
 * through whichever WhatsApp transport `features.whatsapp.backend` names.
 * That also means this backend develops with no Meta account — the dry-run
 * WhatsApp *transport* writes the payload to disk.
 */

async function start(phone: string, locale: string): Promise<StartResult> {
  const template = authTemplateFor(locale);
  const { id, code } = await issuePhoneCode(phone);

  const result = await sendWhatsappCode({
    to: phone,
    template: template.name,
    language: template.language,
    // Meta's authentication templates carry the code twice: `{{1}}` in the
    // body, and the copy-code button's parameter — which the Cloud API
    // takes as a `url` button whose text is the code.
    body: [code],
    buttonPath: code,
    category: "authentication",
  });
  if (!result) {
    // `sendWhatsappCode` answers null only when the whatsapp capability is
    // off — a configuration this backend cannot work under. Loud, so the
    // route's 503 carries the actual reason into the operator's log.
    throw new Error(
      'features.signup.phoneBackend is "whatsapp" but the whatsapp capability is off — enable features.whatsapp.',
    );
  }

  return { id };
}

async function check(id: string, code: string): Promise<CheckResult> {
  return checkPhoneCode(id, code);
}

export const whatsappPhoneVerify: PhoneVerifyBackend = { name: "whatsapp", start, check };
