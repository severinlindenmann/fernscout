import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * `app/api/helper/[user]/gps/route.ts`'s own door guard — security review,
 * 2026-09-24.
 *
 * The raw location history is the most sensitive thing this repository
 * stores (AGENTS.md), so its cookie door is tightened past the ordinary
 * `isHelperOwner` every other helper route uses: `isHelperOwner` accepts the
 * operator's admin cookie for any journal (`resolveCookieCaller`,
 * `lib/helper/caller.ts`), which is the right answer for a day or a trip and
 * the wrong one here. This asserts the two extra layers directly:
 *
 * - **The admin cookie is refused.** `isHelperOwner` true is not enough; the
 *   resolved address must equal `config.json`'s own `owner.email`.
 * - **A foreign Origin is refused on `DELETE`**, the same second layer
 *   `app/[user]/trips/[trip]/delete/route.ts` (B1559) puts behind
 *   `sameSite: "lax"` for a cookie-only destructive call.
 */

vi.mock("@/lib/helper/server", () => ({
  isHelperOwner: vi.fn(),
  notYourJournal: vi.fn(async () => Response.json({ error: "not_your_journal" }, { status: 404 })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess: vi.fn() }));
vi.mock("@/lib/users", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/gps/api", () => ({
  gpsMonthsHeld: vi.fn().mockReturnValue(["2026-06"]),
  purgeGpsHistory: vi.fn().mockReturnValue({ monthsDeleted: ["2026-06"], monthsHeld: [] }),
}));

import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { resolveAccess } from "@/lib/auth/handshake";
import { getUser } from "@/lib/users";
import { purgeGpsHistory } from "@/lib/gps/api";

const USER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ADMIN_EMAIL = "admin@example.test";
const OWN_ORIGIN = "https://fernscout.ch";
const FOREIGN_ORIGIN = "https://evil.example";

function journal(email = OWNER_EMAIL) {
  return { owner: { email } } as ReturnType<typeof getUser>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the gps purge cookie door — owner only, not just isHelperOwner", () => {
  test("the owner's own address is let through", async () => {
    vi.mocked(isHelperOwner).mockResolvedValue(true);
    vi.mocked(resolveAccess).mockResolvedValue({ email: OWNER_EMAIL, session: null, identity: null });
    vi.mocked(getUser).mockReturnValue(journal());

    const { GET } = await import("@/app/api/helper/[user]/gps/route");
    const response = await GET(new Request(`${OWN_ORIGIN}/api/helper/${USER}/gps`), {
      params: Promise.resolve({ user: USER }),
    });
    expect(response.status).toBe(200);
    expect(notYourJournal).not.toHaveBeenCalled();
  });

  test("the operator's admin cookie is refused, even though isHelperOwner accepts it", async () => {
    // The exact shape `isHelperOwner` itself would say yes to: an admin
    // address, not the journal's own owner — `resolveCookieCaller` allows it
    // via `isAdminEmail`, which is why this route may not stop at
    // `isHelperOwner` alone.
    vi.mocked(isHelperOwner).mockResolvedValue(true);
    vi.mocked(resolveAccess).mockResolvedValue({ email: ADMIN_EMAIL, session: null, identity: null });
    vi.mocked(getUser).mockReturnValue(journal());

    const { GET } = await import("@/app/api/helper/[user]/gps/route");
    const response = await GET(new Request(`${OWN_ORIGIN}/api/helper/${USER}/gps`), {
      params: Promise.resolve({ user: USER }),
    });
    expect(notYourJournal).toHaveBeenCalledWith(expect.anything(), USER);
    expect(response.status).toBe(404);
  });

  test("no journal at all is refused, whatever isHelperOwner says", async () => {
    vi.mocked(isHelperOwner).mockResolvedValue(true);
    vi.mocked(resolveAccess).mockResolvedValue({ email: OWNER_EMAIL, session: null, identity: null });
    vi.mocked(getUser).mockReturnValue(null);

    const { GET } = await import("@/app/api/helper/[user]/gps/route");
    const response = await GET(new Request(`${OWN_ORIGIN}/api/helper/${USER}/gps`), {
      params: Promise.resolve({ user: USER }),
    });
    expect(response.status).toBe(404);
  });

  test("GET responses are private, no-store", async () => {
    vi.mocked(isHelperOwner).mockResolvedValue(true);
    vi.mocked(resolveAccess).mockResolvedValue({ email: OWNER_EMAIL, session: null, identity: null });
    vi.mocked(getUser).mockReturnValue(journal());

    const { GET } = await import("@/app/api/helper/[user]/gps/route");
    const response = await GET(new Request(`${OWN_ORIGIN}/api/helper/${USER}/gps`), {
      params: Promise.resolve({ user: USER }),
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("the gps purge cookie door — DELETE's own origin check", () => {
  test("a foreign Origin is refused before anything is purged", async () => {
    vi.mocked(isHelperOwner).mockResolvedValue(true);
    vi.mocked(resolveAccess).mockResolvedValue({ email: OWNER_EMAIL, session: null, identity: null });
    vi.mocked(getUser).mockReturnValue(journal());

    const { DELETE } = await import("@/app/api/helper/[user]/gps/route");
    const response = await DELETE(
      new Request(`${OWN_ORIGIN}/api/helper/${USER}/gps`, {
        method: "DELETE",
        headers: { origin: FOREIGN_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      }),
      { params: Promise.resolve({ user: USER }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("foreign_origin");
    expect(purgeGpsHistory).not.toHaveBeenCalled();
  });

  test("the site's own Origin proceeds to a real purge", async () => {
    vi.mocked(isHelperOwner).mockResolvedValue(true);
    vi.mocked(resolveAccess).mockResolvedValue({ email: OWNER_EMAIL, session: null, identity: null });
    vi.mocked(getUser).mockReturnValue(journal());

    const { DELETE } = await import("@/app/api/helper/[user]/gps/route");
    const response = await DELETE(
      new Request(`${OWN_ORIGIN}/api/helper/${USER}/gps`, {
        method: "DELETE",
        headers: { origin: OWN_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      }),
      { params: Promise.resolve({ user: USER }) },
    );
    expect(response.status).toBe(200);
    expect(purgeGpsHistory).toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
