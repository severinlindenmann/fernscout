// POST /api/v2/{user}/owner/email/redeem — B1733.
//
// Step two of the only way to MOVE owner.email: the code the new address
// received writes it, for good. This is the ONLY writer of `owner.email`
// (`lib/journals.ts`'s `setOwnerEmail`) — see that function's own comment
// for why. Ownership never changes silently: on success this also revokes
// every session and agent token the OLD address held for this journal
// (`revokeSessionsForAddress`, `lib/auth`) and mails the old address that it
// happened — a change nobody can undo must not be silent to the person it
// takes the journal from.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { etagFor, fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { journalDoc, ownerEmailRedeem } from "@/lib/api/v2/schemas";
import { getUser } from "@/lib/users";
import { journalV2Fields, setOwnerEmail } from "@/lib/journals";
import { checkOwnerEmailChange } from "@/lib/ownerEmailChange";
import { revokeCodes, revokeSessionsForAddress } from "@/lib/auth";
import { rateLimitFor, clientIp } from "@/lib/rateLimit";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { translateIn } from "@/lib/locales";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { serverSite } from "@/lib/site";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/owner/email/redeem">,
) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  const before = getUser(user);
  if (!before) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const limited = rateLimitFor("owner-email-verify-check", clientIp(request), { max: 20, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) {
    const response = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limited.retryAfter }, 429);
    response.headers.set("Retry-After", String(limited.retryAfter));
    return response;
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = jsonBody.value;
  const result = ownerEmailRedeem.safeParse(parsed);
  if (!result.success) return fail("invalid_request", 'Send {"id": "…", "code": "…"} from the PATCH that started this.');

  const checked = await checkOwnerEmailChange(user, result.data.id, result.data.code);
  if (checked.status !== "ok") {
    // One shape for every failure — a caller cannot tell "wrong digits" from
    // "expired" from a burned id by probing.
    return fail("invalid_code", ERROR_CODES.invalid_code, undefined, 401);
  }

  const oldEmail = before.owner.email;
  const written = setOwnerEmail(user, checked.newEmail);
  if (!written.ok) {
    return fail("invalid_request", written.message, undefined, 400);
  }

  // The old address's write is over. Every token and session it was
  // holding for THIS journal stops working now, whatever its own expiry
  // said — a stolen seven-day token is a seven-day problem only if the
  // address that minted it cannot mint another the moment it stops being
  // the owner.
  if (oldEmail) {
    await revokeSessionsForAddress(user, oldEmail);
    await revokeCodes(user, oldEmail, "agent").catch(() => {});
    await revokeCodes(user, oldEmail, "guest").catch(() => {});
    await notifyOldOwnerAddress(user, oldEmail, checked.newEmail, request);
  }

  const now = getUser(user)!;
  const echo = journalDoc.parse({ ...journalV2Fields(now), username: user });
  return ok(echo, { etag: etagFor(echo) });
}

/**
 * Best-effort: the ownership move already happened and cannot be undone by
 * a mail that fails to send. Logged rather than surfaced to the caller —
 * there is nothing left for a retry of THIS call to fix, since the code is
 * already spent.
 */
async function notifyOldOwnerAddress(
  user: string,
  oldEmail: string,
  newEmail: string,
  request: Request,
): Promise<void> {
  const now = getUser(user);
  const locale = pickLocale(now?.locales[0], fromAcceptLanguage(request.headers.get("accept-language")));
  const site = serverSite();
  const vars = { site: site.name, title: now?.title ?? user, newEmail };
  try {
    await sendTransactional(
      renderMail(
        oldEmail,
        translateIn(locale, "mail.ownerEmailMovedSubject", vars),
        {
          preheader: translateIn(locale, "mail.ownerEmailMovedPreheader", vars),
          title: translateIn(locale, "mail.ownerEmailMovedTitle"),
          blocks: [
            { kind: "paragraph", text: translateIn(locale, "mail.ownerEmailMovedWhat", vars) },
            { kind: "paragraph", text: translateIn(locale, "mail.ownerEmailMovedRevoked", vars) },
          ],
          footer: translateIn(locale, "mail.identityFooter", vars),
        },
        user,
      ),
      "the previous owner learning that the journal moved to a new address",
    );
  } catch (err) {
    console.error(`[owner-email] could not tell ${oldEmail} that ${user} moved to ${newEmail}:`, err);
  }
}
