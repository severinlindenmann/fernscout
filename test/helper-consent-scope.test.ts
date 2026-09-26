import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `DELETE /api/helper/[user]/consent` — B2147.
 *
 * An empty or unreadable body used to default the scope to withdraw to
 * `words` — `scopeOf`'s "no panel said otherwise" default, meant for `POST`.
 * A withdrawal must never guess which consent to take back: an explicit,
 * valid `scope` or a 400, store untouched. Same owner-mocking approach
 * `extract-run-delete.test.ts` uses.
 */
const owner = vi.hoisted(() => ({ yes: true }));
vi.mock("@/lib/helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/server")>();
  return { ...actual, isHelperOwner: async () => owner.yes };
});

vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

beforeEach(() => {
  owner.yes = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-consent-scope-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

function consentFile(): string {
  return path.join(dir, "alex", "helper-consent.json");
}

describe("DELETE /api/helper/[user]/consent — B2147", () => {
  test("an empty body is refused with 400 and withdraws nothing", async () => {
    const { recordHelperConsent } = await import("@/lib/helper/consent");
    recordHelperConsent("alex", "Anthropic", "words");
    const before = fs.readFileSync(consentFile(), "utf8");

    const { DELETE } = await import("@/app/api/helper/[user]/consent/route");
    const response = await DELETE(
      new Request("https://t.test/api/helper/alex/consent", { method: "DELETE" }),
      params,
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("scope_required");
    expect(fs.readFileSync(consentFile(), "utf8")).toBe(before);
  });

  test("an unparseable body is refused with 400 and withdraws nothing", async () => {
    const { recordHelperConsent } = await import("@/lib/helper/consent");
    recordHelperConsent("alex", "Anthropic", "words");
    const before = fs.readFileSync(consentFile(), "utf8");

    const { DELETE } = await import("@/app/api/helper/[user]/consent/route");
    const response = await DELETE(
      new Request("https://t.test/api/helper/alex/consent", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      params,
    );

    expect(response.status).toBe(400);
    expect(fs.readFileSync(consentFile(), "utf8")).toBe(before);
  });

  test("an explicit, valid scope still withdraws it", async () => {
    const { recordHelperConsent, hasHelperConsent } = await import("@/lib/helper/consent");
    recordHelperConsent("alex", "Anthropic", "words");

    const { DELETE } = await import("@/app/api/helper/[user]/consent/route");
    const response = await DELETE(
      new Request("https://t.test/api/helper/alex/consent", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "words" }),
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(hasHelperConsent("alex", "words")).toBe(false);
  });
});
