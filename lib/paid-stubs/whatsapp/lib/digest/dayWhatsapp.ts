/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: WhatsApp is not included in this build, so a day is never
// announced over it — the same outcome the real sender gives with it off.
type DayWhatsappSkipReason =
  | "unknown_trip"
  | "unknown_day"
  | "not_published"
  | "test_content"
  | "whatsapp_off"
  | "contacts_off"
  | "no_template"
  | "no_credits";

export type DayWhatsappOutcome =
  | { ok: true; resend: boolean; sent: { to: string }[]; failed: { to: string; error: string }[] }
  | { ok: false; reason: DayWhatsappSkipReason; needed?: number; balance?: number };

export async function whatsappWouldCost(_owner: string, _ref: string, _slug?: string): Promise<number> {
  return 0;
}
export async function whatsappWouldReach(_owner: string, _ref: string, _slug?: string): Promise<number> {
  return 0;
}
export async function sendDayWhatsapp(
  _owner: string,
  _ref: string,
  _slug: string,
  _options: { resend?: boolean } = {},
): Promise<DayWhatsappOutcome> {
  return { ok: false, reason: "whatsapp_off" };
}
