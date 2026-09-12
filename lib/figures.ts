import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { userDir } from "./users";
import { getTripIds, tripDir, tripRef } from "./trips";
import type { FigureDoc } from "./api/v2/schemas/figures";

/**
 * The figure library — B1609, phase 2 step 3 (parcel D).
 *
 * v1 described a walking figure inline, per trip, in a `travellers:` block —
 * so the same person was re-described in every trip they appeared in, and
 * nothing tied one description to another. v2 makes a figure a journal-level
 * document, referenced by id from `journalDoc.figures` and `tripDoc.figures`
 * (`lib/api/v2/schemas/figures.ts`, which this module stores). This file is
 * the storage: create, read, list, delete. There was no domain layer for
 * this before this ticket — `lib/travellers/` only ever held the vocabulary,
 * the renderer and a parser for the inline block.
 *
 * ## File layout: one JSON file per figure, not `lib/inbox.ts`'s sidecar pair
 *
 * `lib/inbox.ts` is the house precedent for "a collection of small per-
 * journal documents on disk" and its shape is a file plus a `.meta.json`
 * sidecar, because an inbox item is arbitrary *bytes* (a photograph, a bank
 * export) with facts *about* those bytes recorded beside them. A figure has
 * no bytes half — a `figureDoc` **is** the whole document, the same
 * relationship a day or a trip has to its own JSON file (`lib/api/v2/
 * documents.ts`). So the layout here is that one: `content/<user>/figures/
 * <id>.json`, one file, no sidecar — and the same fixed-key-order,
 * two-space-indent convention `dayToJson`/`tripToJson` use, so a diff in git
 * is always a change in content.
 *
 * Ids are client-chosen (S2) and already constrained to `ID_RE` by
 * `figureDoc`'s own schema — lowercase words joined by hyphens — which is
 * also a safe filename. `path.basename` is still applied everywhere an id
 * reaches a path, the same defensive rule `lib/inbox.ts` and `lib/trips.ts`
 * apply to theirs: a schema is the route's guarantee, not this module's.
 */

function figuresDir(username: string): string {
  return path.join(userDir(username), "figures");
}

function figurePath(username: string, id: string): string {
  return path.join(figuresDir(username), `${path.basename(id)}.json`);
}

/** Key order fixed, same reason as `dayToJson`/`tripToJson` — a rewrite of an
 * unchanged figure must not show up as a diff. */
