import { describe, expect, test } from "vitest";
import { redeemOutcome } from "@/lib/contacts/redeemOutcome";

/**
 * B406 — every refusal `/api/contacts/redeem` can return has to reach the
 * reader. `InviteRedeem` used to read only the happy-path statuses (`code`,
 * `in`, `waiting`) and let every other response fall through to a page that
 * looked unchanged. This is the pure mapping the component now calls, tested
 * without a DOM the same way `codeConfirmErrorKey` is.
 */
describe("redeemOutcome", () => {
  test("mail_disabled becomes the no-mail error", () => {
    expect(redeemOutcome({ ok: false, status: 503 }, { error: "mail_disabled" })).toEqual({
      kind: "error",
      error: "invite.noMail",
    });
  });

  test("a dead, revoked, mismatched-kind or deleted-trip link (202 expired) becomes the expired error", () => {
    expect(redeemOutcome({ ok: true, status: 202 }, { status: "expired" })).toEqual({
      kind: "error",
      error: "invite.expired",
    });
  });

  test("too many requests", () => {
    expect(redeemOutcome({ ok: false, status: 429 }, {})).toEqual({
      kind: "error",
      error: "contact.tooMany",
    });
  });

  test("the client-independent 400s", () => {
    expect(redeemOutcome({ ok: false, status: 400 }, { error: "invalid_email" }).error).toBe(
      "contact.needEmail",
    );
    expect(redeemOutcome({ ok: false, status: 400 }, { error: "invalid_name" }).error).toBe(
      "contact.needName",
    );
    expect(redeemOutcome({ ok: false, status: 400 }, { error: "invalid_address" }).error).toBe(
      "contact.needAddress",
    );
  });

  test("an unrecognised failure still says something rather than nothing", () => {
    expect(redeemOutcome({ ok: false, status: 500 }, {})).toEqual({
      kind: "error",
      error: "contact.error",
    });
  });

  test("the three happy-path statuses still advance the step", () => {
    expect(redeemOutcome({ ok: true, status: 202 }, { status: "code" })).toEqual({
      kind: "step",
      step: "code",
    });
    expect(redeemOutcome({ ok: true, status: 202 }, { status: "in" })).toEqual({
      kind: "step",
      step: "in",
    });
    expect(redeemOutcome({ ok: true, status: 202 }, { status: "waiting" })).toEqual({
      kind: "step",
      step: "waiting",
    });
  });
});
