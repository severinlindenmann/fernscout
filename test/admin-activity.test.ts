import { describe, expect, test } from "vitest";
import { activityFeed, type FeedSources } from "@/lib/adminActivity";

/**
 * The Activity section reads back records other things keep; it keeps none of
 * its own. These pin the two properties that matter: newest first, and nothing
 * older than the window the page is showing.
 */

function sources(over: Partial<FeedSources> = {}): FeedSources {
  return {
    signups: null,
    payments: [],
    wrote: {},
    backups: [],
    acks: [],
    troubles: [],
    sms: [],
    tombstones: [],
    ...over,
  };
}

describe("activityFeed", () => {
  test("is newest first across sources, and drops what is older than the window", () => {
    const feed = activityFeed(
      sources({
        signups: { "test-a": "2026-09-20T08:00:00.000Z", "test-old": "2026-01-01T00:00:00.000Z" },
        wrote: { "test-a": "2026-09-24T21:00:00.000Z", "test-b": null },
        backups: [{ at: "2026-09-25T03:00:00.000Z", which: "secondary", outcome: "failed" }],
      }),
      "2026-09-01",
    );
    expect(feed.map((one) => one.text)).toEqual([
      "Off-site copy failed",
      "test-a wrote in their journal",
      "test-a started a journal",
    ]);
    expect(feed[0].alert).toBe(true);
  });

  test("never quotes an SMS", () => {
    const feed = activityFeed(
      sources({ sms: [{ direction: "in", createdAt: "2026-09-25T09:00:00.000Z" }] }),
      "2026-09-01",
    );
    expect(feed).toEqual([
      { at: "2026-09-25T09:00:00.000Z", kind: "sms", text: "An SMS arrived", owner: null, alert: false },
    ]);
  });
});
