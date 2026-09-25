/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: WhatsApp is not included in this build. Both senders answer
// the way the real ones do with the capability off: null, nothing sent.
import type { WhatsappMessage, WhatsappSendResult } from "@/lib/whatsappTypes";

export async function sendWhatsapp(_message: WhatsappMessage): Promise<WhatsappSendResult | null> {
  return null;
}
export async function sendWhatsappCode(_message: WhatsappMessage): Promise<WhatsappSendResult | null> {
  return null;
}
