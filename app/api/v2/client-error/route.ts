import { ERROR_CODES } from "@/lib/api/errorCodes";
import { clientErrorRequest } from "@/lib/api/v2/schemas/clientError";
import { fail, readJson, withV2Log } from "@/lib/api/v2/route";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { scrubLog } from "@/lib/scrubLog";

/**
 * A crash in the browser or the iOS shell, written to the server log (B-2953).
 * Public on purpose: a crash can happen signed out. Stdout only — no database,
 * no file — and never the caller's address. Not gated on features.logging.
 */
export const POST = withV2Log(async function POST(request: Request) {
  const limit = rateLimitFor("client-error", clientIp(request), { max: 30, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) {
    const res = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = clientErrorRequest.safeParse(read.value);
  if (!body.success) return fail("invalid_request", ERROR_CODES.invalid_request);

  const b = body.data;
  const head =
    `[client-error] ${scrubLog(b.requestId ?? "-", 40)} ${b.platform} ${scrubLog(b.appVersion, 40)} ` +
    `${scrubLog(b.route, 200)} "${scrubLog(b.message, 500)}"`;
  const stack = (b.stack ?? "")
    .split("\n")
    .map((l) => scrubLog(l, 500).trimEnd())
    .filter(Boolean)
    .map((l) => `    ${l}`);
  console.error([head, ...stack].join("\n"));
  return new Response(null, { status: 204 });
}, { route: "/api/v2/client-error" });
