// POST /api/v2/journals — B1624, phase 2 step 4.
// docs/plans/2026-09-12-api-v2/content.md §10. The document half of a
// journal's lifecycle; the credential half (signup codes) is
// POST /api/auth/codes + /api/auth/codes/redeem with "for": "signup" and
// POST /api/auth/signup/phone(/redeem) — unchanged, and not this ticket's to
// redesign. This route consumes whatever signup token that flow minted.
import { journalCreate } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { isAdminEmail } from "@/lib/admin";
import { isEnabled } from "@/lib/capabilities";
import { NO_JOURNAL, SESSION_SCOPE, issueRelayLink, openAgentSession, resolveSession, revokeSession, signInUrl } from "@/lib/auth";
import { normalizeJournalVisibility } from "@/lib/config";
import { normalizeCurrency } from "@/lib/currency";
import { creditsEnabled, grant, SIGNUP_CREDIT_GRANT } from "@/lib/credits";
import { skillDocPath } from "@/lib/api/skillDocMeta";
import { createJournal, sendWelcome, setJournalFeatures } from "@/lib/journals";
// One sentence, read here and by the guide and the OpenAPI document — never a
// third hand-written copy (B855). Not a v1 route-glue import: this constant
// is plain UI-facing text with no request/response shaping of its own.
import { SECOND_LANGUAGE_COMMITMENT } from "@/lib/api/agentCopy";
import { clientIp, rateLimitFor, rateLimitStatus } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { phoneProofMode, smsFallbackOffered } from "@/lib/phoneVerify";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
/** Same two-budget shape as v1 (B217): a refused attempt and an actual
 * creation spend different budgets, so correcting a taken username four
 * times does not lock somebody out of the fifth, real, creation. */
const CREATED = { max: 5, windowMs: HOUR };
const REFUSED = { max: 20, windowMs: HOUR };
/** The daily half of the same budget (B834) — a script respecting only the
 * hourly one can otherwise make 5, wait, and make 5 more, forever. */
const CREATED_DAILY = { max: 15, windowMs: 24 * HOUR };

