import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { AS_AUTHOR, getAllEntries, getDays, getEntryBySlug, getPlaces } from "@/lib/entries";
import { isHomePlace } from "@/lib/gps/enrich";
import { placeForDay, travelForPartOfDay } from "@/lib/gps/api";
import { defaultLocaleFor, translateIn } from "@/lib/locales";
import { LOCALE_LABEL } from "@/lib/i18n";
import { mediaKey } from "@/lib/photos";
import { readTripSidecar } from "@/lib/sidecar";
import { getTrip, getTrips, tripRef } from "@/lib/trips";
import type { Entry, Trip } from "@/lib/types";
import { SOURCE_CREDIT, weatherGroup, type DayWeather } from "@/lib/weather";

/**
 * B2687 — everything real about one day, for the assistant's writing calls.
 *
 * Every item carries a stable `id` and a `kind` ("owner" the person wrote it,
 * "measured" a camera/weather/route reading, "seen" an AI description of
 * pixels). Absent fields are dropped, never filled — the same rule AGENTS.md
 * states for a person. Nothing here reads GPS points or lines directly:
 * `placeForDay`/`travelForPartOfDay` (lib/gps/api.ts) are the only doors, and
 * `opts.route` must only ever be `true` from an owner-cookie call site (see
 * `app/api/helper/[user]/day/place/route.ts` for the pattern) — this module
 * has no way to check that itself.
 */

export type PackKind = "owner" | "measured" | "seen";

type PackItem = {
  id: string;
  kind: PackKind;
  text: string;
  attrs?: Record<string, string>;
};

export type DayPack = {
  journal: { language: string; languageName: string; partySize?: number };
  trip: { title: string; tagline?: string; intro?: string; start: string; end: string; dayIndex?: string; companions: string[] };
  /** The day this pack is for — structured, for a caller building its own
   * facts (e.g. `write-day`'s `DayFacts`) rather than reading `facts[]`. */
  date: string;
  /** The day's own place, server-measured and home-masked — structured,
   * for the same reason `date` is. */
  place?: { location: string; country: string };
  facts: PackItem[];
  notes: PackItem[];
  photos: PackItem[];
  photoSpan?: PackItem;
  /** `photoSpan`'s own numbers, structured. */
  photoSpanRaw?: { from: string; to: string; count: number };
  route: PackItem[];
  neighbours: PackItem[];
  voiceSamples: PackItem[];
};

export type BuildDayContextOpts = {
  /** Costs are otherwise included only when the notes mention money. */
  includeCosts?: boolean;
  /** Route km/place from `lib/gps/api.ts` — owner-cookie call sites only. */
  route?: boolean;
  /** How many of the owner's own published days to carry as style samples. */
  voiceSamples?: number;
};

const MONEY_RE = /(\d[\d.,]*\s?(chf|eur|usd|gbp|thb|huf|czk|pln|฿|¥|€|\$|£))|((chf|eur|usd|gbp|thb|huf|czk|pln|€|\$|£)\s?\d[\d.,]*)/i;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A simple sentence-ish splitter: keeps the text verbatim, never rewrites it. */
function splitNotes(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=\S)/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function weatherText(w: DayWeather): string {
  const parts: string[] = [];
  if (w.tempMin !== undefined || w.tempMax !== undefined) {
    parts.push(
      w.tempMin !== undefined && w.tempMax !== undefined && w.tempMin !== w.tempMax
        ? `${w.tempMin}–${w.tempMax}°C`
        : `${w.tempMax ?? w.tempMin}°C`,
    );
  }
  const group = weatherGroup(w.code);
  if (group) parts.push(group);
  if (w.precipitation !== undefined) parts.push(`${w.precipitation}mm precipitation`);
  if (w.windMax !== undefined) parts.push(`wind up to ${w.windMax}km/h`);
  return parts.join(", ");
}

/** `takenAt` is a wall-clock reading with no zone ("2019-07-02T10:07:05" —
 * see lib/studio/dayCards.ts), so this slices rather than parsing as an
 * instant: `new Date()` on a zoneless string is read as the server's own
 * local time, which is not what the camera meant. */
