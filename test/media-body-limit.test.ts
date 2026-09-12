import { describe, expect, test } from "vitest";
import { IMAGE_MAX_BYTES, REQUEST_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/validate/media";
import nextConfig from "@/next.config";

/**
 * B523 — a request body over 10 MiB was answered `400 expected_multipart`,
 * which names a malformed Content-Type and sends the caller to look at its own
 * request. The real cause was Next's `proxyClientMaxBodySize`: a proxied
 * request's body is buffered, and past the limit it is **truncated** rather
 * than refused, so `formData()` fails on what is left. One real import lost 15
 * of 75 photographs to it, every one an ordinary phone original inside every
 * documented limit.
 *
 * The route-driven half of this file (a body over/under the cap, and the
 * per-file cap being the right one for the kind of file) drove
 * `app/api/v1/[user]/trips/[trip]/media/route.ts`, deleted under B1613. The
 * v2 media door (`app/api/v2/[user]/media/route.ts`) enforces the identical
 * `REQUEST_MAX_BYTES` check before touching the body, on the same content-
 * length read, and `test/api-v2-media.test.ts` covers it there. What is left
 * here is the relationship between the constants themselves, which has
 * nothing to do with which route reads them.
 */
describe("the request-body cap", () => {
  test("is above the per-file cap, so the documented per-file limit is reachable", () => {
    // The whole point of B523: a 50 MB photograph is documented as acceptable,
    // and was not sendable because the body cap sat five times below it.
    expect(REQUEST_MAX_BYTES).toBeGreaterThan(IMAGE_MAX_BYTES);
  });

  test("and above the per-clip cap, which for a long time it was not", () => {
    // The same fault as the one above, one file type over: video was
    // advertised at 200 MB while the body cap stood at 64, so the largest clip
    // the documentation promised could not be sent through this door at all.
    // Both moved together; this is what keeps them moving together.
    expect(REQUEST_MAX_BYTES).toBeGreaterThan(VIDEO_MAX_BYTES);
  });

  test("is the number Next actually enforces, not a second one written in prose", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(REQUEST_MAX_BYTES);
  });
});
