/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: WhatsApp is not included in this build. (The display helpers
// whatsappCountryCode/whatsappNumberForUrl/whatsappNumberForDisplay are core:
// lib/contactNumber.ts.)
export function reminderTemplate(): { name: string; language: string } | null {
  return null;
}
export function authTemplateFor(_locale: string): { name: string; language: string } {
  throw new Error("WhatsApp is not included in this build");
}
export async function whatsappSignInOffered(_username: string): Promise<boolean> {
  return false;
}
