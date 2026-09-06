/**
 * What a trip is keeping track of, and what that obliges a day to carry —
 * B531, and `docs/plans/W40-what-a-day-owes.md` for why.
 *
 * An agent moved a finished trip onto a hosted instance and left the money
 * behind: it had listed the entries through a filter of its own making, not
 * seen `costs:` in its own output, concluded there were none, and written
 * fourteen days without them. Every call answered 200. The mistake was
 * ordinary; what made it expensive is that **nothing in the system
 * disagreed** — a day is accepted with whatever it happens to carry, so an
 * omission and a deliberate blank are the same request.
 *
 * One field already worked the right way and is the model for all of this:
 * a journal declares its `locales`, and a day that does not carry them is
 * refused with the languages named (`checkTranslations`, lib/validate/entry.ts,
 * B294). Nobody has to remember `translations`. Money, coordinates and
 * photographs were remembered by nobody.
 *
 * So: **a trip declares what it keeps, a day satisfies it or declines it in
 * words, and everything is on by default.** The default is the point — an
 * owner who wants a complete journal should not have to find a setting, and
 * an owner who does not want one says so once, on the trip.
 *
 * Pure, like lib/validate/: no fs, no request, no journal. What a day carries
 * arrives as a `DayFacts`, which both an API body and an entry on disk can be
 * reduced to — that is what lets the same contract run at write time and
 * again at publish.
 */

/**
 * The rows. Adding one is adding it here and nowhere else, which is the whole
 * reason this is a registry: the weather feature being built alongside this
 * is the next row, and hard-coding the set is what would make it a five-file
 * change.
 *
 * `coordinates` rather than `location`: a day already has a `location`, and it
 * is the place's name. What this row is about is `lat`/`lng`.
 */
export const TRACKS = ["costs", "coordinates", "photos"] as const;
export type Track = (typeof TRACKS)[number];

/** Every row's answer for one trip. */
export type Tracks = Record<Track, boolean>;

/** Absent means all of them — see the module note. */
export const ALL_TRACKED: Tracks = { costs: true, coordinates: true, photos: true };

/**
 * What a day carries, as the contract needs to see it.
 *
 * Deliberately booleans rather than the values: this module decides whether
 * something was *answered*, never whether the answer is any good. A cost line
 * of the wrong shape is `lib/validate/entry.ts`'s to refuse, and it says so in
 * a completely different voice.
 */
export type DayFacts = {
  costs: boolean;
  coordinates: boolean;
  photos: boolean;
  /** What this day says it deliberately does not have — `without:` in its
   *  frontmatter, which is what `"costs": false` writes. */
  without: readonly Track[];
};

type Row = {
  /**
   * `write` rows are checked when the day is written, `publish` rows when it
   * goes on the site. Photographs are the second kind and cannot be the
   * first: media is a separate call, and the media endpoint refuses a batch
   * that names no day, so at `POST .../days` there is no photograph anybody
   * could have sent yet.
   */
  when: "write" | "publish";
  /** What the trip is keeping, in words, for the refusal. */
  keeps: string;
  /** How to satisfy it — a fragment of the body to send. */
  send: string;
  /** What declining it *means*. Never "skip the check": every one of these is
   *  a statement about the day, which is why it is written to the file. */
  decline: string;
};

export const TRACK_ROWS: Record<Track, Row> = {
  costs: {
    when: "write",
    keeps: "what it costs",
    send: 'costs: [{"label": "Dinner", "amount": 42, "currency": "EUR"}] — each thing separately, in the currency it was paid in',
    decline: '"costs": false — nothing was spent on this day, or nothing worth recording',
  },
  coordinates: {
    when: "write",
    keeps: "where its days happened",
    send: "lat and lng, as numbers — they are what put the day on the map",
    decline: '"coordinates": false — this day has no one place to put on a map',
  },
  photos: {
    when: "publish",
    keeps: "photographs",
    send: `POST .../trips/<trip>/media with day=<slug> and the files — it adds them to the day`,
    decline: '"photos": false — there are no pictures from this day',
  },
};

