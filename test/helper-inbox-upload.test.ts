import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { listInbox } from "@/lib/inbox";
import { paintJpeg } from "./support/pictures";

/**
 * The room's own door into the inbox — B1171.
 *
 * The validation itself lives in `lib/inboxUpload.ts` and is exercised at
 * length through `test/inbox-route.test.ts` (the v1 door shares it
 * verbatim). What this file asserts is the door: the cookie gate, that a
 * stored file really lands in `inbox/` with its sidecar, and that the
 * answer carries what the pane needs to draw the tile without a reload.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST } = await import("@/app/api/helper/[user]/inbox/route");

let dir: string;

function request(user: string, files: { name: string; bytes: Buffer; type: string }[]) {
  const form = new FormData();
  for (const file of files) {
    form.append("files", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  }
  return POST(new Request(`https://t.test/api/helper/${user}/inbox`, { method: "POST", body: form }), {
    params: Promise.resolve({ user }),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-inbox-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the owner uploading from the room's files pane", () => {
  test("a photograph lands in the inbox with its sidecar, and the answer can draw the tile", async () => {
    const response = await request("alex", [
      { name: "beach.jpg", bytes: await paintJpeg(400, 300, 1), type: "image/jpeg" },
    ]);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { items: { id: string; filename: string; kind: string; uploadedAt: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].filename).toBe("beach.jpg");
    expect(body.items[0].kind).toBe("media");
    // What the pane maps into a `RoomFile` without a reload.
    expect(body.items[0].id).toBeTruthy();
    expect(body.items[0].uploadedAt).toBeTruthy();
    // And it is really on disk, sidecar beside it.
    const staged = listInbox("alex");
    expect(staged.media).toHaveLength(1);
    expect(staged.media[0].filename).toBe("beach.jpg");
  });

  test("a document files under files, not media", async () => {
    const response = await request("alex", [
      { name: "statement.csv", bytes: Buffer.from("a,b\n1,2\n"), type: "text/csv" },
    ]);
    expect(response.status).toBe(201);
    const staged = listInbox("alex");
    expect(staged.files).toHaveLength(1);
    expect(staged.media).toHaveLength(0);
  });
});

describe("everyone else", () => {
  test("no session is refused, and nothing lands", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const response = await request("alex", [
      { name: "beach.jpg", bytes: await paintJpeg(400, 300, 2), type: "image/jpeg" },
    ]);
    expect(response.status).not.toBe(201);
    expect(listInbox("alex").media).toHaveLength(0);
  });

  test("somebody else's session is refused the same way", async () => {
    resolveAccess.mockResolvedValue({ email: "sam@example.test" });
    const response = await request("alex", [
      { name: "beach.jpg", bytes: await paintJpeg(400, 300, 3), type: "image/jpeg" },
    ]);
    expect(response.status).not.toBe(201);
    expect(listInbox("alex").media).toHaveLength(0);
  });
});
