import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * B1559 — a second layer behind `sameSite: "lax"` on the three doors that
 * spend credits at a printer or delete a trip from the owner's cookie alone:
 * postcard send, photobook order, trip delete. None of the three carry a
 * CSRF token, so protection today rests entirely on the cookie attribute.
 * `lib/auth/originCheck.ts`'s `foreignOrigin()` is the shared check; this
 * file is the property that must hold on all three doors plus the unit
 * behaviour of the helper itself.
 *
 * `site/config.json`'s `site.url` is `https://fernscout.ch` in this
 * checkout, which is what makes it the "own" origin below.
 */

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));
vi.mock("@/lib/capabilities", () => ({ isEnabled: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/postcard/send", () => ({ sendOrder: vi.fn() }));
vi.mock("@/lib/deletions", () => ({
  summarise: vi.fn(),
  deleteTrip: vi.fn(),
  humanBytes: vi.fn(),
}));

import { isOwner } from "@/lib/contacts/session";
import { foreignOrigin } from "@/lib/auth/originCheck";

const OWN_ORIGIN = "https://fernscout.ch";
const FOREIGN_ORIGIN = "https://evil.example";

afterEach(() => {
  vi.clearAllMocks();
});

describe("foreignOrigin()", () => {
  test("no Origin header at all is allowed through", () => {
    const request = new Request("https://fernscout.ch/x", { method: "POST" });
    expect(foreignOrigin(request)).toBe(false);
  });

  test("an Origin matching the configured site is allowed", () => {
    const request = new Request("https://fernscout.ch/x", {
      method: "POST",
      headers: { origin: OWN_ORIGIN },
    });
    expect(foreignOrigin(request)).toBe(false);
  });

  test("a mismatched Origin is refused", () => {
    const request = new Request("https://fernscout.ch/x", {
      method: "POST",
      headers: { origin: FOREIGN_ORIGIN },
    });
    expect(foreignOrigin(request)).toBe(true);
  });

  test("falls back to the request's own Host — dev, and a proxied deploy", () => {
    // `site.url` is fernscout.ch here, but the request itself arrived on
    // localhost:3000 — the shape of local dev, and of a `site.url` that has
    // drifted from what the reverse proxy actually forwards.
    const request = new Request("http://localhost:3000/x", {
      method: "POST",
      headers: { origin: "http://localhost:3000", host: "localhost:3000" },
    });
    expect(foreignOrigin(request)).toBe(false);
  });

  test("scheme is not part of the comparison", () => {
    // A proxy terminating TLS can see http where the browser sent https;
    // that difference says nothing about which site the request is from.
    const request = new Request("https://fernscout.ch/x", {
      method: "POST",
      headers: { origin: "http://fernscout.ch" },
    });
    expect(foreignOrigin(request)).toBe(false);
  });
});

describe("the postcard send route", () => {
  test("a foreign Origin is refused with a stable error code", async () => {
    const { POST } = await import("@/app/[user]/postcards/[id]/send/route");
    const response = await POST(
      new Request("https://fernscout.ch/ana/postcards/abc/send", {
        method: "POST",
        headers: { origin: FOREIGN_ORIGIN },
      }),
      { params: Promise.resolve({ user: "ana", id: "abc" }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("foreign_origin");
    expect(isOwner).not.toHaveBeenCalled();
  });

  test("the site's own Origin proceeds to the route's normal logic", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    const { POST } = await import("@/app/[user]/postcards/[id]/send/route");
    const response = await POST(
      new Request("https://fernscout.ch/ana/postcards/abc/send", {
        method: "POST",
        headers: { origin: OWN_ORIGIN },
      }),
      { params: Promise.resolve({ user: "ana", id: "abc" }) },
    );
    expect(isOwner).toHaveBeenCalled();
    expect(response.status).not.toBe(403);
  });

  test("no Origin header proceeds to the route's normal logic", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    const { POST } = await import("@/app/[user]/postcards/[id]/send/route");
    const response = await POST(
      new Request("https://fernscout.ch/ana/postcards/abc/send", { method: "POST" }),
      { params: Promise.resolve({ user: "ana", id: "abc" }) },
    );
    expect(isOwner).toHaveBeenCalled();
    expect(response.status).not.toBe(403);
  });
});

describe("the photobook order route", () => {
  const params = Promise.resolve({ user: "alex" });

  test("a foreign Origin is refused with a stable error code, before anything is spent", async () => {
    const { POST } = await import("@/app/[user]/photobook/order/route");
    const response = await POST(
      new Request("https://fernscout.ch/alex/photobook/order", {
        method: "POST",
        headers: { origin: FOREIGN_ORIGIN },
        body: new URLSearchParams({ trip: "alex/asia-2026", orderId: "abc12345", options: "{}" }),
      }),
      { params },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("foreign_origin");
    expect(isOwner).not.toHaveBeenCalled();
  });

  test("the site's own Origin proceeds to the route's normal logic", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    const { POST } = await import("@/app/[user]/photobook/order/route");
    const response = await POST(
      new Request("https://fernscout.ch/alex/photobook/order", {
        method: "POST",
        headers: { origin: OWN_ORIGIN },
        body: new URLSearchParams({ trip: "alex/asia-2026", orderId: "abc12345", options: "{}" }),
      }),
      { params },
    );
    expect(isOwner).toHaveBeenCalled();
    expect(response.status).not.toBe(403);
  });

  test("no Origin header proceeds to the route's normal logic", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    const { POST } = await import("@/app/[user]/photobook/order/route");
    const response = await POST(
      new Request("https://fernscout.ch/alex/photobook/order", {
        method: "POST",
        body: new URLSearchParams({ trip: "alex/asia-2026", orderId: "abc12345", options: "{}" }),
      }),
      { params },
    );
    expect(isOwner).toHaveBeenCalled();
    expect(response.status).not.toBe(403);
  });
});

describe("the trip delete route", () => {
  const params = Promise.resolve({ user: "ana", trip: "alps-2026" });

  test("a foreign Origin is refused with a stable error code, before anything is deleted", async () => {
    const { POST } = await import("@/app/[user]/trips/[trip]/delete/route");
    const response = await POST(
      new Request("https://fernscout.ch/ana/trips/alps-2026/delete", {
        method: "POST",
        headers: { origin: FOREIGN_ORIGIN },
      }),
      { params },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("foreign_origin");
    expect(isOwner).not.toHaveBeenCalled();
  });

  test("the site's own Origin proceeds to the route's normal logic", async () => {
    // `isOwner` false here still answers 403 — "forbidden", not the origin
    // check — so what proves the origin check let it through is that
    // `isOwner` ran at all and the body names the ordinary refusal.
    vi.mocked(isOwner).mockResolvedValue(false);
    const { POST } = await import("@/app/[user]/trips/[trip]/delete/route");
    const response = await POST(
      new Request("https://fernscout.ch/ana/trips/alps-2026/delete", {
        method: "POST",
        headers: { origin: OWN_ORIGIN },
      }),
      { params },
    );
    expect(isOwner).toHaveBeenCalled();
    expect((await response.json()).error).toBe("forbidden");
  });

  test("no Origin header proceeds to the route's normal logic", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    const { POST } = await import("@/app/[user]/trips/[trip]/delete/route");
    const response = await POST(
      new Request("https://fernscout.ch/ana/trips/alps-2026/delete", { method: "POST" }),
      { params },
    );
    expect(isOwner).toHaveBeenCalled();
    expect((await response.json()).error).toBe("forbidden");
  });
});
