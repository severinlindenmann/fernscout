import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { sendOutboundReply } from "@/lib/whatsapp/reply";
import { markInbound } from "@/lib/whatsapp/window";

/**
 * B1741 — a dry-run reply is the operator's record, not somebody's content.
 *
 * `sendDryRun` writes the complete outbound body to disk, and since B1736
 * that body can carry a live guest invite token — the one credential
 * `app/api/helper/[user]/invite/route.ts` deliberately shows once and stores
 * only as a hash. It was landing inside `content/<user>/`, which is the tree
 * that gets exported, backed up and handed over.
 *
 * Every other test in this family points `CONTENT_DIR` and `DATA_DIR` at one
 * temporary directory, so none of them can tell the two apart — which is
 * exactly why this was never caught by the suite. This one keeps them
 * separate, and that is the whole assertion.
 */

let contentDir: string;
let dataDir: string;

beforeEach(() => {
  contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-reply-content-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-reply-data-"));
  process.env.CONTENT_DIR = contentDir;
  process.env.DATA_DIR = dataDir;
  process.env.DATABASE_URL = `sqlite:${path.join(dataDir, "test.db")}`;
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  fs.writeFileSync(
    path.join(contentDir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Test", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        whatsappInbound: { enabled: true },
        whatsapp: { enabled: true, backend: "dry-run" },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(contentDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function kept(root: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const next = path.join(at, entry.name);
      if (entry.isDirectory()) walk(next);
      else out.push(path.relative(root, next));
    }
  };
  walk(root);
  return out;
}

test("a dry-run reply is kept under DATA_DIR, never inside a journal", async () => {
  // A body shaped like the one B1736 now sends: a sentence and a live link.
  const link = "https://t.test/someone/invite/guest/fs_inv_notarealtoken";
  // A reply is only deliverable inside the 24-hour window an inbound message
  // opens — the same precondition every real caller reaches this with.
  markInbound("someone", "41760000000");
  const sent = await sendOutboundReply(
    "41760000000",
    { kind: "text", body: `Here is the link.\n\n${link}` },
    "someone",
  );
  expect(sent).toEqual({ sent: true });

  const inData = kept(dataDir).filter((f) => f.includes("whatsapp-replies"));
  expect(inData).toHaveLength(1);
  expect(inData[0].startsWith(path.join("whatsapp-replies", "someone"))).toBe(true);
  expect(fs.readFileSync(path.join(dataDir, inData[0]), "utf8")).toContain(link);

  // The point of the ticket: no reply file under `content/`, and the token
  // itself nowhere in that tree. The journal's `whatsapp/.window/` marker is
  // there and belongs there — it is a timestamp, not a message
  // (`lib/whatsapp/binding.ts` says why it is a file rather than a row).
  const inContent = kept(contentDir);
  expect(inContent.filter((f) => f.includes("whatsapp-replies"))).toEqual([]);
  for (const file of inContent) {
    expect(fs.readFileSync(path.join(contentDir, file), "utf8")).not.toContain(link);
  }
});

test("a reply with no journal yet is kept too, under its own folder", async () => {
  const sent = await sendOutboundReply("41760000000", { kind: "text", body: "Hello." }, null);
  expect(sent).toEqual({ sent: true });

  const inData = kept(dataDir).filter((f) => f.includes("whatsapp-replies"));
  expect(inData).toHaveLength(1);
  expect(inData[0].startsWith(path.join("whatsapp-replies", ".whatsapp"))).toBe(true);
  expect(kept(contentDir)).toEqual(["config.json"]);
  // A stranger has no journal, so nothing at all should appear under content.
});
