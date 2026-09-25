// Genuinely standalone — no import of any kind — because this is the one
// piece of the declinables domain a CLIENT component needs
// (`DeclineScreen.tsx`, A5b). `lib/studio/declinables.ts` looked safe for
// that (no "server-only" marker of its own) and was not: its `DAY_DECLINABLES`
// re-export pulls in `lib/api/v2/schemas/shared.ts` → `lib/tripWrite.ts` →
// `lib/users.ts` → `lib/auth/index.ts` → this instance's real database
// drivers (`pg`, `better-sqlite3`), and Turbopack tried to put all of that
// in the browser bundle for the one call site that needed a regex. This
// file is the fix: the exact same function, with nothing above it to drag
// anything else in.
export function cannedReasonsFor(whyRequired: string): string[] {
  const match = whyRequired.match(/\(([^)]+)\)/);
  if (!match) return [];
  const parts = match[1]
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  if (!parts.every((p) => p.includes(" "))) return [];
  return parts;
}
