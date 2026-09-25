// Server-side only, despite carrying no "server-only" marker of its own:
// `DAY_DECLINABLES` (`lib/api/v2/schemas/day.ts`) pulls in
// `lib/api/v2/schemas/shared.ts` → `lib/tripWrite.ts` → `lib/users.ts` →
// `lib/auth/index.ts` → this instance's real database drivers (`pg`,
// `better-sqlite3`) — a chain nothing here needs at runtime, but one
// Turbopack still has to resolve for any bundle that imports this module.
// `DeclineScreen.tsx` (a client component) needed only the *shape* of that
// reasoning (`cannedReasonsFor`), which is why that one function was split
// out into `lib/studio/declineReasons.ts` instead — no import of any kind,
// safe for a browser bundle. Everything in *this* file is read only from
// the server (`lib/studio/day.ts`, `lib/studio/createDay.ts`,
// `app/[user]/studio/day/new/page.tsx`).
import { DAY_DECLINABLES } from "@/lib/api/v2/schemas/day";
import type { Declinable } from "@/lib/api/v2/schemas/shared";

/**
 * D1 — every declinable field this flow can still leave open, in the order
 * `DAY_DECLINABLES` declares them. See `lib/studio/day.ts`'s own copy of
 * this doc comment (kept identical) for why `status` and `visibility` never
 * appear and why `translations` drops out for a single-locale journal.
 */
export function declinableFieldsFor(locales: readonly string[]): Declinable[] {
  return DAY_DECLINABLES.filter((d) => {
    if (d.field === "status" || d.field === "visibility") return false;
    if (d.field === "translations" && locales.length <= 1) return false;
    return true;
  });
}

/** The one decline this flow writes without asking — visibility. The words
 *  are `DAY_DECLINABLES`' own: "declined means shown to everyone the trip
 *  lets in" — a true statement about the system's default, not an invented
 *  reason. */
export function autoVisibilityDecline(): string {
  return "not narrowed for this day — shown to everyone the trip already lets in, exactly as a declined visibility means";
}
