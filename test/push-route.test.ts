import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { GET } from "@/app/api/push/subscribe/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * The capability gate at the API boundary `components/PushOptIn.tsx` reads.
 *
 * The component itself renders nothing off this response (`res.enabled`
 * false ⇒ null), so this is the one place that behaviour can be pinned down
 * without a browser: `push.enabled=false` must mean no VAPID key is handed
 * out either, for any reason the capability can be off — server-wide, or just
 * for this journal.
 */

let dir: string;

function writeServerConfig(featuresEnabled: boolean) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { push: { enabled: featuresEnabled } },
    }),
  );
  clearConfigCache();
}

function writeUser(username: string, pushEnabled: boolean) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { push: { enabled: pushEnabled } },
    }),
  );
  clearUserCache();
}

function get(username: string | null) {
  const url = username
    ? `https://example.test/api/push/subscribe?user=${encodeURIComponent(username)}`
    : "https://example.test/api/push/subscribe";
  return GET(new Request(url));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-push-route-"));
  process.env.CONTENT_DIR = dir;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/push/subscribe", () => {
  test("no user given: disabled, no key", async () => {
    writeServerConfig(true);
    const res = await get(null);
    expect(await res.json()).toEqual({ publicKey: null, enabled: false });
  });

  test("unknown user: disabled, no key", async () => {
    writeServerConfig(true);
    const res = await get("nobody");
    expect(await res.json()).toEqual({ publicKey: null, enabled: false });
  });

  test("server-wide push off: disabled, no key, even with VAPID configured and the user opted in", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:x@example.test";
    writeServerConfig(false);
    writeUser("ana", true);
    const res = await get("ana");
    expect(await res.json()).toEqual({ publicKey: null, enabled: false });
  });

  test("this journal opted out: disabled, no key, even though the server allows it", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:x@example.test";
    writeServerConfig(true);
    writeUser("ana", false);
    const res = await get("ana");
    expect(await res.json()).toEqual({ publicKey: null, enabled: false });
  });

  test("push on, but no VAPID keys set: disabled, no key", async () => {
    writeServerConfig(true);
    writeUser("ana", true);
    const res = await get("ana");
    expect(await res.json()).toEqual({ publicKey: null, enabled: false });
  });

  test("everything configured: enabled, with the public key", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub-key";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:x@example.test";
    writeServerConfig(true);
    writeUser("ana", true);
    const res = await get("ana");
    expect(await res.json()).toEqual({ publicKey: "pub-key", enabled: true });
  });
});
