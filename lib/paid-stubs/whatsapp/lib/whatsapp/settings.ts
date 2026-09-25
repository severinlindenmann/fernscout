/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: WhatsApp is not included in this build. (The display helpers
// whatsappCountryCode/whatsappNumberForUrl/whatsappNumberForDisplay are core:
// lib/contactNumber.ts.) reminderTemplate() and inviteTemplateFor() retired
// (B2339/B2338) along with the sign-in code's authTemplateFor() caller
// (B2335) — but authTemplateFor() itself stays: it still backs the phone-
// verification backend's own auth code.
export function authTemplateFor(_locale: string): { name: string; language: string } {
  throw new Error("WhatsApp is not included in this build");
}
