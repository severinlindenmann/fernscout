/**
 * A trip on disk becomes the flat structure the planner wants.
 *
 * This is the only module in `lib/photobook/` that knows the content layout
 * exists. Everything downstream — planning, rendering, preview — works on a
 * `BookSource` and would be just as happy with one assembled from a database,
 * which is what W06 will eventually hand it.
 *
 * It reads the JPEG header of any photograph whose frontmatter does not declare
 * its dimensions. The planner cannot choose a layout without knowing whether a
 * picture is tall or wide, and guessing gets it wrong on the pages where it
 * matters most.
 */

import fs from "node:fs";
import path from "node:path";
import { isEnabled } from "../capabilities";
import { serverSite, travellersOf } from "../site";
import { loadUserConfig } from "../config";
import { contentRoot } from "../contentRoot";
import { getDays, getPlaces } from "../entries";
import { getPlan } from "../plan";
import { getCostSummary } from "../costs";
import { getTrip, tripDir } from "../trips";
import { readJpeg } from "../postcard/pdf.ts";
import { paragraphsOf } from "./text.ts";
import type { BookCosts, BookDay, BookPhoto, BookSource, RoutePoint } from "./plan.ts";

/** `/media/<trip>/a/b.jpg` → the file on disk inside that trip. */
export function mediaFileFor(ref: string, src: string): string {
  // Entry frontmatter keeps media trip-relative; the reader prefixes the
  // username, so a src may arrive either way. Accept both.
  const tripId = ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref;
  const owner = ref.includes("/") ? ref.slice(0, ref.indexOf("/")) : "";
  const prefixes = [`/${owner}/media/${tripId}/`, `/media/${tripId}/`];
  const prefix = prefixes.find((p) => src.startsWith(p)) ?? `/media/${tripId}/`;
  const relative = src.startsWith(prefix) ? src.slice(prefix.length) : src.replace(/^\/+/, "");
  return path.join(tripDir(ref), "media", relative);
}

function dimensionsOf(file: string): { width: number; height: number } | null {
  try {
    const image = readJpeg(new Uint8Array(fs.readFileSync(file)));
    return { width: image.width, height: image.height };
  } catch {
    return null;
  }
}

function costsFor(tripId: string): BookCosts | undefined {
  if (!isEnabled("costs", getTrip(tripId)?.username)) return undefined;
  const summary = getCostSummary(tripId);
  if (summary.total <= 0) return undefined;
  return {
    baseCurrency: summary.baseCurrency,
    total: summary.total,
    preparation: summary.preparation,
    onTheRoad: summary.onTheRoad,
    perDay: summary.perDay,
    byCategory: summary.byCategory.map((c) => ({ category: c.category, amount: c.amount })),
    byCountry: summary.byCountry.map((c) => ({
      country: c.country,
      amount: c.amount,
      nights: c.nights,
    })),
    budget: summary.budget ? { total: summary.budget.total, days: summary.budget.days } : undefined,
  };
}

/**
 * The route the book draws.
 *
 * Where we actually went, not where we meant to go: `content/plan.md` is a
 * forward-looking document and a finished book should show the trip that
 * happened. The plan is the fallback for a trip that has barely started, so an
 * upcoming trip still gets a map.
 */
function routeFor(tripId: string): RoutePoint[] {
  const places = getPlaces(tripId).map((p) => ({
    location: p.location,
    country: p.country,
    lat: p.lat,
    lng: p.lng,
  }));
  if (places.length >= 2) return places;
  return getPlan(tripId).stops.map((s) => ({
    location: s.location,
    country: s.country,
    lat: s.lat,
    lng: s.lng,
  }));
}

export type SourceOptions = {
  /** Printed in the colophon. Defaults to today; passed in by tests. */
  madeOn?: string;
  /** Skip photographs below this pixel width entirely rather than printing
   * them soft. Off by default — a soft photo of something that happened once
   * still beats a gap. */
  minPixelWidth?: number;
};

export function buildBookSource(tripId: string, options: SourceOptions = {}): BookSource {
  const trip = getTrip(tripId);
  if (!trip) throw new Error(`No trip "${tripId}" in ${tripDir(tripId)}`);

  const config = loadUserConfig(trip.username);
  const travellers = travellersOf(config, trip)
    .map((p) => p.nickname || p.name)
    .filter(Boolean);

  const days: BookDay[] = getDays(tripId).map((day) => {
    const photos: BookPhoto[] = [];
    for (const entry of day.entries) {
      for (const item of entry.gallery) {
        if (item.type !== "image") continue;
        const file = mediaFileFor(tripId, item.src);
        const size =
          item.width && item.height
            ? { width: item.width, height: item.height }
            : dimensionsOf(file);
        if (!size) continue;
        if (options.minPixelWidth && size.width < options.minPixelWidth) continue;
        photos.push({
          file,
          label: path.relative(contentRoot(), file),
          width: size.width,
          height: size.height,
          caption: item.caption,
        });
      }
    }

    // Several updates in one day become one page of prose, each introduced by
    // its own title so the reader can tell them apart.
    const paragraphs = day.entries.flatMap((entry, i) =>
      day.entries.length > 1 && i > 0
        ? [`${entry.title} — ${paragraphsOf(entry.content).join(" ")}`]
        : paragraphsOf(entry.content),
    );

    return {
      date: day.date,
      title: day.lead.title,
      location: day.lead.location,
      country: day.lead.country,
      countryCode: day.lead.countryCode,
      lat: day.lead.lat,
      lng: day.lead.lng,
      paragraphs,
      photos,
    };
  });

  return {
    trip: {
      id: trip.id,
      title: trip.title,
      tagline: trip.tagline,
      start: trip.start,
      end: trip.end,
      intro: trip.intro,
    },
    travellers,
    days,
    route: routeFor(tripId),
    costs: costsFor(tripId),
    madeOn: options.madeOn ?? new Date().toISOString().slice(0, 10),
    // The colophon points at the journal this book came from.
    siteUrl: `${serverSite().url}/${trip.username}`,
  };
}
