import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "@/lib/contentRoot";
import { DATE_RE, ID_RE } from "@/lib/tripWrite";

/**
 * B2435 slice 1 — a group trip's roster and duty plan.
 *
 * Stored as `trips/<trip>/roster.json` beside `trip.json`, not inside it: the
 * trip document is the public v2 contract (`PATCH /api/v2/.../trips/...`), and
 * a roster of children's first names must not become a field an agent can
 * read, or one that any trip export or reader view could pick up by accident.
 * Only `/api/web/.../roster` (owner cookie) and the studio page read it. The
 * names are the roster's own list: never the trip's `people`, never a byline,
 * never linked to contacts.
 */
export type Roster = {
  students: { id: string; name: string }[];
  /** ISO date -> student ids on duty. Kept even if the date leaves the trip. */
  duty: Record<string, string[]>;
};

export const MAX_STUDENTS = 60;
const NAME_RE = /^[^\p{Cc}]{1,40}$/u;

const EMPTY: Roster = { students: [], duty: {} };

function file(user: string, trip: string): string | null {
  if (![user, trip].every((s) => s && !/[/\\\0]/.test(s) && s !== "." && s !== "..")) return null;
  return path.join(contentRoot(), user, "trips", trip, "roster.json");
}

/** Validates an untrusted body into a Roster, or says what is wrong. */
export function parseRoster(raw: unknown): { ok: true; roster: Roster } | { ok: false; error: string } {
  const o = raw as { students?: unknown; duty?: unknown } | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.students) || !o.duty || typeof o.duty !== "object" || Array.isArray(o.duty)) {
    return { ok: false, error: "invalid_roster" };
  }
  if (o.students.length > MAX_STUDENTS) return { ok: false, error: "too_many_students" };
  const students: Roster["students"] = [];
  const seenId = new Set<string>();
  const seenName = new Set<string>();
  for (const s of o.students as { id?: unknown; name?: unknown }[]) {
    const name = typeof s?.name === "string" ? s.name.trim() : "";
    if (typeof s?.id !== "string" || !ID_RE.test(s.id) || s.id.length > 16 || seenId.has(s.id) || !NAME_RE.test(name)) {
      return { ok: false, error: "invalid_student" };
    }
    if (seenName.has(name.toLowerCase())) return { ok: false, error: "duplicate_name" };
    seenId.add(s.id);
    seenName.add(name.toLowerCase());
    students.push({ id: s.id, name });
  }
  const duty: Roster["duty"] = {};
  for (const [date, ids] of Object.entries(o.duty as Record<string, unknown>)) {
    if (!DATE_RE.test(date) || !Array.isArray(ids)) return { ok: false, error: "invalid_duty" };
    const unique = [...new Set(ids)];
    if (!unique.every((id) => typeof id === "string" && seenId.has(id))) return { ok: false, error: "invalid_duty" };
    if (unique.length > 0) duty[date] = unique as string[];
  }
  return { ok: true, roster: { students, duty } };
}

export function readRoster(user: string, trip: string): Roster {
  const f = file(user, trip);
  if (!f) return EMPTY;
  try {
    const parsed = parseRoster(JSON.parse(fs.readFileSync(f, "utf8")));
    return parsed.ok ? parsed.roster : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Throws on an unsafe path segment; callers have already resolved the trip. */
export function writeRoster(user: string, trip: string, roster: Roster): void {
  const f = file(user, trip);
  if (!f) throw new Error("unsafe path segment");
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(roster, null, 2) + "\n");
  fs.renameSync(tmp, f);
}
