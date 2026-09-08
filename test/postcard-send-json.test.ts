import { describe, expect, test, vi } from "vitest";

/**
 * B982 — the send route asked for JSON.
 *
 * The page posts this route with `fetch` now rather than navigating, because a
 * 303 to a fresh document at the end of the one press in this product that
 * spends money is a white flash where a confirmation belongs. What must not
 * drift is that the JSON branch is a second *phrasing* of the same route and
 * never a second set of decisions — same guards, same words, and no answer
 * that would let a caller read "sent" off something that did not send.
 *
 * `isOwner` is mocked because the real one reads `cookies()`, which throws
 * outside a request scope. That is the one thing stubbed. `sendOrder` is the
 * real function, and with no journal configured under this test's content root
 * it refuses at its first line — which is all that is wanted here: a refusal
 * that came from the shared code path, so the two phrasings can be compared
 * against each other.
 */
vi.mock("@/lib/contacts/session", () => ({ isOwner: async () => true }));

describe("the send route, asked for JSON", () => {
  test("an order-level refusal is a 200 and a word to read out", async () => {
    const { POST } = await import("@/app/[user]/postcards/[id]/send/route");
    const response = await POST(
      new Request("http://x/ana/postcards/nope/send", {
        method: "POST",
        headers: { accept: "application/json" },
      }),
      { params: Promise.resolve({ user: "ana", id: "nope" }) },
    );
    // 200, because every one of these is a sentence for the owner rather
    // than a transport failure — the page shows the word it is given.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "postcards_off" });
    // And never a redirect: a `fetch` follows one and gets a document it
    // would then have to guess the meaning of.
    expect(response.headers.get("location")).toBeNull();
  });

  test("without that header it is still the redirect it always was", async () => {
    const { POST } = await import("@/app/[user]/postcards/[id]/send/route");
    const response = await POST(
      new Request("http://x/ana/postcards/nope/send", { method: "POST" }),
      { params: Promise.resolve({ user: "ana", id: "nope" }) },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/ana/postcards/nope?result=postcards_off#send",
    );
  });

  test("an agent token is refused whatever it asks for", async () => {
    const { POST } = await import("@/app/[user]/postcards/[id]/send/route");
    const response = await POST(
      new Request("http://x/ana/postcards/nope/send", {
        method: "POST",
        headers: { accept: "application/json", authorization: "Bearer t" },
      }),
      { params: Promise.resolve({ user: "ana", id: "nope" }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("not_for_agents");
  });
});
