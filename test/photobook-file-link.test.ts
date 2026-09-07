import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signFileLink, verifyFileLink } from "@/lib/photobook/fileLink";

const OWNER = "someone";
const ID = "b-2026-abcdefg";
const FILE = "book-interior.pdf";

beforeAll(() => {
  process.env.SESSION_SECRET = "file-link-test-secret-file-link-test";
});

afterAll(() => {
  delete process.env.SESSION_SECRET;
});

function parts(query: string) {
  const p = new URLSearchParams(query.replace(/^\?/, ""));
  return { exp: p.get("exp"), sig: p.get("sig") };
}

describe("the link Gelato is given", () => {
  it("verifies what it signed", () => {
    const { exp, sig } = parts(signFileLink(OWNER, ID, FILE));
    expect(verifyFileLink(OWNER, ID, FILE, exp, sig)).toBe(true);
  });

  it("refuses a signature for a different file", () => {
    const { exp, sig } = parts(signFileLink(OWNER, ID, FILE));
    expect(verifyFileLink(OWNER, ID, "book-cover.pdf", exp, sig)).toBe(false);
  });

  it("refuses a signature for a different journal", () => {
    const { exp, sig } = parts(signFileLink(OWNER, ID, FILE));
    expect(verifyFileLink("someone-else", ID, FILE, exp, sig)).toBe(false);
  });

  it("refuses an expiry that has passed", () => {
    const { exp, sig } = parts(signFileLink(OWNER, ID, FILE, 1000));
    expect(verifyFileLink(OWNER, ID, FILE, exp, sig, Date.now() + 2000)).toBe(false);
  });

  it("refuses a tampered expiry, so the clock cannot simply be moved", () => {
    const { sig } = parts(signFileLink(OWNER, ID, FILE, 1000));
    const far = String(Date.now() + 86_400_000);
    expect(verifyFileLink(OWNER, ID, FILE, far, sig)).toBe(false);
  });

  it("refuses a missing signature outright", () => {
    expect(verifyFileLink(OWNER, ID, FILE, null, null)).toBe(false);
  });
});
