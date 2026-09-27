import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolveSmsStopToken, smsStopToken } from "@/lib/contacts/smsStop";

/**
 * B2442, wave 2 review L2 — the stop link in a news SMS proves one thing only:
 * stop SMS from this journal to this contact. It is not the manage token and
 * cannot be moved to another journal or another contact.
 */

beforeEach(() => {
  process.env.SESSION_SECRET = "5".repeat(64);
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
});

describe("the SMS stop token", () => {
  test("names the contact it was made for, on the journal it was made for", () => {
    const token = smsStopToken("ana", "contact-1")!;
    expect(resolveSmsStopToken("ana", token)).toBe("contact-1");
  });

  test("is refused on another journal, for another contact, or tampered", () => {
    const token = smsStopToken("ana", "contact-1")!;
    expect(resolveSmsStopToken("ben", token)).toBeNull();
    expect(resolveSmsStopToken("ana", token.replace("contact-1", "contact-2"))).toBeNull();
    expect(resolveSmsStopToken("ana", `${token.slice(0, -1)}x`)).toBeNull();
    expect(resolveSmsStopToken("ana", "contact-1")).toBeNull();
  });

  test("does not exist without SESSION_SECRET", () => {
    delete process.env.SESSION_SECRET;
    expect(smsStopToken("ana", "contact-1")).toBeNull();
    expect(resolveSmsStopToken("ana", "contact-1.abcdefghijklmnop")).toBeNull();
  });
});
