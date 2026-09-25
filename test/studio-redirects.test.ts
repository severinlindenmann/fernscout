import { describe, expect, test } from "vitest";
import AccountRedirectPage from "@/app/[user]/account/page";
import VisitorsRedirectPage from "@/app/[user]/me/analytics/page";
import CostsRedirectPage from "@/app/[user]/studio/costs/page";
import TripRenameRedirectPage from "@/app/[user]/studio/trip/rename/page";
import ContactsRedirectPage from "@/app/[user]/contacts/page";
import InviteRedirectPage from "@/app/[user]/studio/reader/invite/page";

/**
 * B2020 — the two page routes the studio move (B2016/B2017) left behind as
 * permanent redirects rather than deleting, so an old bookmark or a link
 * mailed before the move still lands somewhere. `redirect()` reports itself
 * by throwing; the target is in the digest — same pattern as
 * `test/current-trip.test.ts`.
 */
function digestOf(err: unknown): string {
  return typeof err === "object" && err !== null && "digest" in err
    ? String((err as { digest: unknown }).digest)
    : "";
}

async function redirectTarget(page: () => Promise<unknown>): Promise<string | null> {
  try {
    await page();
  } catch (err) {
    const digest = digestOf(err);
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw err;
  }
  return null;
}

describe("old account and me paths still redirect", () => {
  test("/[user]/account -> /[user]/studio/account", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({});
    await expect(
      redirectTarget(() => AccountRedirectPage({ params, searchParams })),
    ).resolves.toBe("/alex/studio/account");
  });

  test("/[user]/me/analytics -> /[user]/studio/visitors", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({});
    await expect(
      redirectTarget(() => VisitorsRedirectPage({ params, searchParams })),
    ).resolves.toBe("/alex/studio/visitors");
  });

  test("/[user]/me/analytics forwards ?days= rather than dropping it", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({ days: "30" });
    await expect(
      redirectTarget(() => VisitorsRedirectPage({ params, searchParams })),
    ).resolves.toBe("/alex/studio/visitors?days=30");
  });

  test("/[user]/studio/costs -> /[user]/studio/statement (B2083)", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({});
    await expect(redirectTarget(() => CostsRedirectPage({ params, searchParams }))).resolves.toBe(
      "/alex/studio/statement",
    );
  });
});

describe("the retired rename page lands on Edit a trip's address section — B2072", () => {
  test("/[user]/studio/trip/rename?trip=x -> /[user]/studio/trip?trip=x&section=address", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({ trip: "lisbon-2025" });
    await expect(
      redirectTarget(() => TripRenameRedirectPage({ params, searchParams })),
    ).resolves.toBe("/alex/studio/trip?trip=lisbon-2025&section=address");
  });

  test("without ?trip= it still lands on Edit a trip, whose picker asks which", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({});
    await expect(
      redirectTarget(() => TripRenameRedirectPage({ params, searchParams })),
    ).resolves.toBe("/alex/studio/trip?section=address");
  });
});

describe("the old contacts page lands on the studio's Readers — B2092", () => {
  test("/[user]/contacts -> /[user]/studio/readers", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({});
    await expect(
      redirectTarget(() => ContactsRedirectPage({ params, searchParams })),
    ).resolves.toBe("/alex/studio/readers");
  });

  test("an approval mail's ?contact= survives the move", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({ contact: "c 1" });
    await expect(
      redirectTarget(() => ContactsRedirectPage({ params, searchParams })),
    ).resolves.toBe("/alex/studio/readers?contact=c%201");
  });
});

describe("the invite flow lands on the readers page's invite section — B2133", () => {
  test("/[user]/studio/reader/invite -> /[user]/studio/readers#invite", async () => {
    const params = Promise.resolve({ user: "alex" });
    const searchParams = Promise.resolve({});
    await expect(
      redirectTarget(() => InviteRedirectPage({ params, searchParams })),
    ).resolves.toBe("/alex/studio/readers#invite");
  });
});
