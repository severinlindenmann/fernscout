import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "@/app/api/v2/journals/available/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeTombstone } from "@/lib/tombstones";

/** B-2808 — the open availability check asks what createJournal asks. */
describe("GET /api/v2/journals/available", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-available-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "F", url: "https://example.test", defaultUser: "x" }, users: { reserved: [] }, features: {} }),
    );
    clearConfigCache();
    clearUserCache();
  });
  afterEach(() => {
    delete process.env.CONTENT_DIR;
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const ask = async (u: string) =>
    (await (await GET(new Request(`http://t/api/v2/journals/available?username=${u}`))).json()) as Record<string, unknown>;

  test("a free name is available", async () => {
    expect(await ask("free-name")).toMatchObject({ available: true });
  });
  test("a folder with no readable config is taken", async () => {
    fs.mkdirSync(path.join(dir, "half-made"));
    expect(await ask("half-made")).toMatchObject({ available: false, reason: "username_taken" });
  });
  test("a deleted journal's name reads as taken, never as deleted", async () => {
    writeTombstone({
      kind: "journal", username: "gone-one", title: "t", deletedAt: "2026-01-01T00:00:00Z", requestedBy: "a@example.test",
      held: { files: 0, bytes: 0 }, notice: { lang: "en", title: "", body: "", homeLabel: "", homeHref: "/" },
    });
    const body = await ask("gone-one");
    expect(body).toMatchObject({ available: false, reason: "username_taken" });
    expect(JSON.stringify(body)).not.toMatch(/delete/);
  });
});