/**
 * Read a `tracks:` block off a trip's frontmatter.
 *
 * **Fails open, in the direction of asking more rather than less.** Anything
 * this cannot read leaves the default standing, and the default is on. That is
 * the opposite of `parsePeople`'s fail-closed, and right for the same reason
 * that one is: the cost of being wrong here is a question nobody needed to
 * answer, and the cost of being wrong the other way is a journal quietly
 * missing its money again.
 *
 * `false` is the only value that turns a row off. `"no"`, `0` and `null` are
 * not spellings of it — a typo must not silently stop the software asking.
 */
export function parseTracks(raw: unknown): Tracks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...ALL_TRACKED };
  const given = raw as Record<string, unknown>;
  const tracks = { ...ALL_TRACKED };
  for (const key of TRACKS) {
    if (given[key] === false) tracks[key] = false;
  }
  return tracks;
}

/** The `tracks:` lines for a `trip.md`, or none when everything is tracked —
 * a block saying only what the default already says is noise in somebody's
 * file. */
export function tracksLines(tracks: Tracks): string[] {
  const off = TRACKS.filter((key) => !tracks[key]);
  if (off.length === 0) return [];
  return ["tracks:", ...off.map((key) => `  ${key}: false`)];
}

/** `without: [costs]` for an entry, or none. */
export function withoutLine(without: readonly Track[]): string[] {
  const named = TRACKS.filter((key) => without.includes(key));
  return named.length === 0 ? [] : [`without: [${named.join(", ")}]`];
}

/** Read `without:` off an entry's frontmatter, ignoring anything that is not
 * a row — an unknown word there says nothing this code can act on. */
export function parseWithout(raw: unknown): Track[] {
  if (!Array.isArray(raw)) return [];
  return TRACKS.filter((key) => raw.includes(key));
}

export type Missing = {
  field: Track;
  why: string;
  send: string;
  decline: string;
};

/**
 * What this day owes its trip, at this moment in its life.
 *
 * Empty is the answer for a day that carries everything, for a day that
 * declines what it does not carry, and for a trip that tracks nothing — three
 * different situations that are all "nothing to say".
 */
export function missingFrom(
  facts: DayFacts,
  tracks: Tracks,
  when: "write" | "publish",
): Missing[] {
  return TRACKS.filter((key) => tracks[key])
    .filter((key) => (when === "publish" ? true : TRACK_ROWS[key].when === "write"))
    .filter((key) => !facts[key] && !facts.without.includes(key))
    .map((key) => ({
      field: key,
      why: `This trip keeps track of ${TRACK_ROWS[key].keeps}, and this day says nothing about it.`,
      send: TRACK_ROWS[key].send,
      decline: TRACK_ROWS[key].decline,
    }));
}

/**
 * The sentence in front of the list.
 *
 * It has to do two things at once, and the second is the one that is easy to
 * get wrong: say that the day was not written, and say that **declining is a
 * real answer** — not a grudging bypass. An agent that reads this as "supply a
 * value or fail" will invent a value, which is the one outcome worse than the
 * omission this exists to catch.
 */
export function incompleteMessage(missing: Missing[], published: boolean): string {
  const fields = missing.map((m) => `\`${m.field}\``).join(" and ");
  return (
    `Nothing was ${published ? "published" : "written"}. This trip keeps track of ` +
    `${missing.map((m) => TRACK_ROWS[m.field].keeps).join(" and ")}, and this day says ` +
    `nothing about ${missing.length > 1 ? "either" : "it"}. **Ask the person** — that is ` +
    `the answer here, not a value you supply from what seems likely. If you have asked and ` +
    `there is nothing to record, say so in the call: ${missing
      .map((m) => m.decline.split(" — ")[0])
      .join(", ")}. That is written into the day as ${fields} it deliberately does not ` +
    `have, so a reader a year from now can tell it from nobody having asked.`
  );
}
