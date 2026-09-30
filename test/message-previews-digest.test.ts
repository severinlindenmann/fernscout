import { describe, expect, it } from "vitest";
import { digestPreviews } from "@/lib/messages/previews/digest";

/**
 * B2493 group B — every id this group owns is registered.
 *
 * B2597: readers sign in by email only now, and no plan sends a reader an
 * SMS or a WhatsApp day announcement — `code.sms`, `invite.sms`,
 * `invite.in.sms` and `news.sms` are gone (the first moved to group A, the
 * owner's own signup/phone-verify code; `test/message-previews-account.test.ts`
 * covers it now).
 */
const GROUP_B_IDS = [
  "news.mail",
  "nudge.evening",
  "nudge.first.mail",
  "nudge.first.push",
  "op.spend",
  "op.alert",
  "invite.share",
  "op.sms",
  "news.push",
  "news.wa",
] as const;

describe("digest group previews (B2493 group B)", () => {
  it("registers every template this group owns", () => {
    for (const id of GROUP_B_IDS) {
      expect(Object.keys(digestPreviews), id).toContain(id);
    }
  });
});
