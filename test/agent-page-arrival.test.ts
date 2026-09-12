import { describe, expect, test } from "vitest";
import { arrivalFor } from "@/lib/helper/pageState";

/**
 * B1242 — the WhatsApp preview link carries both `?c=` (which conversation)
 * and `?about=` (which day) and must not forget the conversation to show
 * the day: `arrivalFor` is the one place that decides.
 */

describe("arrivalFor", () => {
  test("about alone (a link from a day) starts fresh", () => {
    expect(arrivalFor({ about: "japan-2027/2027-03-01" })).toEqual({
      opening: { trip: "japan-2027", slug: "2027-03-01" },
      named: "",
      shouldForget: true,
    });
  });

  test("c alone (reopening a conversation) never forgets", () => {
    expect(arrivalFor({ c: "session-1" })).toEqual({
      opening: null,
      named: "session-1",
      shouldForget: false,
    });
  });

  test("c and about together — the WhatsApp preview link — adopts the session and still names the day", () => {
    expect(arrivalFor({ c: "session-1", about: "japan-2027/2027-03-01" })).toEqual({
      opening: { trip: "japan-2027", slug: "2027-03-01" },
      named: "session-1",
      shouldForget: false,
    });
  });

  test("neither present resumes whatever is live", () => {
    expect(arrivalFor({})).toEqual({ opening: null, named: "", shouldForget: false });
  });
});
