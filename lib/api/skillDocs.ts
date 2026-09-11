import "server-only";
import { agentGuide, dayFieldNames } from "./documentation";
import { SKILL_DOC_SUMMARY, SKILL_DOC_TITLE, type SkillDocSlug } from "./skillDocMeta";

export type { SkillDocSlug };

/**
 * B311: the guide split by task.
 *
 * `agentGuide()` is one 140+ KB document because it grew procedure by
 * procedure with nowhere to put a boundary. Splitting it by hand — a second,
 * shorter copy of "how to write a day" — is exactly the drift AGENTS.md warns
 * about: a fact kept in two places disagrees with itself within a month, and
 * a fact kept in *nine* places would disagree nine times as fast.
 *
 * So this file does not re-describe anything. It cuts `agentGuide()`'s own
 * rendered text at markers already in it — the same headings, the same
 * worked examples, the same tables generated from `agentCopy.ts` and
 * `openapi.ts` — and files the pieces under the names `.claude/skills/`
 * already uses for these tasks. A skill document and the guide can never say
 * two different things about one field, because the skill document's text
 * *is* the guide's text.
 */

const MARKERS = [
  "## What this is",
  "## The one rule",
  "## Ask these",
  "## Starting from nothing",
  "## If you were handed a key",
  "## First, get your bearings",
  "## Authenticating",
  "## A web helper exists too",
  "## Reading",
  "## Letting other people in",
  "### If invites are switched off for this journal",
  "## Writing",
  "## Drawing the travellers",
  "**Every field a day takes, on one line each.**",
  "Never invent a figure, and never reach for a decline to get past a refusal.",
  "**Every field a day can carry.**",
  "**The slug comes from the title",
  "`GET .../trips/<trip-id>/tracks` says what a trip is asking for",
  "**Photographs are checked when you publish, not when you write**",
  "### Editing a day",
  "### Publishing, when they say so",
  "### Telling people, when they say so too",
  "### The same day, on WhatsApp",
  "### Deleting, and anything that costs money",
  "### Deleting a trip, or the whole journal",
  "### The trip's budget",
  "### The trip's planned route",
  "### What the trip actually cost, from a bank statement",
  "### The trip's exchange rates",
  "### What the trip is called, when it ran, and its cover",
  "### Who may read the trip",
  "### Who was on the trip, and how they are drawn",
  "### When the pictures arrive before the days: the inbox",
  "### Where somebody actually went",
  "### Photographs and video",
  "### Holding one photograph back",
  "### Holding a whole update back",
  "### What is accepted",
  "## A folder of photographs, all at once",
  "## A journal that already exists, moving here",
  "## If you need help extracting pictures or data",
  "## Real postcards, in the post",
  "## Printing a photobook",
  "## Errors",
  "## What good looks like",
] as const;

type Marker = (typeof MARKERS)[number];

/** Every marker's own text, up to the next marker (in document order) or the end. */
function chunksByMarker(guide: string): Record<Marker, string> {
  const positions = MARKERS.map((m) => {
    const i = guide.indexOf(m);
    if (i === -1) throw new Error(`skillDocs: marker not found in agentGuide(): ${m}`);
    return i;
  });
  const out = {} as Record<Marker, string>;
  MARKERS.forEach((m, i) => {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : guide.length;
    out[m] = guide.slice(start, end).trimEnd();
  });
  return out;
}

function doc(title: string, summary: string, parts: (string | undefined)[]): string {
  const body = parts.filter((p): p is string => Boolean(p)).join("\n\n");
  return `# ${title}\n\n> ${summary}\n\n${body}`.trimEnd() + "\n";
}

/** The document itself, generated fresh so it reflects this server and this journal example. */
export function skillDoc(slug: SkillDocSlug): string {
  const c = chunksByMarker(agentGuide());
  const title = SKILL_DOC_TITLE[slug];
  const summary = SKILL_DOC_SUMMARY[slug];
  switch (slug) {
    case "new-account":
      return doc(
        title,
        summary,
        [
          c["## The one rule"],
          c["## Ask these"],
          c["## Starting from nothing"],
          c["## If you were handed a key"],
          c["## First, get your bearings"],
          c["## Authenticating"],
          c["## Reading"],
          c["## If you need help extracting pictures or data"],
        ],
      );
    case "add-journal":
      return doc(title, summary, [
        c["### If invites are switched off for this journal"],
        c["### Deleting a trip, or the whole journal"],
        c["## A journal that already exists, moving here"],
      ]);
    case "add-a-trip":
      return doc(title, summary, [
        c["## Writing"],
        // "Drawing the travellers" runs to just before the day-fields table —
        // the next marker in document order — so this is trip content only.
        c["## Drawing the travellers"],
        c["### What the trip is called, when it ran, and its cover"],
        c["### Who may read the trip"],
        c["### Who was on the trip, and how they are drawn"],
        c["### The trip's planned route"],
        c["### Deleting a trip, or the whole journal"],
      ]);
    case "add-a-day":
      return doc(title, summary, [
        // Neither the compact table nor the longer hand-written one below it
        // (`**Every field a day takes**` / `**Every field a day can carry**`
        // in the guide) — both are `/openapi.json`'s job, and inlining
        // either is most of why this document used to be unreadable in one
        // sitting. Only `title`, `date` and `content` are required.
        "**Every field a day can carry:** " +
          dayFieldNames() +
          ". An omitted field is better than an invented one. What each does — " +
          "what `travelScene` plays, what `weather: true` looks up — is at " +
          "`/openapi.json` under `components.schemas.Draft`, the same schema this list is.",
        c["Never invent a figure, and never reach for a decline to get past a refusal."],
        c["**The slug comes from the title"],
        c["**Photographs are checked when you publish, not when you write**"],
        // Correcting and publishing are their own steps, not this one — kept
        // to a pointer rather than the full sections, or this document does
        // not fit under 10KB. `PATCH` and `/publish` are named in full in
        // `/openapi.json` and in the response above.
        "Once it reads back right: `PATCH .../days/<slug>` corrects it, and " +
          "`POST .../days/<slug>/publish` — owner only, once they say yes — " +
          "puts it on the site.",
      ]);
    case "ingest-photos":
      return doc(title, summary, [
        c["### When the pictures arrive before the days: the inbox"],
        c["### Where somebody actually went"],
        c["### Photographs and video"],
        c["### Holding one photograph back"],
        c["### Holding a whole update back"],
        c["### What is accepted"],
        c["## A folder of photographs, all at once"],
      ]);
    case "invite-someone":
      return doc(title, summary, [c["## Letting other people in"]]);
    case "costs":
      return doc(title, summary, [
        c["### The trip's budget"],
        c["### What the trip actually cost, from a bank statement"],
        c["### The trip's exchange rates"],
      ]);
    case "send-postcards":
      return doc(title, summary, [c["## Real postcards, in the post"]]);
    case "make-a-photobook":
      return doc(title, summary, [c["## Printing a photobook"]]);
  }
}
