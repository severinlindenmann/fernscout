import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * B2644 — an image file input on iOS offers "Take Photo or Video", and iOS
 * ends any app that opens the camera without a camera purpose string. The
 * studio has image inputs, so the shell's Info.plist must carry one.
 */
test("the iPhone shell says why it uses the camera", () => {
  const plist = readFileSync("ios/App/App/Info.plist", "utf8");
  const text = plist.match(/<key>NSCameraUsageDescription<\/key>\s*<string>([^<]*)<\/string>/)?.[1] ?? "";
  expect(text.trim().length).toBeGreaterThan(20);
});
