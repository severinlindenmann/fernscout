// POST /api/web/{user}/figures/from-photo — the figure creator's "describe
// and propose" button, from a cookie — B2021.
//
// `classifyTravellers` (lib/helper/model.ts) needs a photograph and a
// journal, and nothing else — no trip. `POST /api/v2/{user}/trips/{trip}/
// travellers/from-photo` wraps it in a trip for the agent's own "who is on
// this trip" question, but the creator is reached from People, before
// anyone is necessarily on a trip at all, so this calls the same function
// directly rather than inventing a trip to satisfy a route that does not
// need one.
//
// Never stored: the photograph is resized in memory and only ever reaches
// the model as bytes in the request; nothing here writes it to disk.
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { refund, spend } from "@/lib/credits";
import { filterPhotoProposal } from "@/lib/figures/creator";
import { hasHelperConsent } from "@/lib/helper/consent";
import { classifyTravellers, HELPER_PROVIDER, TRAVELLERS_FROM_PHOTO_CREDITS, type PhotoImage } from "@/lib/helper/model";
import { resizedBuffer } from "@/lib/media";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";
import { IMAGE_MAX_BYTES } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent proposes a figure from a photograph " +
    "with POST /api/v2/{user}/trips/{trip}/travellers/from-photo.",
};

/** Same budget as the trip-scoped route this borrows its model call from —
 *  an occasional call on one photograph, not a batch job. */
const LIMIT = { max: 15, windowMs: 15 * 60 * 1000 };

/** Plenty for a model to read faces, hair and clothing. */
const PHOTO_WIDTH = 1080;

export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/figures/from-photo">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("figures-from-photo", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json({ error: "too_many_requests" }, { status: 429 });
  }

  // Asked for on its own, before anything about the photograph itself is
  // even read — the same order `.../travellers/from-photo` checks in.
  if (!hasHelperConsent(user, "photos")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!form || !(file instanceof File)) {
    return Response.json({ error: "expected_photo" }, { status: 400 });
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return Response.json(
      {
        error: "invalid_media",
        message: `${(file.size / 1024 / 1024).toFixed(1)} MB is over the ${IMAGE_MAX_BYTES / 1024 / 1024} MB a photograph may be.`,
      },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const image = await resizedBuffer(bytes, PHOTO_WIDTH);
  if (!image) {
    return Response.json({ error: "invalid_media", message: "That could not be read as a photograph." }, { status: 400 });
  }
  const photo: PhotoImage = { base64: image.toString("base64"), mediaType: "image/webp" };

  const ledgerRef = `${user}/figures/from-photo`;
  if (!(await spend(user, TRAVELLERS_FROM_PHOTO_CREDITS, "travellers_from_photo", ledgerRef))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  try {
    const results = await classifyTravellers(photo, user);
    if (results.length === 0) {
      // "No charge / a plain message when no face" (B2021's ticket, one
      // step past the trip-scoped route this borrows the model call from,
      // which has no equivalent refund): there is nothing here for the
      // owner to review, so spending a credit on it would be charging for
      // an empty answer.
      await refund(user, TRAVELLERS_FROM_PHOTO_CREDITS, ledgerRef);
      return Response.json({ ok: true, figures: [], spent: 0, provider: HELPER_PROVIDER });
    }
    return Response.json({
      ok: true,
      figures: results.map((r, position) => ({ position, ...filterPhotoProposal(r) })),
      spent: TRAVELLERS_FROM_PHOTO_CREDITS,
      provider: HELPER_PROVIDER,
    });
  } catch {
    await refund(user, TRAVELLERS_FROM_PHOTO_CREDITS, ledgerRef);
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
}
