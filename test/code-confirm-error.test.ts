import { describe, expect, test } from "vitest";
import { codeConfirmErrorKey } from "@/lib/contacts/codeConfirmError";

/**
 * B272 — the two paths `InviteRedeem` and `ContactForm` render for a failed
 * `/api/contacts/confirm` must stay different: a rejected code says so, and
 * nothing else may say it too.
 */
describe("codeConfirmErrorKey", () => {
  test("a rejected code (401) is told it was wrong", () => {
    expect(codeConfirmErrorKey(401)).toBe("contact.codeWrong");
  });

  test("every other failure is told it was this end's fault, never the reader's", () => {
    for (const status of [500, 502, 503, 400, 403]) {
      expect(codeConfirmErrorKey(status)).toBe("contact.codeServerError");
    }
  });

  test("the two render different copy", () => {
    expect(codeConfirmErrorKey(401)).not.toBe(codeConfirmErrorKey(500));
  });
});
