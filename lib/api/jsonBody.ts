/**
 * A JSON request body with a ceiling — B2243.
 *
 * `request.json()` reads whatever arrives, however large, into memory before
 * anything can refuse it. Every JSON door here takes a document, a patch or a
 * handful of ids; none of them has a reason to take megabytes. The stream is
 * counted as it is read and abandoned at the ceiling, so a body that declares
 * no `Content-Length` (chunked) is held to the same number as one that does.
 *
 * Multipart upload doors are not this module's business: they have their own
 * limits (`REQUEST_MAX_BYTES`, `IMAGE_MAX_BYTES`) and never parse JSON.
 */

/**
 * 4 MB. The largest JSON document this server takes is a day at its schema
 * ceiling — 100,000 characters of prose, in the main language and a few
 * translations — which is under 2 MB even at UTF-8's four bytes a character.
 * A year of a household's card statement applied as cost rows is well under
 * one. Published as `limits.jsonBodyMaxBytes` at `GET /api/v2/status`.
 */
export const JSON_BODY_MAX_BYTES = 4 * 1024 * 1024;

export function jsonBodyTooLargeMessage(max: number): string {
  return `The request body is over this server's ${(max / 1024 / 1024).toFixed(0)} MB limit for JSON (limits.jsonBodyMaxBytes at /api/v2/status).`;
}

/**
 * The parsed body, `undefined` when it is not JSON, or `tooLarge` once more
 * than `max` bytes have arrived. Never throws.
 */
export async function readBoundedJson(
  request: Request,
  max: number = JSON_BODY_MAX_BYTES,
): Promise<{ tooLarge: true } | { tooLarge: false; value: unknown }> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return { tooLarge: true };
  if (!request.body) return { tooLarge: false, value: undefined };

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
    return { tooLarge: false, value: JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) };
  } catch {
    return { tooLarge: false, value: undefined };
  }
}

/**
 * The drop-in for `await request.json().catch(() => null)`: `value` is the
 * body, or `null` when it is not JSON — exactly what that expression gave —
 * and a body over `max` is a 413 the caller returns as it is.
 */
export async function readJsonBody(
  request: Request,
  max: number = JSON_BODY_MAX_BYTES,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const read = await readBoundedJson(request, max);
  if (read.tooLarge) {
    return {
      ok: false,
      response: Response.json(
        { error: "body_too_large", message: jsonBodyTooLargeMessage(max), details: { maxBytes: max } },
        { status: 413 },
      ),
    };
  }
  return { ok: true, value: read.value ?? null };
}
