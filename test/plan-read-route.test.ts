import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * The route half — B2010.
 *
 * `test/plan-read-pasted.test.ts` already covers the parse table
 * exhaustively; this only proves the network shapes the pure module cannot
 * (a Maps link, resolved and unresolved) and the same owner gate every
 * sibling `app/api/helper/**` route uses — copying the fixture from
 * `test/helper-day-flow.test.ts`'s "somebody else's cookie sees nothing at
 * all" test.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST } = await import("@/app/api/helper/[user]/plan/read/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://t.test/api/helper/alex/plan/read", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-plan-read-"));
  process.env.CONTENT_DIR = dir;
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/helper/[user]/plan/read", () => {
  test("a URL outside the Maps allow-list is a link, and no fetch is ever attempted", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await read(await POST(post({ text: "http://evil.example/@1,2" }), params));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: "link", url: "http://evil.example/@1,2", title: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a Maps link that resolves becomes a place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200, headers: { "content-location": "" } })),
    );
    // maps.app.goo.gl short-links carry no coordinates without a redirect;
    // stub `fetch` to answer with a 200 whose body/headers carry nothing
    // useful, so `resolveMapsLink` lands on its own "nothing was derived"
    // path deterministically — the maps.google.com `@lat,lng` form needs no
    // fetch at all, which is the simpler, still-real case exercised here.
    const res = await read(
      await POST(post({ text: "here: https://maps.google.com/maps/@46.9480,7.4474,15z" }), params),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "place", lat: 46.948, lng: 7.4474, source: "maps-link" });
  });

  test("a Maps link that resolves to nothing answers link, not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const res = await read(await POST(post({ text: "https://maps.app.goo.gl/deadlink" }), params));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: "link", url: "https://maps.app.goo.gl/deadlink", title: null });
  });

  test("two decimals in range are coordinates", async () => {
    const res = await read(await POST(post({ text: "46.9480, 7.4474" }), params));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: "coordinates", lat: 46.948, lng: 7.4474 });
  });

  test("a leading number with a label is a cost, with a guessed category", async () => {
    const res = await read(await POST(post({ text: "1640 flights zürich bangkok" }), params));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: "cost", amount: 1640, label: "flights zürich bangkok", category: "flights" });
  });

  test("anything else is a place-query for the existing type-ahead", async () => {
    const res = await read(await POST(post({ text: "Hotel Schweizerhof" }), params));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: "place-query", q: "Hotel Schweizerhof" });
  });

  test("a guest / non-owner cookie sees nothing at all", async () => {
    resolveAccess.mockResolvedValue({ email: "someone-else@example.test" });
    const res = await read(await POST(post({ text: "Hotel Schweizerhof" }), params));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_your_journal");
  });

  test("an agent bearer token gets the same refusal every helper route gives it", async () => {
    // A bearer token carries no browser cookie, so — same as a real
    // request — `resolveAccess` sees no address; `notYourJournal` then
    // answers on the `Authorization` header alone, unconditionally.
    resolveAccess.mockResolvedValue({ email: null });
    const res = await read(
      await POST(post({ text: "Hotel Schweizerhof" }, { authorization: "Bearer some-agent-token" }), params),
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_your_journal");
  });

  test("text over the cap is refused", async () => {
    const res = await read(await POST(post({ text: "x".repeat(1000) }), params));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("text_too_long");
  });
});