export async function POST(request: Request) {
  if (!isEnabled("signup")) {
    return fail("signup_disabled", ERROR_CODES.signup_disabled, undefined, 404);
  }

  const ip = clientIp(request);
  const createBudget = rateLimitStatus("journals-create", ip, CREATED);
  if (!createBudget.ok) return tooMany("journals_created", createBudget.retryAfter);
  const createDailyBudget = rateLimitStatus("journals-create-daily", ip, CREATED_DAILY);
  if (!createDailyBudget.ok) return tooMany("journals_created_daily", createDailyBudget.retryAfter);
  const refusalBudget = rateLimitStatus("journals-create-refused", ip, REFUSED);
  if (!refusalBudget.ok) return tooMany("failed_attempts", refusalBudget.retryAfter);

  const refuse = (
    code: Parameters<typeof fail>[0],
    message: string,
    details?: unknown,
    status?: number,
  ) => {
    rateLimitFor("journals-create-refused", ip, REFUSED);
    return fail(code, message, details, status);
  };

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return refuse(
      "missing_token",
      `${ERROR_CODES.missing_token} Start at POST /api/auth/codes with {"for": "signup"}.`,
      undefined,
      401,
    );
  }

  const session = await resolveSession(match[1].trim(), "signup");
  if (!session || session.owner !== NO_JOURNAL) {
    return refuse(
      "invalid_token",
      "A signup token creates one journal and is spent by doing so. If you have already " +
        "created one, that succeeded — do not retry, and use the agent token it gave you. " +
        "Otherwise this token has expired (they last twenty minutes): start again at " +
        'POST /api/auth/codes with {"for": "signup"}.',
      undefined,
      401,
    );
  }

  const parsedBody = await request.json().catch(() => null);
  const result = journalCreate.safeParse(parsedBody);
  if (!result.success) {
    return refuse("invalid_request", ERROR_CODES.invalid_request, problemsFrom(result.error), 400);
  }
  const body = result.data;

  const exempt = isAdminEmail(session.email) || body.username.startsWith("test-");
  if (!exempt && !session.phone) {
    return refuse(
      "phone_required",
      ERROR_CODES.phone_required,
      { mode: phoneProofMode(), smsFallback: smsFallbackOffered() },
      400,
    );
  }

  const telProvenMethod = session.phone
    ? session.phoneProvenMethod === "whatsapp-inbound" || session.phoneProvenMethod === "sms"
      ? session.phoneProvenMethod
      : phoneProofMode() === "whatsapp-inbound"
        ? ("whatsapp-inbound" as const)
        : ("sms" as const)
    : null;

  // `superRefine` above already guarantees these four are defined and shaped
  // — the schema is where "is it a real code" was checked; this is only the
  // upper-casing `createJournal` itself expects.
  const baseCurrency = normalizeCurrency(body.baseCurrency!);
  const displayCurrencies = body.displayCurrencies?.map((c) => normalizeCurrency(c));

  const created = createJournal({
    visibility: body.visibility as "public" | "guest" | "private",
    username: body.username,
    title: body.title,
    tagline: body.tagline,
    ownerEmail: session.email,
    ownerName: body.ownerName,
    ownerNickname: body.ownerNickname,
    defaultLocale: body.defaultLocale!,
    locales: body.locales!,
    baseCurrency,
    displayCurrencies,
    units: body.units,
    ...(session.phone
      ? {
          ownerTel: session.phone,
          ownerTelProvenAt: session.phoneProvenAt ?? undefined,
          ownerTelProvenMethod: telProvenMethod ?? undefined,
        }
      : {}),
  });

  if (!created.ok) {
    // `createJournal()`'s own closed set of refusals (lib/journals.ts) —
    // spelled out here, one literal code per line, rather than cast through a
    // variable: that is what keeps each word in this list checkable against
    // ERROR_CODES by test/openapi-contract.test.ts's static scan.
    const details = created.next ? { next: created.next } : undefined;
    switch (created.error) {
      case "invalid_username":
        return refuse("invalid_username", created.message, details, 400);
      case "deleted_username":
        return refuse("deleted_username", created.message, details, 410);
      case "reserved_username":
        return refuse("reserved_username", created.message, details, 403);
      case "username_taken":
        return refuse("username_taken", created.message, details, 409);
      case "invalid_title":
        return refuse("invalid_title", created.message, details, 400);
      case "invalid_owner":
        return refuse("invalid_owner", created.message, details, 400);
      case "too_many_journals":
        return refuse("too_many_journals", created.message, details, 403);
      case "tel_taken":
        return refuse("tel_taken", created.message, details, 409);
      default:
        return refuse("invalid_request", created.message, details, 400);
    }
  }

  rateLimitFor("journals-create", ip, CREATED);
  rateLimitFor("journals-create-daily", ip, CREATED_DAILY);

  if (telProvenMethod === "whatsapp-inbound") {
    const opted = setJournalFeatures(created.username, { whatsappInbound: true });
    if (!opted.ok) {
      console.error(`[journals] could not switch the WhatsApp channel on for ${created.username}: ${opted.error}`);
    }
  }

  try {
    await revokeSession(session.id);
  } catch (err) {
    console.error(`[journals] could not spend the signup token for ${created.username}:`, err);
  }

  if (creditsEnabled() && !created.username.startsWith("test-")) {
    try {
      await grant(created.username, SIGNUP_CREDIT_GRANT, "signup");
    } catch (err) {
      console.error(`[journals] could not grant the signup credit to ${created.username}:`, err);
    }
  }

  const token = await openAgentSession(created.username, session.email);

  const welcomeMailed = await sendWelcome({
    username: created.username,
    title: body.title,
    email: session.email,
    nickname: body.ownerNickname,
    visibility: created.visibility,
    locale: getUser(created.username)?.defaultLocale,
  });

  let signIn: string | null = null;
  if (isEnabled("auth")) {
    try {
      signIn = signInUrl(serverSite().url, created.username, await issueRelayLink(created.username, session.email));
    } catch (err) {
      console.error(`[journals] no relay link for ${created.username}:`, err);
    }
  }

  return ok(
    {
      ok: true,
      user: created.username,
      url: `${serverSite().url}/${created.username}`,
      ...(signIn
        ? {
            signIn,
            signInNote:
              "Give this to the person, once, in your reply, and give it to them now. It signs " +
              "them in so they can see their drafts and private trips. It works once and expires " +
              "in 15 minutes; do not store it or repeat it later. Their welcome mail carries a " +
              "second, standing link to the same place.",
          }
        : {}),
      documentation: `${serverSite().url}/${created.username}/documentation.txt`,
      // B855: the field that quietly commits the owner to writing everything
      // twice. Absent for a one-language journal, which owes nothing.
      ...(body.locales!.length > 1 ? { localesNote: SECOND_LANGUAGE_COMMITMENT } : {}),
      visibility: created.visibility,
      token: token.token,
      expires: token.expiresAt,
      scope: [SESSION_SCOPE.agent],
      welcomeMailed,
      ...(welcomeMailed
        ? {}
        : { note: "The welcome mail could not be sent, so the owner does not have the URL. Give it to them." }),
      // Names the document, not just the call — B311's chain, and B1621 is
      // the record of it being dropped once already in this migration. An
      // agent that has just made its first journal has nowhere else to learn
      // what a trip needs.
      next:
        `PUT /api/v2/${created.username}/trips/<id> to create your first trip — ` +
        `${serverSite().url}${skillDocPath("add-a-trip")} is what it takes.`,
    },
    { status: 201 },
  );
}

function tooMany(
  reason: "journals_created" | "journals_created_daily" | "failed_attempts",
  retryAfter: number,
): Response {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  const messages: Record<typeof reason, string> = {
    journals_created:
      `This network address has created ${CREATED.max} journals in the last hour, which is ` +
      `the limit. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    journals_created_daily:
      `This network address has created ${CREATED_DAILY.max} journals in the last day, which ` +
      `is the limit. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    failed_attempts:
      `${REFUSED.max} attempts from this network address were refused in the last hour — taken ` +
      "names, names that are not names, or requests missing a field — so this one was not " +
      "tried. Your token is still good and creating a journal is still allowed; it is the " +
      `guessing that has stopped. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, ` +
      "and check the username with the person first.",
  };
  // Flat `reason`/`retryAfter`, matching every other rate limit this server
  // answers (v1's carried the same shape) — the `Retry-After` header is the
  // machine-readable half and `reason` is what distinguishes two 429s that
  // would otherwise read identically.
  return Response.json(
    { error: "too_many_requests", reason, retryAfter, message: messages[reason] },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