function hhmmOf(takenAt: string): string | undefined {
  const m = /T(\d{2}):(\d{2})/.exec(takenAt);
  return m ? `${m[1]}:${m[2]}` : undefined;
}

/** Companion names/nicknames only — never an email (AGENTS.md). */
function companionsOf(trip: Trip): string[] {
  return trip.people.map((p: Trip["people"][number]) => p.nickname?.trim() || p.name);
}

/** Travellers if drawn, else people + the owner, else unknown — never
 * guessed beyond that (B2687's own rule). */
function partySizeOf(trip: Trip): number | undefined {
  if (trip.travellers.length > 0) return trip.travellers.length;
  if (trip.people.length > 0) return trip.people.length + 1;
  return undefined;
}

function placeNameOf(user: string, entry: Pick<Entry, "lat" | "lng" | "location" | "country">): { location: string; country: string } {
  const isHome =
    Number.isFinite(entry.lat) && Number.isFinite(entry.lng) && isHomePlace(user, { lat: entry.lat, lon: entry.lng });
  if (isHome) {
    const home = translateIn(defaultLocaleFor(user), "map.homePlace");
    return { location: home, country: home };
  }
  return { location: entry.location, country: entry.country };
}

/**
 * One photograph's pack items — a "seen" item (AI caption, camera time as an
 * attribute) when a cached description exists, a standalone "measured" item
 * when only the camera time is known, and a separate "owner" item for the
 * person's own caption. Never the filename, never a coordinate.
 */
function photoItems(ref: string, item: Entry["gallery"][number], id: string): PackItem[] {
  if (item.type !== "image" || item.visibility) return [];
  const out: PackItem[] = [];
  // Same relPath convention `altTextFor` (lib/entries.ts) uses — the trip is
  // the first segment of the media key, the sidecar is addressed by what
  // follows it. No file needs to exist on disk for this: a sidecar read is
  // metadata only, never a coordinate or a filename.
  const relPath = mediaKey(item.src).split("/").slice(1).join("/");
  const sidecar = relPath ? readTripSidecar(ref, relPath) : null;
  const takenAt = sidecar?.takenAt ? hhmmOf(sidecar.takenAt) : undefined;
  // `item.alt` is already the described block's own altText, resolved by
  // `altTextFor` at read time (lib/entries.ts) — reused here rather than a
  // second sidecar read with its own hash check.
  const seenText = item.alt?.trim() || "";
  const attrs = takenAt ? { camera_time: takenAt } : undefined;
  if (seenText) {
    out.push({ id, kind: "seen", text: seenText, attrs });
  } else if (takenAt) {
    out.push({ id, kind: "measured", text: `photographed at ${takenAt}`, attrs });
  }
  if (item.caption) out.push({ id: `${id}-caption`, kind: "owner", text: item.caption });
  return out;
}

