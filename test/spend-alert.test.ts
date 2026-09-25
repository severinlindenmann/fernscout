import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The nightly spend check mails about one finished day, against the
 * operator's own line, and only when there is somebody to tell. Every way of
 * having nothing to do is a reason it prints, never a mail.
 */

const state = vi.hoisted(() => ({
  costsOn: true,
  line: 800,
  admin: "operator@example.test" as string | null,
  day: { date: "2026-09-24", rappen: 950, parts: [{ operation: "helper", rappen: 950 }] },
  sent: [] as { to: string; subject: string }[],
}));

vi.mock("@/lib/capabilities", () => ({ isEnabled: (name: string) => (name === "costs" ? state.costsOn : true) }));
vi.mock("@/lib/config", () => ({ loadServerConfig: () => ({ costs: { alertDailyRappen: state.line } }) }));
vi.mock("@/lib/admin", () => ({ adminEmail: () => state.admin }));
vi.mock("@/lib/site", () => ({ serverSite: () => ({ name: "Test", url: "https://example.test" }) }));
vi.mock("@/lib/instanceCosts", () => ({ dailyCosts: async () => [state.day] }));
vi.mock("@/lib/mail", () => ({
  sendMail: async (mail: { to: string; subject: string }) => {
    state.sent.push({ to: mail.to, subject: mail.subject });
    return { transport: "file", reference: "x" };
  },
}));

const { checkSpendAlert } = await import("@/lib/spendAlert");
const now = new Date("2026-09-25T03:00:00.000Z");

beforeEach(() => {
  state.costsOn = true;
  state.line = 800;
  state.admin = "operator@example.test";
  state.day = { date: "2026-09-24", rappen: 950, parts: [{ operation: "helper", rappen: 950 }] };
  state.sent = [];
});

describe("checkSpendAlert", () => {
  test("mails the operator when yesterday went over the line", async () => {
    const result = await checkSpendAlert({ now });
    expect(result).toMatchObject({ sent: true, dryRun: false, date: "2026-09-24", rappen: 950 });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toBe("operator@example.test");
  });

  test("a dry run says what it would do and sends nothing", async () => {
    const result = await checkSpendAlert({ now, dryRun: true });
    expect(result).toMatchObject({ sent: true, dryRun: true });
    expect(state.sent).toHaveLength(0);
  });

  test.each([
    ["under the line", () => (state.day = { ...state.day, rappen: 800 }), /under the line/],
    ["no line set", () => (state.line = 0), /no alert line/],
    ["costs off", () => (state.costsOn = false), /costs are switched off/],
    ["no operator", () => (state.admin = null), /nobody to tell/],
  ])("%s mails nobody", async (_name, arrange, reason) => {
    arrange();
    const result = await checkSpendAlert({ now });
    expect(result.sent).toBe(false);
    expect(result.sent ? "" : result.reason).toMatch(reason);
    expect(state.sent).toHaveLength(0);
  });
});
