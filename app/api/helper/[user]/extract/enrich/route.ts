import "server-only";
import path from "node:path";
import { isEnabled } from "@/lib/capabilities";
import { creditsForPhotos } from "@/lib/helper/credits";
import { refund, spend } from "@/lib/credits";
import { describePhotos, HELPER_PROVIDER, type PhotoImage } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { defaultLocaleFor } from "@/lib/locales";
import { resizedCopy } from "@/lib/media";
import { runDir } from "@/lib/staging/paths";
import { readManifest, writeManifest } from "@/lib/staging/manifest";
import { extendOnTouch } from "@/lib/staging/expiry";

export const dynamic = "force-dynamic";

/** Same width `day/describe-photos` and `extract/sample` already send. */
const PHOTO_WIDTH = 1080;

/**
 * Caption every photograph still in the run — the credits screen's paid
 * path, B1751 Task 4.1.
 *
 * **Written into the manifest, not into a real day.** The photographs here
 * are still staged — nothing has been committed yet — so a caption this
 * writes lands on the `PhotoRow` itself, exactly where a person's own chip
 * edit already lands (`PATCH .../extract/run`). `commitDay`
 * (`lib/extract/commit.ts`) carries a row's caption across through
 * `updateInboxMeta` once the day is built, so nothing further is needed to
 * make a paid-for caption reach the real gallery — but it also means the
 * caption is only as durable as the run: if the run expires before the
 * person commits, the caption goes with the staged files it describes, and
 * the credits that paid for it are not returned. That is the owner's own
 * decision, and it is why the credits screen says so above the spend button
 * rather than after it.
 *
 * **`ref` is exactly `extract:<runId>`** — Ruling R4. The nightly expiry
 * sweep (`lib/staging/expiry.ts`) reads the ledger by that same ref to tell
 * somebody how many credits they are about to lose; a different string here
 * would make that warning silently report zero.
 *
 * Charged, then refunded on failure — the same order and the same reason
 * `day/describe-photos` already uses: the credit is spent before the model
 * is asked, because a call that never returns must not have been free, and
 * refunded when the model throws, because a credit that bought nothing is
 * not spent.
 */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/enrich">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const runId = text(body?.run);
  if (!runId) return Response.json({ error: "invalid_body" }, { status: 400 });

  const manifest = readManifest(user, runId);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  const extended = extendOnTouch(manifest, new Date());
  const current = extended ?? manifest;

  // Every photograph still in the run and not dropped — the same population
  // the credits screen priced when it showed this button.
  const live = current.photos.filter((p) => p.kind === "image" && !p.dropped);
  if (live.length === 0) return Response.json({ error: "no_photos" }, { status: 400 });

  const credits = creditsForPhotos(live.length);
  const ref = `extract:${runId}`;
  if (!(await spend(user, credits, "helper", ref))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  try {
    const sendable: { photo: (typeof live)[number]; image: PhotoImage }[] = [];
    for (const photo of live) {
      const file = path.join(runDir(user, runId), "files", path.basename(photo.id));
      const resized = await resizedCopy(file, PHOTO_WIDTH);
      if (resized) {
        sendable.push({ photo, image: { base64: resized.toString("base64"), mediaType: "image/webp" } });
      }
    }

    const captions =
      sendable.length > 0
        ? await describePhotos(
            sendable.map((s) => s.image),
            user,
            defaultLocaleFor(user),
          )
        : [];
    sendable.forEach((sent, i) => {
      sent.photo.caption = captions[i]?.trim() ?? "";
    });

    writeManifest(user, current);

    const answer = { ok: true, spent: credits, captioned: sendable.length, provider: HELPER_PROVIDER };
    return Response.json(answer);
  } catch {
    // The credit bought nothing; give it back — the same stance
    // `day/describe-photos` takes, and for the same reason: what a provider
    // says when it is unhappy is not something to render on somebody's
    // phone.
    await refund(user, credits, ref);
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
}