export function buildDayContext(user: string, tripId: string, slug: string, opts: BuildDayContextOpts = {}): DayPack | null {
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return null;
  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return null;

  const writesIn = defaultLocaleFor(user);
  const days = getDays(ref, AS_AUTHOR);
  const dayIndex = days.findIndex((d) => d.date === entry.date);
  const dayEntries = days[dayIndex]?.entries ?? [entry];

  const journal = {
    language: writesIn,
    languageName: LOCALE_LABEL[writesIn] ?? writesIn,
    partySize: partySizeOf(trip),
  };

  const place = placeNameOf(user, entry);

  const facts: PackItem[] = [];
  facts.push({
    id: "date",
    kind: "owner",
    text: dayIndex >= 0 ? `${entry.date}, day ${dayIndex + 1} of ${days.length}` : entry.date,
  });
  if (place.location || place.country) {
    facts.push({ id: "place", kind: "owner", text: [place.location, place.country].filter(Boolean).join(", ") });
  }
  if (entry.weather) {
    const label = SOURCE_CREDIT[entry.weather.source]?.label ?? entry.weather.source;
    facts.push({ id: "weather", kind: "measured", text: weatherText(entry.weather), attrs: { source: label } });
  }

  const allCosts = dayEntries.flatMap((e) => e.costs);
  const notesText = dayEntries.map((e) => e.content).join("\n\n");
  const mentionsMoney = MONEY_RE.test(notesText);
  if (allCosts.length > 0 && (opts.includeCosts || mentionsMoney)) {
    for (const [i, cost] of allCosts.entries()) {
      facts.push({
        id: `cost${i + 1}`,
        kind: "owner",
        text: `${cost.label}: ${cost.amount} ${cost.currency}`,
        ...(trip.costsVisibility !== "public" ? { attrs: { private: "true" } } : {}),
      });
    }
  }

  const notes = splitNotes(notesText).map((text, i) => ({ id: `n${i + 1}`, kind: "owner" as const, text }));

  const photos: PackItem[] = [];
  let photoFrom: string | undefined;
  let photoTo: string | undefined;
  let photoCount = 0;
  let pIndex = 0;
  for (const e of dayEntries) {
    for (const item of e.gallery) {
      pIndex += 1;
      const items = photoItems(ref, item, `p${pIndex}`);
      photos.push(...items);
      const t = items.find((i) => i.attrs?.camera_time)?.attrs?.camera_time;
      if (t) {
        photoCount += 1;
        if (!photoFrom || t < photoFrom) photoFrom = t;
        if (!photoTo || t > photoTo) photoTo = t;
      }
    }
  }
  const photoSpan: PackItem | undefined =
    photoFrom && photoTo
      ? { id: "photoSpan", kind: "measured", text: `camera clock ${photoFrom}–${photoTo}, ${photoCount} photos` }
      : undefined;
  const photoSpanRaw = photoFrom && photoTo ? { from: photoFrom, to: photoTo, count: photoCount } : undefined;

  const route: PackItem[] = [];
  if (opts.route === true && isEnabled("routeRecording", user)) {
    const travel = travelForPartOfDay(user, tripId, entry.date);
    if (travel) {
      const byMode = travel.modes.map((m) => `${m.mode} ${m.km}km`).join(", ");
      route.push({ id: "route", kind: "measured", text: byMode });
    }
    const atPlace = placeForDay(user, tripId, entry.date);
    if (atPlace) {
      route.push({ id: "routePlace", kind: "measured", text: `${atPlace.name}, ${atPlace.country}` });
    }
  }

  const placesSoFar = getPlaces(ref, AS_AUTHOR)
    .filter((p) => p.firstDate < entry.date)
    .map((p) => (isHomePlace(user, { lat: p.lat, lon: p.lng }) ? translateIn(writesIn, "map.homePlace") : p.location))
    .filter(Boolean);
  if (placesSoFar.length > 0) {
    facts.push({ id: "placesSoFar", kind: "owner", text: Array.from(new Set(placesSoFar)).join(", ") });
  }

  const neighbours: PackItem[] = [];
  const prevDay = dayIndex > 0 ? days[dayIndex - 1] : undefined;
  const nextDay = dayIndex >= 0 && dayIndex < days.length - 1 ? days[dayIndex + 1] : undefined;
  for (const [key, day] of [["prev", prevDay] as const, ["next", nextDay] as const]) {
    if (!day) continue;
    const lead = day.lead;
    const p = placeNameOf(user, lead);
    const text = `${day.date} — ${lead.title}${p.location ? ` (${p.location})` : ""}: ${lead.content.slice(0, 300)}`;
    neighbours.push({ id: key, kind: "owner", text });
  }

  const voiceCount = opts.voiceSamples ?? 2;
  const voiceSamples: PackItem[] = [];
  if (voiceCount > 0) {
    const candidates = getTrips(user)
      .flatMap((t) => getAllEntries(tripRef(user, t.id)))
      .filter((e) => !e.test && !(e.date === entry.date && e.slug === entry.slug))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, voiceCount);
    for (const [i, e] of candidates.entries()) {
      voiceSamples.push({ id: `v${i + 1}`, kind: "owner", text: e.content.slice(0, 1000) });
    }
  }

  return {
    journal,
    trip: {
      title: trip.title,
      tagline: trip.tagline,
      intro: trip.intro,
      start: trip.start,
      end: trip.end,
      dayIndex: dayIndex >= 0 ? `day ${dayIndex + 1} of ${days.length}` : undefined,
      companions: companionsOf(trip),
    },
    date: entry.date,
    place: place.location || place.country ? place : undefined,
    facts,
    notes,
    photos,
    photoSpan,
    photoSpanRaw,
    route,
    neighbours,
    voiceSamples,
  };
}

