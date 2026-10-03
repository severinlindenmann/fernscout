import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// The operator: passes isOwner (B480) but is not the journal's own owner.
vi.mock("@/lib/contacts/session", () => ({
  isOwner: async () => true,
  isJournalOwnerCookie: async () => false,
}));
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));
vi.mock("@/lib/users", () => ({ getUser: () => ({}) }));
vi.mock("@/lib/trips", () => ({ tripRef: (u: string, t: string) => `${u}/${t}`, getTrip: () => ({}) }));
vi.mock("@/lib/groupRoster", () => ({
  parseRoster: () => ({ ok: true, roster: {} }),
  readRoster: () => ({ students: [{ id: "a1", name: "Lea" }], duty: {} }),
  writeRoster: vi.fn(),
}));
import { GET, PUT } from "@/app/api/web/[user]/trips/[trip]/roster/route";

const ctx = { params: Promise.resolve({ user: "u", trip: "t" }) } as never;

describe("B2435 roster is the journal owner's alone", () => {
  it("the operator is refused on GET and PUT", async () => {
    expect((await GET(new Request("https://t.test/x"), ctx)).status).toBe(403);
    expect((await PUT(new Request("https://t.test/x", { method: "PUT", body: "{}" }), ctx)).status).toBe(403);
  });
});
