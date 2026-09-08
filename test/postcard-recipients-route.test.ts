import { describe, expect, test, vi } from "vitest";

/**
 * B1005 — the recipients route, and the one thing it must not get wrong.
 *
 * `updateOrderRecipients` writes the ids it is given; deciding *which* ids are
 * admissible is this route's job, and the promise it keeps is the one the
 * whole feature rests on: **a card can only go to somebody who asked this
 * journal for one.** So the ids in the body are filtered against
 * `postcardCandidates` rather than trusted, and a body naming somebody who
 * never asked leaves the order alone.
 *
 * Both collaborators are stubbed here on purpose. The real `postcardCandidates`
 * wants a database, a contacts key and four rows of consent, all of which
 * `test/postcard-orders.test.ts` already builds for the store-level tests — and
 * none of which say anything about whether *this route* filters. Stubbing them
 * makes the filtering the only thing under test, and `updateOrderRecipients`
 * as a spy is what shows exactly which ids would have been written.
 */

const candidates = vi.fn(async () => [
  { contactId: "asked-1", name: "A", city: "Zurich", country: "CH", locale: "en" },
  { contactId: "asked-2", name: "B", city: "Bern", country: "CH", locale: "de" },
]);
const update = vi.fn(async () => true);

vi.mock("@/lib/contacts/session", () => ({ isOwner: async () => true }));
vi.mock("@/lib/postcard/contacts", () => ({ postcardCandidates: candidates }));
vi.mock("@/lib/postcard/orders", () => ({ updateOrderRecipients: update }));

async function post(recipients: string[], headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/[user]/postcards/[id]/recipients/route");
  const body = new FormData();
  for (const id of recipients) body.append("recipient", id);
  const response = await POST(
    new Request("http://x/ana/postcards/abc/recipients", {
      method: "POST",
      headers: { accept: "application/json", ...headers },
      body,
    }),
    { params: Promise.resolve({ user: "ana", id: "abc" }) },
  );
  return { response, json: await response.json() };
}

describe("changing who a card goes to, over the wire", () => {
  test("somebody who asked for a postcard is written", async () => {
    update.mockClear();
    const { response, json } = await post(["asked-1", "asked-2"]);
    expect(response.status).toBe(200);
    expect(json).toEqual({ result: "saved" });
    expect(update).toHaveBeenCalledWith("ana", "abc", ["asked-1", "asked-2"]);
  });

  test("somebody who never asked is dropped, and the rest still saves", async () => {
    update.mockClear();
    const { json } = await post(["asked-1", "never-asked"]);
    expect(json).toEqual({ result: "saved" });
    // The whole promise of the feature, in one assertion: the id that was not
    // a candidate does not reach the order.
    expect(update).toHaveBeenCalledWith("ana", "abc", ["asked-1"]);
  });

  test("a body of nobody-who-asked writes nothing at all", async () => {
    update.mockClear();
    const { response, json } = await post(["never-asked"]);
    expect(response.status).toBe(400);
    expect(json).toEqual({ result: "no_recipients" });
    expect(update).not.toHaveBeenCalled();
  });

  test("an agent token is refused before anything is read", async () => {
    update.mockClear();
    const { response, json } = await post(["asked-1"], { authorization: "Bearer t" });
    expect(response.status).toBe(403);
    expect(json.error).toBe("not_for_agents");
    expect(update).not.toHaveBeenCalled();
  });

  test("an order that has already gone answers 409 rather than pretending", async () => {
    update.mockClear();
    update.mockResolvedValueOnce(false);
    const { response, json } = await post(["asked-1"]);
    expect(response.status).toBe(409);
    expect(json).toEqual({ result: "already_sent" });
  });

  test("a form post is answered with the redirect the page's other forms take", async () => {
    const { POST } = await import("@/app/[user]/postcards/[id]/recipients/route");
    const body = new FormData();
    body.append("recipient", "asked-1");
    const response = await POST(
      new Request("http://x/ana/postcards/abc/recipients", { method: "POST", body }),
      { params: Promise.resolve({ user: "ana", id: "abc" }) },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/ana/postcards/abc?result=saved#send",
    );
  });
});
