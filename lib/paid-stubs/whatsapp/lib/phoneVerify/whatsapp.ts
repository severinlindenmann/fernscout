// Public stub: WhatsApp is not included in this build. Boot refuses
// features.signup.phoneBackend "whatsapp" first (features.whatsapp cannot be
// enabled here), so neither method is reachable.
import type { PhoneVerifyBackend } from "@/lib/phoneVerify/types";

const notIncluded = (): never => {
  throw new Error("WhatsApp is not included in this build");
};
export const whatsappPhoneVerify: PhoneVerifyBackend = { name: "whatsapp", start: notIncluded, check: notIncluded };