function figureToJson(doc: FigureDoc): string {
  const data: Record<string, unknown> = {
    id: doc.id,
    name: doc.name,
    person: doc.person,
    hairStyle: doc.hairStyle,
    outfit: doc.outfit,
    build: doc.build,
    age: doc.age,
    skin: doc.skin,
    hair: doc.hair,
    eyes: doc.eyes,
    shirt: doc.shirt,
    pants: doc.pants,
    pack: doc.pack,
    headscarf: doc.headscarf,
    accessories: doc.accessories,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

function figureFromJson(raw: string): FigureDoc {
  // Not wrapped in a try/catch that returns null: a figure file that exists
  // but will not parse is a fault on disk, the same distinction
  // `dayFromJson` draws — the caller (a route, or `listFigures` below) is the
  // one that gets to decide whether that means "skip it" or "this is a bug".
  return JSON.parse(raw) as FigureDoc;
}

/** One figure, by id — `null` when there is none by that id. */
export function getFigureDoc(username: string, id: string): FigureDoc | null {
  const file = figurePath(username, id);
  if (!fs.existsSync(file)) return null;
  try {
    return figureFromJson(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Every figure in the library, sorted by id — the fixed order
 * `listFiguresPage` below depends on. */
function listFigureDocs(username: string): FigureDoc[] {
  const dir = figuresDir(username);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      try {
        return figureFromJson(fs.readFileSync(path.join(dir, n), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((doc): doc is FigureDoc => doc !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export type FigurePage = { items: FigureDoc[]; nextCursor?: string };

/** No convention for a list's page size existed anywhere in this codebase to
 * mirror (checked `lib/inbox.ts`, `lib/api/entries.ts`) — chosen fresh. */
export const DEFAULT_FIGURES_LIMIT = 50;
export const MAX_FIGURES_LIMIT = 200;

/** `?limit=&cursor=`/`next_cursor` (V12) — cursor is the last id of the
 * previous page, since ids already sort as plain strings and carry no
 * information a caller shouldn't see (unlike, say, a database row id). */
export function listFiguresPage(
  username: string,
  { limit, cursor }: { limit: number; cursor?: string },
): FigurePage {
  const all = listFigureDocs(username);
  const start = cursor ? all.findIndex((f) => f.id > cursor) : 0;
  const from = start < 0 ? all.length : start;
  const items = all.slice(from, from + limit);
  const nextCursor = from + limit < all.length ? items[items.length - 1]?.id : undefined;
  return { items, nextCursor };
}

/** Whether a figure by this id is already on disk — what a PUT needs to know
 * before deciding "create" from "refuse as a retried create" (see the route
 * for why a PUT without `If-Match` on an existing id is a 409, not a
 * replace). */
function figureExists(username: string, id: string): boolean {
  return fs.existsSync(figurePath(username, id));
}

/** Write a figure, unconditionally — create or replace. The route is what
 * decides whether writing now is allowed (S2's retried-create refusal,
 * V11's `If-Match`); this function only knows how to put bytes on disk. */
export function writeFigureDoc(username: string, doc: FigureDoc): void {
  const dir = figuresDir(username);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(figurePath(username, doc.id), figureToJson(doc));
}

export type FigureReferences = { journal: boolean; trips: string[] };

/**
 * Everything that currently names this figure id — the journal's own
 * default set (`config.json`'s `figures` key) and every trip's own set
 * (`trip.md`'s frontmatter today; `trip.json`'s top-level `figures` key once
 * the trip routes ship — both are read here, generically, since neither has
 * written a real `journalFigures`/`tripFigures` value yet as of this ticket
 * and this check has to still work once one does).
 *
 * Read raw rather than through `getUser`/`getTrips` (which parse into the
 * *v1* `UserConfig`/`Trip` shapes and know nothing about a v2 `figures`
 * key): those types would silently drop the field this function exists to
 * find. A file that will not parse is treated as "does not reference it" —
 * the same fail-open choice `getMalformedTrips` makes elsewhere, because a
 * broken trip file blocking every figure deletion in the journal forever is
 * a worse failure than missing one reference on a trip that was already
 * unreadable.
 */
export function figureReferences(username: string, id: string): FigureReferences {
  const namesId = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const figures = (value as { figures?: unknown }).figures;
    return Array.isArray(figures) && figures.includes(id);
  };

  let journal = false;
  try {
    const raw = fs.readFileSync(path.join(userDir(username), "config.json"), "utf8");
    const config = JSON.parse(raw) as { figures?: unknown };
    journal = namesId(config.figures);
  } catch {
    journal = false;
  }

  const trips: string[] = [];
  for (const tripId of getTripIds(username)) {
    const dir = tripDir(tripRef(username, tripId));
    const candidates = [path.join(dir, "trip.json"), path.join(dir, "trip.md")];
    for (const file of candidates) {
      try {
        const raw = fs.readFileSync(file, "utf8");
        const data = (file.endsWith(".json") ? JSON.parse(raw) : matter(raw).data) as {
          figures?: unknown;
        };
        if (namesId(data.figures)) trips.push(tripId);
        break; // a trip has one or the other, never both — first hit wins
      } catch {
        continue; // this shape isn't the one on disk for this trip; try the next
      }
    }
  }

  return { journal, trips };
}

export type DeleteFigureResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "referenced"; referencedBy: FigureReferences };

/**
 * Delete a figure — refusing while it is still named anywhere.
 *
 * **This refusal is the reversible half of a genuine open question.** Neither
 * the frozen contract (`lib/api/v2/schemas/figures.ts`) nor
 * `docs/v2-migration/00-decisions.md` says what should happen to a figure
 * that is still referenced when somebody asks to delete it — cascade (drop
 * the id out of every set that names it) and refuse (make them do that
 * first) are both defensible, and nobody with the authority to decide
 * between them has. Refuse is the safe default: a cascading delete that
 * silently rewrites a trip's own `figures` list is a write to a document the
 * caller did not ask this call to touch, and undoing "which figures walk on
 * my Alps trip changed" is a much worse conversation than asking somebody to
 * remove one id first. If a future owner decides cascade is the right
 * behaviour, this is the one function that changes.
 */
export function deleteFigureDoc(username: string, id: string): DeleteFigureResult {
  if (!figureExists(username, id)) return { ok: false, reason: "not_found" };
  const referencedBy = figureReferences(username, id);
  if (referencedBy.journal || referencedBy.trips.length > 0) {
    return { ok: false, reason: "referenced", referencedBy };
  }
  fs.rmSync(figurePath(username, id), { force: true });
  return { ok: true };
}
