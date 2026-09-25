import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The operator writes to one journal's owner. Three properties: the route is
 * a 404 to everybody else, the owner's address never comes back to the
 * browser, and a mail that did not go out is never reported as sent.
 */

const state = vi.hoisted(() => ({
  admin: true,
  mailOff: null as "server" | "journal" | null,
  sent: [] as { to: string; headers?: Record<string, string> }[],
}));

vi.mock("@/lib/adminGate", () => ({ isInstanceAdmin: async () => state.admin }));
vi.mock("@/lib/admin", () => ({ adminEmail: () => "operator@example.test" }));
vi.mock("@/lib/users", () => ({ USERNAME_RE: /^[a-z0-9][a-z0-9-]{1,30}$/, userExists: (u: string) => u === "test-alps" }));
vi.mock("@/lib/config", () => ({ loadUserConfig: () => ({ owner: { name: "A", nickname: "A", email: "owner@example.test" } }) }));
vi.mock("@/lib/site", () => ({ serverSite: () => ({ name: "Test", url: "https://example.test" }) }));
vi.mock("@/lib/mail", () => ({
  mailDisabledReason: () => state.mailOff,
  sendMail: async (mail: { to: string; headers?: Record<string, string> }) => {
    state.sent.push(mail);
    return { transport: "file", reference: "/tmp/x.eml" };
  },
}));

let ip = 0;
async function post(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/admin/message/route");
  ip += 1;
  const response = await POST(
    new Request("https://example.test/api/admin/message", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${ip}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, text: await response.text() };
}

const note = { user: "test-alps", subject: "Your disk", body: "Nearly full.\n\nShall I raise it?" };

beforeEach(() => {
  state.admin = true;
  state.mailOff = null;
  state.sent = [];
});

describe("POST /api/admin/message", () => {
  test("does not exist for anybody but the operator", async () => {
    state.admin = false;
    expect((await post(note)).status).toBe(404);
    expect(state.sent).toHaveLength(0);
  });

  test("sends to the owner, replies to the operator, and never returns the address", async () => {
    const out = await post(note);
    expect(out.status).toBe(200);
    expect(out.text).not.toContain("owner@example.test");
    expect(state.sent[0].to).toBe("owner@example.test");
    expect(state.sent[0].headers?.["Reply-To"]).toBe("operator@example.test");
  });

  test("says nothing was sent when the journal has mail off", async () => {
    state.mailOff = "journal";
    const out = await post(note);
    expect(out.status).toBe(409);
    expect(out.text).toMatch(/Nothing was sent/);
    expect(state.sent).toHaveLength(0);
  });

  test("refuses an unknown journal and an empty message", async () => {
    expect((await post({ ...note, user: "nobody" })).status).toBe(404);
    expect((await post({ ...note, body: "  " })).status).toBe(400);
  });
});
