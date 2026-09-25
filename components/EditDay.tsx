"use client";

import { useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { PhotoPicker } from "@/components/PhotoPicker";
import PreviewNotice from "@/components/studio/PreviewNotice";
import DecideList from "@/components/studio/DecideList";
import DeclineScreen from "@/components/studio/day/DeclineScreen";
import StepPrimary from "@/components/studio/StepPrimary";
import { useI18n } from "./LocaleProvider";
import type { Day, Entry } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import DateField, { type TripCalendar } from "@/components/studio/DateField";
import DayExtras, { extrasToWrite, lineProblem, type DayExtrasValue } from "@/components/studio/day/DayExtras";

/** `DAY_DECLINABLES`' own sentence for `media` (`lib/api/v2/schemas/day.ts`),
 *  copied rather than imported: that module's chain reaches this instance's
 *  real database drivers (`lib/studio/declinables.ts`'s own doc comment
 *  explains why), which a client component must never pull into its bundle.
 *  `DeclineScreen`'s canned reasons are derived from this exact string, so
 *  it has to read the same words the server-side list carries. */
const MEDIA_WHY_REQUIRED =
  "a day names the photographs on it (by the src the media door answered with), or says why there are none";

/** The fields of one update, as the panel holds them while they are typed. */
type Draft = {
  title: string;
  time: string;
  location: string;
  visibility: "" | "guest" | "private";
  content: string;
  /** `{ [src]: caption }` for every photograph on this update. */
  captions: Record<string, string>;
  /** `{ [src]: "" | "guest" | "private" }` — empty is "as the update". */
  photoVisibility: Record<string, "" | "guest" | "private">;
  /** `{ [locale]: { title, content } }` — only the languages this update
   *  already carries. The panel adds no language a day does not have. */
  translations: Record<string, { title: string; content: string }>;
  /** B2233 — costs, how the day travelled, tags. */
  extras: DayExtrasValue;
};

/** B2073 — a field's name is a mono eyebrow, the studio's own label face. */
const EYEBROW = "font-mono text-[11px] font-medium uppercase tracking-[.06em] text-ink-secondary";

const FIELD =
  "w-full rounded-lg border border-line-quiet bg-surface-raised px-3 py-2 text-sm text-ink-strong focus:border-line-prominent focus:outline-none";

function draftOf(entry: Entry): Draft {
  return {
    title: entry.title ?? "",
    time: entry.time ?? "",
    location: entry.location ?? "",
    visibility: entry.visibility ?? "",
    content: entry.content ?? "",
    captions: Object.fromEntries(
      entry.gallery.map((item) => [item.src, item.caption ?? ""]),
    ),
    photoVisibility: Object.fromEntries(
      entry.gallery.map((item) => [item.src, item.visibility ?? ""]),
    ),
    translations: Object.fromEntries(
      Object.entries(entry.translations ?? {}).map(([code, said]) => [
        code,
        { title: said?.title ?? "", content: said?.content ?? "" },
      ]),
    ),
    extras: {
      costs: (entry.costs ?? []).map((c) => ({ label: c.label, amount: String(c.amount), currency: c.currency, category: c.category })),
      transportMode: entry.transport?.mode ?? "",
      tags: entry.tags ?? [],
    },
  };
}

/** D12 — which of a few plainly-namable fields moved between what this panel
 *  read (`was`) and the document `stale_document` just handed back
 *  (`current`, `dayDoc`-shaped). Not every field a day can carry: enough to
 *  say *what* changed underneath, which is what the refusal screen needs —
 *  a full diff of the whole document is the preview's job (E3), not a
 *  refusal panel's. */
function changedFieldsAgainst(was: Entry, current: Record<string, unknown> | undefined): string[] {
  if (!current) return [];
  const changed: string[] = [];
  if (typeof current.title === "string" && current.title !== (was.title ?? "")) changed.push("title");
  if (typeof current.content === "string" && current.content !== (was.content ?? "")) changed.push("content");
  if (typeof current.time === "string" && current.time !== (was.time ?? "")) changed.push("time");
  if (typeof current.location === "string" && current.location !== (was.location ?? "")) changed.push("location");
  if (Array.isArray(current.media) && current.media.length !== was.gallery.length) changed.push("media");
  return changed;
}

/**
 * The owner correcting their own day, on the day — B980.
 *
 * "Correct or take down" used to be a link to `/agent/<user>`: the owner,
 * standing on the day, with the sentence they wanted to fix in front of them,
 * was taken to another page which re-asked the day from the beginning through
 * a model. For "the time was 14:00, not 15:00" that is a conversation where a
 * keystroke would do.
 *
 * **This is not a CMS, and the distinction is not a technicality.** Decision
 * 24 says a day is not composed in a browser out of form fields, and nothing
 * here composes one: there is no "new day", no upload widget with its own idea
 * of what a day is, and no field this panel can write that the day does not
 * already have. It corrects what an agent wrote, in place, for the person who
 * lived it — the same thing `PATCH .../days/<slug>` has done since B266,
 * reached from where the mistake is visible.
 *
 * **It cannot publish.** That is still B28's separation for the way *onto*
 * the site: writing and putting on the site are two decisions, and Save makes
 * only the first. **It can take a day down again** — B980 round 3, through
 * `.../unpublish`, its own owner-cookie door — because that half of "correct
 * or take down" is the same kind of decision publishing is (owner-only,
 * reversible, never folded into a save), not the kind writing a paragraph is,
 * and it is behind its own button and its own confirmation rather than a side
 * effect of Save.
 *
 * Every word and every photograph write to
 * `/<user>/trips/<trip>/day/<slug>/edit`, the owner's cookie door onto the
 * same validator and the same writer. One call per update actually changed —
 * a day with three updates where one word moved writes one file.
 *
 * **Nothing about the trip is here** — B2073. Who may read the trip and
 * whether it is advertised used to sit in this form, two taps from changing
 * a whole trip's audience while fixing a word; they live in "Edit a trip"
 * (`/studio/trip`) and on the trip page's own badge now.
 */
export default function EditDay({
  username,
  tripId,
  day,
  initialDrop,
  onClose,
  confirmBeforeSave = false,
  inStudioBar = false,
  saved = false,
  onSaved,
  calendar,
  currencies,
}: {
  username: string;
  tripId: string;
  day: Day;
  /**
   * A photograph already on its way out when this panel opened — B862, the
   * owner pressing "remove" on the picture itself, in the lightbox, rather
   * than finding it again among the thumbnails below. Still just the mark:
   * nothing leaves disk until Save, same as pressing "Remove" here would.
   */
  initialDrop?: string;
  onClose: () => void;
  /**
   * E3/E3✗ (spec §6) — off by default, so `StoryPager`'s own in-place panel
   * keeps saving the moment Save is pressed, exactly as it always has. The
   * studio flow (`EditDayFlow.tsx`) turns this on: Save then shows what
   * actually moved — only the fields `changesFor` found different, which is
   * the diff itself rather than a second full render of the day — before
   * anything is written (C1), and a photograph gallery emptied by removal
   * asks why first (D1's own decline screen, reused) rather than saving a
   * day that silently lost its last picture.
   */
  confirmBeforeSave?: boolean;
  /**
   * B2073 — `DecideList`'s own opt-in, for the same reason: only a caller
   * mounted under `app/[user]/studio/layout.tsx`'s `StudioBarProvider`
   * (`EditDayFlow`) sets it; `StoryPager`'s in-place panel has no bar. On,
   * Save is the bar's one primary, labelled with the change count (the count
   * *is* the review, so E3's separate diff screen is skipped), disabled until
   * the form has mounted and something moved; a save calls `onSaved`
   * instead of reloading, and `saved` then shows "Saved." until the next
   * change.
   */
  inStudioBar?: boolean;
  saved?: boolean;
  onSaved?: () => void;
  /** B2167 — the trip's span and told/draft days for the date field, when
   *  the caller already has them ("Change a day" does; StoryPager does not). */
  calendar?: TripCalendar;
  /** B2233 — `journalCurrencies`. Given ("Change a day"), the panel offers
   *  costs, how the day travelled and tags; absent (`StoryPager`, whose day
   *  is the reader's copy) it does not. */
  currencies?: string[];
}) {
  const { t, tn, formatLongDate, languageName } = useI18n();
  const [date, setDate] = useState(day.date);
  const [drafts, setDrafts] = useState<Draft[]>(() => day.entries.map(draftOf));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** Photographs marked to go, by `src`. Nothing leaves disk until save. */
  const [dropping, setDropping] = useState<string[]>(() =>
    initialDrop ? [initialDrop] : [],
  );
  /** Files chosen to be added, per update index. */
  const [adding, setAdding] = useState<Record<number, File[]>>({});
  /** B2073 — false until the mount-time version read has answered, so the
   *  studio's Save cannot be pressed on a server-rendered form whose
   *  handlers and initial values are not live yet (the cold-load "Save 0
   *  changes" race flows-write found). */
  const [ready, setReady] = useState(false);
  /** The take-down confirmation, open or not — B28: a second press, never a
   *  side effect of Save. */
  const [takingDown, setTakingDown] = useState(false);

  /**
   * D12 (spec §6) — the version this panel read, per update slug, fetched
   * once when it opens (`GET .../days/[slug]`, added for exactly this). Sent
   * back as `If-Match` on save, so a save built on a read that has since
   * moved on is refused rather than applied over it — the same
   * `If-Match`/`stale_document` mechanism `applyDayPatch` already enforces
   * for an agent's own bearer-authenticated PATCH, turned on for this door
   * too. Two tabs open on the same day: the second save is the one that
   * finds its own `If-Match` no longer matches.
   */
  const [versions, setVersions] = useState<Record<string, string>>({});
  /** The slug a save was refused for, and what changed underneath — set
   *  instead of the generic `failed` banner so the person sees the actual
   *  cause rather than a bare "something went wrong" (D12: "refused with a
   *  screen naming what changed underneath", never applied silently). */
  const [staleConflict, setStaleConflict] = useState<{ slug: string; changed: string[] } | null>(null);

  /** E3/E3✗ — `confirmBeforeSave`'s own state. `declineQueue` is which entry
   *  indices emptied their last photograph and have not yet said why;
   *  `mediaReasons` is what they answered. `previewOpen` is the diff step
   *  itself, shown only once every emptied gallery has a reason. */
  const [declineQueue, setDeclineQueue] = useState<number[]>([]);
  const [mediaReasons, setMediaReasons] = useState<Record<number, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);

  const set = (at: number, patch: Partial<Draft>) =>
    setDrafts((prev) =>
      prev.map((draft, i) => (i === at ? { ...draft, ...patch } : draft)),
    );

  /** What this update would send — only the fields whose value actually moved,
   *  so an untouched day writes nothing and an untouched field is not
   *  rewritten into the file it came from.
   *
   *  v2 has no flat `captions`/`photoVisibility` maps and no `null`-clears
   *  `visibility` (owner review, 2026-09-12): a caption or a per-photo label
   *  lives on the day's own `media` array, whole (merge-patch replaces an
   *  array rather than merging into it, so any change to either sends every
   *  surviving photograph back); "back to whatever the trip says" is the
   *  asked-or-declined mechanism every field on a v2 day answers through, so
   *  it is `declined.visibility` rather than a `null`. */
  function changesFor(
    at: number,
    gone: string[] = [],
    /** E3✗ — set only for an entry whose gallery this save is about to leave
     *  empty; the reason a person just typed on the decline screen, not a
     *  system sentence (D1's own rule applied to a removal instead of an
     *  omission: emptying a declinable section is a new answer, never
     *  silence). */
    mediaDeclineReason?: string,
  ): Record<string, unknown> {
    const was = draftOf(day.entries[at]);
    const now = drafts[at];
    const patch: Record<string, unknown> = {};
    if (now.title !== was.title) patch.title = now.title;
    if (now.time !== was.time) patch.time = now.time;
    if (now.location !== was.location) patch.location = now.location;
    if (now.content !== was.content) patch.content = now.content;
    if (now.visibility !== was.visibility) {
      if (now.visibility) patch.visibility = now.visibility;
      else patch.declined = { visibility: "shown to everyone the trip lets in" };
    }
    if (mediaDeclineReason) {
      patch.declined = { ...(patch.declined as Record<string, string> | undefined), media: mediaDeclineReason };
    }
    if (JSON.stringify(now.translations) !== JSON.stringify(was.translations)) {
      patch.translations = now.translations;
    }
    // B2233 — a section sent only when it moved and holds a value; supplying
    // it retracts a stored "left blank" decline on the server (T6).
    const extrasNow = extrasToWrite(now.extras);
    const extrasWas = extrasToWrite(was.extras);
    for (const key of ["costs", "transportMode", "tags"] as const) {
      if (extrasNow[key] !== undefined && JSON.stringify(extrasNow[key]) !== JSON.stringify(extrasWas[key])) {
        patch[key] = extrasNow[key];
      }
    }
    // Only when a caption or a per-photo label actually moved — sending
    // `media` at all rewrites the whole array, so an untouched gallery is
    // left off the patch entirely rather than echoed back for nothing.
    const captionsMoved = Object.entries(now.captions).some(
      ([src, text]) => text !== was.captions[src] && !gone.includes(src),
    );
    const labelsMoved = Object.entries(now.photoVisibility).some(
      ([src, level]) => level !== was.photoVisibility[src] && !gone.includes(src),
    );
    if (captionsMoved || labelsMoved) {
      patch.media = day.entries[at].gallery
        .filter((item) => !gone.includes(item.src))
        .map((item) => {
          const caption = now.captions[item.src] ?? "";
          const visibility = now.photoVisibility[item.src] ?? "";
          return {
            src: item.src,
            ...(caption ? { caption } : {}),
            ...(visibility ? { visibility } : {}),
          };
        });
    }
    // The date belongs to the day rather than to one update, so a change to it
    // goes to every update of the day — otherwise half a day moves.
    if (date !== day.date) patch.date = date;
    return patch;
  }

  /** E3✗ — every entry whose gallery this save would leave with nothing:
   *  it had photographs, every one of them is either being dropped or was
   *  never replaced by a new upload. Checked against `dropping`/`adding`
   *  directly rather than `changesFor`'s own patch, since a removal travels
   *  through the separate `photos` DELETE call below, never through
   *  `media` in the day patch itself. */
  function emptiedEntries(): number[] {
    return day.entries.flatMap((entry, at) => {
      if (entry.gallery.length === 0) return [];
      const remaining = entry.gallery.filter((item) => !dropping.includes(item.src)).length;
      const addingCount = (adding[at] ?? []).length;
      return remaining === 0 && addingCount === 0 ? [at] : [];
    });
  }

  const dayUrl = (slug: string, tail: string) =>
    `/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/day/${encodeURIComponent(slug)}/${tail}`;

  /** The v2 cookie proxies (B1595) — `/api/web`, never `/api/v1` or
   *  `/api/v2` directly, since a browser must never hold the bearer token
   *  those read. `photos/` above stays on the older `dayUrl` door; only the
   *  document write, the take-down and the trip's own visibility moved. */
  const dayApiUrl = (slug: string) =>
    `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(slug)}`;

  // D12 — read once, when the panel opens, so a later save can prove it
  // still holds the version it started from. See the `versions` doc comment
  // above; kept here rather than beside the `useState` because it needs
  // `dayApiUrl`, defined just above.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      day.entries.map((entry) =>
        fetch(dayApiUrl(entry.slug))
          .then((r) => (r.ok ? r.json() : null))
          .then((json: { etag?: string } | null) => [entry.slug, json?.etag] as const)
          .catch(() => [entry.slug, undefined] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [slug, etag] of pairs) if (etag) next[slug] = etag;
      setVersions(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(reasons: Record<number, string> = mediaReasons) {
    setFailed(null);
    setStaleConflict(null);
    setBusy(true);

    // Pictures first, words after. A caption belongs to a photograph, so a
    // file has to be on the day before the same save can say what it shows —
    // and a photograph on its way off must not be captioned on the way.
    for (const [at, entry] of day.entries.entries()) {
      const files = adding[at] ?? [];
      if (files.length > 0) {
        const form = new FormData();
        for (const file of files) form.append("files", file);
        const response = await fetch(dayUrl(entry.slug, "photos"), {
          method: "POST",
          body: form,
        }).catch(() => null);
        if (!response?.ok) {
          setBusy(false);
          setFailed(entry.slug);
          return;
        }
      }
      const gone = entry.gallery
        .filter((item) => dropping.includes(item.src))
        .map((i) => i.src);
      if (gone.length > 0) {
        const response = await fetch(dayUrl(entry.slug, "photos"), {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ src: gone }),
        }).catch(() => null);
        if (!response?.ok) {
          setBusy(false);
          setFailed(entry.slug);
          return;
        }
      }
    }

    for (const [at, entry] of day.entries.entries()) {
      const patch = changesFor(at, dropping, reasons[at]);
      if (Object.keys(patch).length === 0) continue;
      const version = versions[entry.slug];
      const response = await fetch(dayApiUrl(entry.slug), {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(version ? { "if-match": version } : {}),
        },
        body: JSON.stringify(patch),
      }).catch(() => null);
      // D12 — refused, not applied over. `applyDayPatch` answers 409
      // `stale_document` with the document as it now stands
      // (`lib/api/v2/route.ts`'s own `ifMatchStale`); this names, per field,
      // what moved underneath the read this panel started from, rather than
      // folding into the generic `failed` banner every other write error
      // above already uses.
      if (response?.status === 409) {
        const body = (await response.json().catch(() => null)) as { details?: Record<string, unknown> } | null;
        setBusy(false);
        // `previewOpen` must not survive this — it is checked before
        // `staleConflict` below (a real bug found live: the confirm screen
        // kept rendering over the refusal, so the person saw their own
        // typed change sitting there as if nothing had happened). Clearing
        // it here is the belt; reordering the two checks in the render is
        // the actual fix, kept both since either alone is a trap for the
        // next screen this component grows.
        setPreviewOpen(false);
        setStaleConflict({ slug: entry.slug, changed: changedFieldsAgainst(day.entries[at], body?.details) });
        return;
      }
      if (!response?.ok) {
        setBusy(false);
        setFailed(entry.slug);
        return;
      }
    }

    // B2073 — the studio page re-reads itself on the server (`onSaved`), so
    // the form stays put and says "Saved." rather than navigating away.
    if (onSaved) {
      setBusy(false);
      onSaved();
      return;
    }

    // The day on screen came from `/<user>/story.json`, which this page fetched
    // and holds in state; there is no server render to revalidate. Rather than
    // teach the pager to re-fetch one day, ask the browser for the page again —
    // it happens once, after a deliberate press, and it is the one thing that
    // cannot show a stale day.
    window.location.reload();
  }

  /**
   * Take the day back off the site — B980 round 3.
   *
   * Every update that is not already a draft, one call each: a day with two
   * updates where only the lead was ever published takes down only that one,
   * and the notice above the card asks by whether *every* update is a draft,
   * so this is what actually earns it. Deliberately its own function and its
   * own button behind `ConfirmPanel`, never folded into `save()` — B28.
   */
  async function takeDown() {
    setFailed(null);
    setBusy(true);
    for (const entry of day.entries) {
      if (entry.draft) continue;
      const response = await fetch(`${dayApiUrl(entry.slug)}/unpublish`, {
        method: "POST",
      }).catch(() => null);
      if (!response?.ok) {
        setBusy(false);
        setFailed(entry.slug);
        return;
      }
    }
    window.location.reload();
  }

  /**
   * E3 — what this save would actually change, entry by entry. Built from
   * `changesFor`'s own output (already only the fields that moved) plus the
   * photograph add/remove counts and reasons `changesFor` does not carry —
   * this is the diff itself, not a second rendering of the whole day.
   */
  function diffRows(): { label: string; value: string; declined?: boolean }[] {
    const rows: { label: string; value: string; declined?: boolean }[] = [];
    day.entries.forEach((entry, at) => {
      const patch = changesFor(at, dropping, mediaReasons[at]);
      const prefix = day.entries.length > 1 ? `${at + 1}. ` : "";
      if (typeof patch.title === "string") rows.push({ label: `${prefix}${t("edit.title")}`, value: patch.title });
      if (typeof patch.time === "string") rows.push({ label: `${prefix}${t("edit.time")}`, value: patch.time });
      if (typeof patch.location === "string") rows.push({ label: `${prefix}${t("edit.place")}`, value: patch.location });
      if (typeof patch.content === "string") {
        rows.push({ label: `${prefix}${t("edit.text")}`, value: patch.content.length > 60 ? `${patch.content.slice(0, 60)}…` : patch.content });
      }
      // B2138 — every dirty field is its own row, so "Save N changes" counts
      // each caption, a photograph's label, who sees it and a translation
      // (a title and a caption edited read "Save 2 changes", not 1).
      const was = draftOf(entry);
      const now = drafts[at];
      if (typeof patch.visibility === "string" || (patch.declined as Record<string, string> | undefined)?.visibility) {
        rows.push({ label: `${prefix}${t("edit.whoSees")}`, value: now.visibility || t("edit.seenAsTrip") });
      }
      if (Array.isArray(patch.costs)) {
        const lines = patch.costs as { label: string; amount: number; currency: string }[];
        rows.push({ label: `${prefix}${t("studio.day.field.costs")}`, value: lines.map((c) => `${c.label} ${c.amount} ${c.currency}`).join(", ") });
      }
      if (typeof patch.transportMode === "string") {
        rows.push({ label: `${prefix}${t("studio.day.field.transportMode")}`, value: t(`studio.day.transport.${patch.transportMode}` as TranslationKey) });
      }
      if (Array.isArray(patch.tags)) rows.push({ label: `${prefix}${t("studio.day.field.tags")}`, value: (patch.tags as string[]).join(", ") });
      for (const item of entry.gallery) {
        if (dropping.includes(item.src)) continue;
        const caption = now.captions[item.src] ?? "";
        if (caption !== was.captions[item.src]) rows.push({ label: `${prefix}${t("edit.caption")}`, value: caption });
        const level = now.photoVisibility[item.src] ?? "";
        if (level !== was.photoVisibility[item.src]) {
          rows.push({ label: `${prefix}${t("edit.whoSees")}`, value: level || t("edit.seenAsUpdate") });
        }
      }
      for (const [code, said] of Object.entries(now.translations)) {
        const before = was.translations[code];
        if (said.title !== (before?.title ?? "") || said.content !== (before?.content ?? "")) {
          rows.push({ label: `${prefix}${t("edit.inLanguage", { language: languageName(code) })}`, value: said.title || said.content.slice(0, 60) });
        }
      }
      const addedCount = (adding[at] ?? []).length;
      const removedCount = entry.gallery.filter((item) => dropping.includes(item.src)).length;
      if (addedCount > 0 || removedCount > 0) {
        rows.push({
          label: `${prefix}${t("edit.photos")}`,
          value: [addedCount > 0 ? `+${addedCount}` : "", removedCount > 0 ? `−${removedCount}` : ""].filter(Boolean).join(" "),
        });
      }
      if (mediaReasons[at]) {
        rows.push({ label: `${prefix}${t("edit.photos")}`, value: mediaReasons[at], declined: true });
      }
    });
    if (date !== day.date) rows.push({ label: t("edit.date"), value: date });
    return rows;
  }

  /** E3/E3✗ — the Save button's actual behaviour when `confirmBeforeSave` is
   *  on: an emptied gallery is answered first (D1's own rule, reused for a
   *  removal rather than an omission), then the diff, then — only on that
   *  screen's own button — the real write. Untouched when the caller left
   *  `confirmBeforeSave` off (`StoryPager`'s own panel). */
  function beginSave() {
    if (!confirmBeforeSave) {
      void save();
      return;
    }
    const missing = emptiedEntries().filter((at) => mediaReasons[at] === undefined);
    if (missing.length > 0) {
      setDeclineQueue(missing);
      return;
    }
    if (inStudioBar) void save();
    else setPreviewOpen(true);
  }

  const rows = diffRows();

  // E3✗ — an entry whose gallery this save would leave empty asks why
  // first, exactly as the still-open list does for a day that never had
  // one (D1). One screen per entry, `DeclineScreen` reused rather than a
  // second decline UI.
  if (declineQueue.length > 0) {
    const at = declineQueue[0];
    return (
      // B1899 — the same shape as `AddDayFlow`'s own queue: every entry in
      // `declineQueue` renders `field="media"` at the same position, so
      // without a key React would reuse one `DeclineScreen` instance across
      // entries and carry the first emptied entry's reason into the rest.
      // `at` (the entry's own index) is unique per queue position and
      // forces the fresh mount `key={currentField}` gives the other queue.
      <DeclineScreen
        key={at}
        field="media"
        whyRequired={MEDIA_WHY_REQUIRED}
        onConfirm={(reason) => {
          const reasons = { ...mediaReasons, [at]: reason };
          setMediaReasons(reasons);
          const rest = declineQueue.slice(1);
          setDeclineQueue(rest);
          if (rest.length === 0) {
            if (inStudioBar) void save(reasons);
            else setPreviewOpen(true);
          }
        }}
        onCancel={() => setDeclineQueue([])}
      />
    );
  }

  // D12 — checked BEFORE `previewOpen` below, deliberately: a refused save
  // must replace the panel rather than sit beside it, and `save()` never
  // clears `previewOpen` on its own success path (there is no "own path" to
  // clear it on — a successful save reloads the page). Found live, driving
  // two tabs against a real day: with this check second, a stale refusal
  // set `staleConflict` correctly but the confirm screen kept rendering
  // over it, because `previewOpen` was still true and was checked first —
  // the person saw their own typed change sitting on screen as if the
  // press had done nothing, never the actual refusal. The draft on screen
  // was built from a read that has moved on, so nothing past this point
  // (including Save) can be trusted until the person re-reads; the only way
  // out is the reload this offers, never a second press of the same Save.
  if (staleConflict) {
    return (
      <section
        aria-label={t("edit.staleConflict.heading")}
        className="mt-3 rounded-xl border border-coral-300 bg-coral-50 p-3"
      >
        <p className="font-display text-sm font-semibold text-ink-strong">
          {t("edit.staleConflict.heading")}
        </p>
        <p className="mt-1 text-sm text-ink-body">{t("edit.staleConflict.body")}</p>
        {staleConflict.changed.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-body">
            {/* The panel's own labels for these fields — `edit.text` (not
                `.content`) and `edit.place` (not `.location`) are its
                existing names, so this reuses them rather than inventing a
                parallel vocabulary. */}
            {staleConflict.changed.map((field) => (
              <li key={field}>
                {t(
                  (
                    { title: "edit.title", content: "edit.text", time: "edit.time", location: "edit.place", media: "edit.photos" } as Record<string, string>
                  )[field] as never,
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-full bg-yellow-400 px-4 text-xs font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
          >
            {t("edit.staleConflict.reload")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink-body transition-colors hover:bg-surface-subtle"
          >
            {t("edit.cancel")}
          </button>
        </div>
      </section>
    );
  }

  // E3 — the diff, and the explicit "nothing written yet" line every
  // preview step in the studio carries (`PreviewNotice`, spec §4). The only
  // write this component performs still happens in `save()`, called here
  // for the first time in this render path.
  if (previewOpen) {
    return (
      <section aria-label={t("edit.confirmSave.heading")} className="mt-3 rounded-xl border border-line-quiet bg-surface-raised p-3">
        <p className="font-display text-sm font-semibold text-ink-strong">{t("edit.confirmSave.heading")}</p>
        <PreviewNotice text={t("studio.skeleton.notWritten")} />
        {/* B1880 — commitLabel pluralised through `tn()`, the repository's
            own count-aware helper, rather than a bespoke ternary: "Save 1
            changes" used to render for exactly one changed field. */}
        <DecideList
          rows={rows}
          commitLabel={tn("edit.confirmSave.button", rows.length, { count: String(rows.length) })}
          busyLabel={t("edit.confirmSave.busy")}
          busy={busy}
          error={failed ? t("edit.failed") : undefined}
          onCommit={() => void save()}
        />
        <button
          type="button"
          onClick={() => setPreviewOpen(false)}
          className="mt-2 text-sm font-semibold text-ink-body underline underline-offset-2"
        >
          {t("edit.confirmSave.back")}
        </button>
      </section>
    );
  }

  /** B2073 — a title emptied here is refused by the day's own validator, so
   *  the form says so under the field rather than after a round trip. */
  const titleMissing = drafts.some((draft, at) => draft.title.trim() === "" && (day.entries[at].title ?? "") !== "");
  const costIncomplete = drafts.some((draft) => draft.extras.costs.some(lineProblem));

  return (
    <section
      aria-label={t("edit.heading")}
      className={inStudioBar ? "mt-6" : "mt-3 rounded-xl border border-line-quiet bg-surface-raised p-3"}
    >
      {!inStudioBar && (
        <>
          <p className="font-display text-sm font-semibold text-ink-strong">
            {t("edit.heading")}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-ink-secondary">{t("edit.body")}</p>
        </>
      )}
      {drafts.map((draft, at) => (
        <div
          key={day.entries[at].slug}
          className={at === 0 && inStudioBar ? "" : "mt-4 border-t border-line-quiet pt-3"}
        >
          {day.entries.length > 1 && (
            <p className="text-xs font-semibold text-ink-muted">
              {formatLongDate(day.date)} · {at + 1}/{day.entries.length}
            </p>
          )}

          <label className="mt-2 block">
            <span className={EYEBROW}>
              {t("edit.title")}
            </span>
            <input
              value={draft.title}
              onChange={(event) => set(at, { title: event.target.value })}
              aria-invalid={draft.title.trim() === "" && (day.entries[at].title ?? "") !== ""}
              className={`mt-1 ${FIELD}`}
            />
          </label>
          {draft.title.trim() === "" && (day.entries[at].title ?? "") !== "" && (
            <p role="alert" className="mt-1 text-sm text-coral-600">
              {t("edit.titleNeeded")}
            </p>
          )}

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className={EYEBROW}>
                {t("edit.time")}
              </span>
              <input
                value={draft.time}
                placeholder="14:00"
                onChange={(event) => set(at, { time: event.target.value })}
                className={`mt-1 ${FIELD}`}
              />
            </label>
            <label className="block">
              <span className={EYEBROW}>
                {t("edit.place")}
              </span>
              <input
                value={draft.location}
                onChange={(event) => set(at, { location: event.target.value })}
                className={`mt-1 ${FIELD}`}
              />
            </label>
          </div>

          <label className="mt-2 block">
            <span className={EYEBROW}>
              {t("edit.text")}
            </span>
            <textarea
              rows={10}
              value={draft.content}
              onChange={(event) => set(at, { content: event.target.value })}
              className={`mt-1 ${FIELD} font-mono leading-6`}
            />
          </label>

          {Object.entries(draft.translations).map(([code, said]) => (
            <div key={code} className="mt-2 rounded-lg bg-surface-subtle p-2">
              <p className="text-xs font-semibold text-ink-body">
                {t("edit.inLanguage", { language: languageName(code) })}
              </p>
              <input
                value={said.title}
                onChange={(event) =>
                  set(at, {
                    translations: {
                      ...draft.translations,
                      [code]: { ...said, title: event.target.value },
                    },
                  })
                }
                className={`mt-1 ${FIELD}`}
              />
              <textarea
                rows={6}
                value={said.content}
                onChange={(event) =>
                  set(at, {
                    translations: {
                      ...draft.translations,
                      [code]: { ...said, content: event.target.value },
                    },
                  })
                }
                className={`mt-1 ${FIELD} font-mono leading-6`}
              />
            </div>
          ))}

          {currencies && (
            <div className="mt-3">
              <DayExtras
                value={draft.extras}
                onChange={(extras) => set(at, { extras })}
                currencies={currencies}
                keep={{
                  costs: day.entries[at].costs.length > 0,
                  transportMode: !!day.entries[at].transport?.mode,
                  tags: day.entries[at].tags.length > 0,
                }}
              />
            </div>
          )}

          {/* The pictures of this update — B980 round 2. A caption and a
              label are fields of the day and go with the words on save; a
              removal and an upload are their own calls to `photos/`, and
              nothing leaves disk until the same press. */}
          <div className="mt-3">
            <p className={EYEBROW}>
              {t("edit.photos")}
            </p>
            {day.entries[at].gallery.map((item) => {
              const going = dropping.includes(item.src);
              return (
                <div
                  key={item.src}
                  className={`mt-2 flex gap-2 rounded-lg border border-line-quiet p-2 ${going ? "opacity-50" : ""}`}
                >
                  {/* The derivative the page already draws, at thumbnail
                        size. `img` rather than `next/image`: this is one
                        already-sized file behind an owner-only panel, and the
                        loader would buy nothing. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.poster ?? item.src}
                    alt={item.alt ?? item.caption ?? ""}
                    className="h-16 w-16 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <input
                      value={draft.captions[item.src] ?? ""}
                      placeholder={t("edit.caption")}
                      disabled={going}
                      onChange={(event) =>
                        set(at, {
                          captions: {
                            ...draft.captions,
                            [item.src]: event.target.value,
                          },
                        })
                      }
                      className={FIELD}
                    />
                    <div className="mt-1 flex gap-2">
                      <select
                        value={draft.photoVisibility[item.src] ?? ""}
                        disabled={going}
                        onChange={(event) =>
                          set(at, {
                            photoVisibility: {
                              ...draft.photoVisibility,
                              [item.src]: event.target
                                .value as Draft["visibility"],
                            },
                          })
                        }
                        className={FIELD}
                      >
                        <option value="">{t("edit.seenAsUpdate")}</option>
                        <option value="guest">
                          {t("agent.tool.visibilityGuest")}
                        </option>
                        <option value="private">
                          {t("agent.tool.visibilityPrivate")}
                        </option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setDropping((prev) =>
                            going
                              ? prev.filter((s) => s !== item.src)
                              : [...prev, item.src],
                          )
                        }
                        className="min-h-11 shrink-0 rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-body transition-colors hover:bg-surface-subtle"
                      >
                        {t(going ? "edit.keepPhoto" : "edit.removePhoto")}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* B1012 — the picker B768 already wrote, rather than a second
                bare `<input type="file">`. A bare one draws its own button and
                its own "No file chosen" in the *browser's* locale, from
                strings no CSS and no attribute can reach, which is the
                sentence B768 exists to stop rendering. Narrowed to pictures
                and video: a correction to a day adds nothing else, and there
                is no inbox behind this panel to sort a receipt into. */}
            <div className="mt-2">
              <span className={EYEBROW}>
                {t("edit.addPhotos")}
              </span>
              <PhotoPicker
                id={`edit-add-${at}`}
                accept="image/*,video/*"
                chosen={adding[at] ?? []}
                onPick={(files) =>
                  setAdding((prev) => ({ ...prev, [at]: [...(files ?? [])] }))
                }
              />
            </div>
          </div>

          {/* A label narrows and never widens — B632. There is no "public"
              here for that reason: the trip's own visibility is the ceiling
              and this can only sit under it. */}
          <label className="mt-2 block">
            <span className={EYEBROW}>
              {t("edit.whoSees")}
            </span>
            <select
              value={draft.visibility}
              onChange={(event) =>
                set(at, {
                  visibility: event.target.value as Draft["visibility"],
                })
              }
              className={`mt-1 ${FIELD}`}
            >
              <option value="">{t("edit.seenAsTrip")}</option>
              <option value="guest">{t("agent.tool.visibilityGuest")}</option>
              <option value="private">
                {t("agent.tool.visibilityPrivate")}
              </option>
            </select>
          </label>
        </div>
      ))}

      {/* The date belongs to the day rather than to one update — below every
          update's own fields, since it is the one a correction least often
          touches. */}
      <div className="mt-4">
        <DateField label={t("edit.date")} labelClassName={`block ${EYEBROW}`} value={date} onChange={setDate} {...calendar} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {inStudioBar ? (
          <StepPrimary
            label={rows.length === 0 ? t("me.journalSave") : tn("edit.confirmSave.button", rows.length, { count: String(rows.length) })}
            busy={busy}
            busyLabel={t("edit.confirmSave.busy")}
            disabled={!ready || rows.length === 0 || titleMissing || costIncomplete}
            onClick={beginSave}
            tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
          />
        ) : (
          <>
            <BusyButton
              busy={busy}
              type="button"
              onClick={beginSave}
              className="min-h-11 rounded-full bg-yellow-400 px-4 text-xs font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
            >
              {t("edit.save")}
            </BusyButton>
            <BusyButton
              busy={busy}
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink-body transition-colors hover:bg-surface-subtle disabled:opacity-50"
            >
              {t("edit.cancel")}
            </BusyButton>
          </>
        )}
        {/* Only where there is something left to take down — a day whose
            every update is already a draft has nothing this button would do. */}
        {!takingDown && day.entries.some((entry) => !entry.draft) && (
          <button
            type="button"
            onClick={() => setTakingDown(true)}
            className="min-h-11 rounded-full border border-coral-300 px-4 text-xs font-semibold text-coral-600 transition-colors hover:bg-coral-50"
          >
            {t("edit.takeDown")}
          </button>
        )}
      </div>

      {/* Its own press, its own confirmation — B28. Never a side effect of
          Save, and never a `window.confirm` — B633/B668. */}
      {takingDown && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("edit.takeDown")}
            question={t("edit.takeDownQuestion")}
            confirmLabel={t("edit.takeDownConfirm")}
            busy={busy}
            error={failed ? t("edit.failed") : undefined}
            onConfirm={() => void takeDown()}
            onCancel={() => setTakingDown(false)}
          />
        </div>
      )}

      {failed && !takingDown && (
        <p role="alert" className="mt-2 text-xs text-coral-600">
          {t("edit.failed")}
        </p>
      )}
      {saved && rows.length === 0 && (
        <p role="status" className="mt-2 text-sm text-ink-secondary">
          {t("edit.saved")}
        </p>
      )}
    </section>
  );
}
