import { afterEach, describe, expect, test } from "vitest";
import { GPS_TOKEN_REFRESH_BEFORE_MS, haptic, isNativeShell, needsGpsTokenRefresh, pickedToFile } from "@/components/nativeShell";

/**
 * The two pure halves of the iPhone shell's photo door — B2113. The picker
 * itself is native and only runs on a phone; what can be checked here is
 * that a page outside the shell never thinks it is inside, and that a
 * picked photograph becomes the same `File` the web `<input>` would have
 * produced.
 */
describe("isNativeShell", () => {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  afterEach(() => {
    if (before === undefined) delete g.window;
    else g.window = before;
  });

  test("false with no window at all (server render)", () => {
    delete g.window;
    expect(isNativeShell()).toBe(false);
  });

  test("false in a browser, where nothing injected a bridge", () => {
    g.window = {};
    expect(isNativeShell()).toBe(false);
  });

  test("true only when the injected bridge says the platform is native", () => {
    g.window = { Capacitor: { isNativePlatform: () => true } };
    expect(isNativeShell()).toBe(true);
    g.window = { Capacitor: { isNativePlatform: () => false } };
    expect(isNativeShell()).toBe(false);
  });
});

describe("haptic — B2324", () => {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  afterEach(() => {
    if (before === undefined) delete g.window;
    else g.window = before;
  });

  test("no bridge — no throw, and no plugin import", async () => {
    g.window = {};
    await expect(haptic("light")).resolves.toBeUndefined();
  });

  test("no window at all — same, no throw", async () => {
    delete g.window;
    await expect(haptic("selection")).resolves.toBeUndefined();
  });
});

describe("pickedToFile", () => {
  test("decodes the bytes and keeps name, type and modified time", async () => {
    const file = pickedToFile({
      name: "IMG_0001.HEIC",
      mimeType: "image/heic",
      data: btoa("not really heic"),
      modifiedAt: 1_700_000_000_000,
    });
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe("IMG_0001.HEIC");
    expect(file?.type).toBe("image/heic");
    expect(file?.lastModified).toBe(1_700_000_000_000);
    expect(await file?.text()).toBe("not really heic");
  });

  test("a pick the plugin could not read is skipped, not sent empty", () => {
    expect(pickedToFile({ name: "x.heic", mimeType: "image/heic" })).toBeUndefined();
  });
});

describe("needsGpsTokenRefresh — B2198's foreground refresh threshold", () => {
  const now = Date.UTC(2026, 8, 24);

  test("no expiry known yet — refresh", () => {
    expect(needsGpsTokenRefresh(undefined, now)).toBe(true);
  });

  test("just under 7 days left — refresh", () => {
    const expiresAt = new Date(now + GPS_TOKEN_REFRESH_BEFORE_MS - 1000).toISOString();
    expect(needsGpsTokenRefresh(expiresAt, now)).toBe(true);
  });

  test("exactly 7 days or more left — no refresh yet", () => {
    const expiresAt = new Date(now + GPS_TOKEN_REFRESH_BEFORE_MS).toISOString();
    expect(needsGpsTokenRefresh(expiresAt, now)).toBe(false);
  });

  test("already expired — refresh", () => {
    const expiresAt = new Date(now - 1000).toISOString();
    expect(needsGpsTokenRefresh(expiresAt, now)).toBe(true);
  });
});