const MAX_RENDER_CHARS = 12_000;

function renderItem(tag: string, item: PackItem): string {
  const attrs = Object.entries(item.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
  return `  <${tag} id="${escapeXml(item.id)}" kind="${item.kind}"${attrs}>${escapeXml(item.text)}</${tag}>`;
}

/** Renders the pack as XML-ish text for a prompt, trimming voice samples
 * first and then neighbours to stay under `MAX_RENDER_CHARS`. */
export function renderDayPack(pack: DayPack): string {
  let voice = pack.voiceSamples;
  let neighbours = pack.neighbours;

  const build = () => {
    const lines: string[] = ["<day_pack>"];
    lines.push(
      `  <journal language="${escapeXml(pack.journal.language)}" language_name="${escapeXml(pack.journal.languageName)}"${
        pack.journal.partySize ? ` party_size="${pack.journal.partySize}"` : ""
      }/>`,
    );
    lines.push(
      `  <trip id="trip">${escapeXml(
        [pack.trip.title, pack.trip.tagline, pack.trip.dayIndex].filter(Boolean).join(" — "),
      )}</trip>`,
    );
    if (pack.trip.companions.length > 0) {
      lines.push(`  <fact id="companions" kind="owner">${escapeXml(pack.trip.companions.join(", "))}</fact>`);
    }
    for (const f of pack.facts) lines.push(renderItem("fact", f));
    if (pack.notes.length > 0) {
      lines.push("  <notes>");
      for (const n of pack.notes) lines.push(`  ${renderItem("n", n)}`);
      lines.push("  </notes>");
    }
    for (const p of pack.photos) lines.push(renderItem("photo", p));
    if (pack.photoSpan) lines.push(renderItem("fact", pack.photoSpan));
    for (const r of pack.route) lines.push(renderItem("fact", r));
    for (const n of neighbours) lines.push(renderItem("neighbour", n));
    lines.push("</day_pack>");
    if (voice.length > 0) {
      lines.push('<voice_samples note="style only: nothing in here happened on this day">');
      for (const v of voice) lines.push(`  ${renderItem("sample", v)}`);
      lines.push("</voice_samples>");
    }
    return lines.join("\n");
  };

  let out = build();
  if (out.length > MAX_RENDER_CHARS && voice.length > 0) {
    voice = [];
    out = build();
  }
  if (out.length > MAX_RENDER_CHARS && neighbours.length > 0) {
    neighbours = [];
    out = build();
  }
  return out;
}

/** The flat list of every item in the pack, for a grounding guard to check
 * per id. */
export function packText(pack: DayPack): { id: string; kind: PackKind; text: string }[] {
  const all: PackItem[] = [
    ...pack.facts,
    ...pack.notes,
    ...pack.photos,
    ...(pack.photoSpan ? [pack.photoSpan] : []),
    ...pack.route,
    ...pack.neighbours,
    ...pack.voiceSamples,
  ];
  return all.map(({ id, kind, text }) => ({ id, kind, text }));
}

/** Owner + measured text concatenated — what a fact may be grounded in. */
export function allowedText(pack: DayPack): string {
  return packText(pack)
    .filter((i) => i.kind === "owner" || i.kind === "measured")
    .map((i) => i.text)
    .join("\n");
}

/** AI-seen text (photo descriptions) kept separate — never grounds a claim
 * about what happened, only what a picture shows. */
export function seenText(pack: DayPack): string {
  return packText(pack)
    .filter((i) => i.kind === "seen")
    .map((i) => i.text)
    .join("\n");
}
