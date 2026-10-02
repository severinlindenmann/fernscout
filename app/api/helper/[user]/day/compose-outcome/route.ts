import { isEnabled } from "@/lib/capabilities";
import { recordComposeOutcome, wordEditDistance, type ComposeOutcomeKind, type ComposeVariantKind } from "@/lib/helper/composeOutcome";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

const VARIANTS: readonly ComposeVariantKind[] = ["close", "story", "none"];
const OUTCOMES: readonly ComposeOutcomeKind[] = ["kept", "edited", "discarded"];
/** More than any real entry or saved day can be, in words — a cap on the
 *  diff work, not a claim about what a day can hold. */
const WORD_CAP = 4000;

function words(raw: unknown): string {
  return typeof raw === "string" ? raw.slice(0, WORD_CAP * 8) : "";
}

/**
 * Counting the one signal that is never recorded today: whether the owner
 * kept, edited or threw away a composed day — B2693. Cookie only, owner
 * only, like every helper route. Takes the composed and saved text only
 * long enough to compute a capped word-level edit distance in this
 * request; neither string, nor the distance's own exact value, is ever
 * written anywhere — only the variant, the outcome and the capped number.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/day/compose-outcome">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;
  const variant = VARIANTS.includes(body.variant as ComposeVariantKind) ? (body.variant as ComposeVariantKind) : null;
  const outcome = OUTCOMES.includes(body.outcome as ComposeOutcomeKind) ? (body.outcome as ComposeOutcomeKind) : null;
  if (!variant || !outcome) {
    return Response.json(
      { error: "invalid_body", message: `variant must be one of ${VARIANTS.join(", ")} and outcome one of ${OUTCOMES.join(", ")}.` },
      { status: 400 },
    );
  }
  const distance = outcome === "edited" ? wordEditDistance(words(body.composedText), words(body.savedText)) : 0;
  await recordComposeOutcome(user, variant, outcome, distance);
  return Response.json({ ok: true });
}
