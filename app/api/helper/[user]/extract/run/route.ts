import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { groupIntoDays, type DayGroup } from "@/lib/extract/group";
import { questionsForDay, type Question } from "@/lib/extract/questions";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { geodataAvailable, reverseGeocode } from "@/lib/ingest/geo";
import { PHOTO_VISIBILITIES, parsePhotoVisibility } from "@/lib/photos";
import { extendOnTouch } from "@/lib/staging/expiry";
import { readManifest, writeManifest, type DayRow, type RunManifest } from "@/lib/staging/manifest";

export const dynamic = "force-dynamic";

/** Stable key for the response's `questions` map — a group's own `date`,
 *  except the one undated group, whose `date` is `""` and would collide with
 *  nothing else since `groupIntoDays` never produces more than one. */
function keyFor(group: DayGroup): string {
  return group.undated ? "undated" : group.date;
}

/** The manifest's own row for a group's date, or a fresh one — a group the
 *  person has not touched yet has no `DayRow` to find. */
function dayRowFor(manifest: RunManifest, group: DayGroup): DayRow {
  return manifest.days.find((d) => d.date === group.date) ?? { date: group.date, answered: [] };
}

/**
 * Groups the run's photographs into days and asks what to ask about each —
 * B1751, Task 2.3.
 *
 * Reverse-geocoded once per group, not once per photograph: a group is one
 * place as far as this flow is concerned, and `geodataAvailable()` gates the
 * lookup entirely so a checkout with no offline index simply asks instead of
 * guessing. A group with no coordinate at all — undated, or every photograph
 * in it missing GPS — gets no place name and `questionsForDay` asks where it
 * was instead of stating a place nobody's photograph said.
 */
function groupsAndQuestions(manifest: RunManifest): { groups: DayGroup[]; questions: Record<string, Question[]> } {
  const live = manifest.photos.filter((p) => !p.dropped);
  const groups = groupIntoDays(live);
  const questions: Record<string, Question[]> = {};
  for (const group of groups) {
    let placeName: string | undefined;
    if (!group.undated && group.lat !== undefined && group.lng !== undefined && geodataAvailable()) {
      placeName = reverseGeocode(group.lat, group.lng)?.name;
    }
    questions[keyFor(group)] = questionsForDay(group, manifest.photos, dayRowFor(manifest, group), placeName);
  }
  return { groups, questions };
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/run">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const runId = new URL(request.url).searchParams.get("run") ?? "";
  const manifest = readManifest(user, runId);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  // Opening the board *is* touching the run — see `extendOnTouch`.
  const extended = extendOnTouch(manifest, new Date());
  if (extended) writeManifest(user, extended);
  const current = extended ?? manifest;

  const { groups, questions } = groupsAndQuestions(current);
  return Response.json({ manifest: current, groups, questions });
}

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/run">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as {
    run?: string;
    photoId?: string;
    caption?: string;
    visibility?: string;
    date?: string;
    dropped?: boolean;
  } | null;
  if (!body || typeof body.run !== "string" || typeof body.photoId !== "string") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // Checked before the manifest is even read: a rejected word is a rejected
  // word whether or not the run behind it exists. `PHOTO_VISIBILITIES` is
  // the one list — reused here rather than copied — and `parsePhotoVisibility`
  // would otherwise fail closed to "private" for a typo, which is right for a
  // reader gate and wrong for an editor that asked to be told "no".
  if (body.visibility !== undefined) {
    const word = String(body.visibility).trim().toLowerCase();
    if (!(PHOTO_VISIBILITIES as readonly string[]).includes(word)) {
      return Response.json({ error: "invalid_visibility", accepted: PHOTO_VISIBILITIES }, { status: 400 });
    }
  }

  const manifest = readManifest(user, body.run);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  const extended = extendOnTouch(manifest, new Date());
  const current = extended ?? manifest;

  const photo = current.photos.find((p) => p.id === body.photoId);
  if (!photo) return Response.json({ error: "no_such_photo" }, { status: 404 });

  if (body.visibility !== undefined) photo.visibility = parsePhotoVisibility(body.visibility);
  if (typeof body.caption === "string") photo.caption = body.caption;
  if (typeof body.date === "string") photo.date = body.date;
  if (typeof body.dropped === "boolean") photo.dropped = body.dropped;

  writeManifest(user, current);
  return Response.json({ photo });
}
