// POST /api/v2/{user}/owner/tel/verify/redeem — B1654, D20.
//
// Step two: the code becomes the owner's own proven number. This is the
// ONLY writer of `owner_tel` — see `lib/ownerTel.ts` for why that has to
// stay true. `checkVerification` is the same one-time id+code pair every
// other passcode in this codebase uses (`lib/phoneVerify`), so a caller who
// never received the code at that number cannot complete this even while
// holding a perfectly valid owner token.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { getUser } from "@/lib/users";
import { checkVerification } from "@/lib/phoneVerify";
import { ownerTelDocFields, setOwnerTel } from "@/lib/ownerTel";
import { rateLimitFor, clientIp } from "@/lib/rateLimit";
import { ownerTelDoc, ownerTelVerifyRedeem } from "@/lib/api/v2/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/owner/tel/verify/redeem">,
) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

  const limited = rateLimitFor("owner-tel-verify-check", clientIp(request), { max: 20, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) {
    const response = fail("too_many_requests", "Too many attempts. Wait and try again.", { retryAfter: limited.retryAfter }, 429);
    response.headers.set("Retry-After", String(limited.retryAfter));
    return response;
  }

  const parsed = await request.json().catch(() => null);
  const result = ownerTelVerifyRedeem.safeParse(parsed);
  if (!result.success) return fail("invalid_request", 'Send {"id": "…", "code": "…"} from `.../verify`.');

  const checked = await checkVerification(result.data.id, result.data.code);
  if (checked.status !== "ok") {
    // One shape for every failure, the same discipline every code in this
    // codebase follows — a caller cannot tell "wrong digits" from "expired"
    // from a burned id by probing.
    return fail("invalid_code", "The code is wrong, used, or more than 30 minutes old. Ask for a new one at `.../verify`.", undefined, 401);
  }

  await setOwnerTel(user, checked.phone, "sms");
  return ok(ownerTelDoc.parse(await ownerTelDocFields(user)));
}
