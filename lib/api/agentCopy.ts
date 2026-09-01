/**
 * The sentences more than one agent-facing document has to say.
 *
 * There are four doors onto the same API — `/documentation.txt`,
 * `/<user>/documentation.txt`, `/agent.md` and `/openapi.json` — and they are
 * deliberately different documents rather than one. The first two are
 * *indexes*, and the second of them is generated per journal, naming that
 * journal's own trips; the guide is the *manual* and is the same for everyone
 * on the instance; the OpenAPI file is the machine contract. Merging them
 * would mean either handing an agent that asked "whose journal is this" 26 KB
 * of manual, or giving up the per-journal specificity that makes the small
 * documents worth reading. The llms.txt convention they follow is explicitly
 * an index that links to fuller documents.
 *
 * What that split does **not** license is saying the same thing four times in
 * four hand-written copies. AGENTS.md puts it plainly: a reference kept in two
 * files is a reference that disagrees with itself within a month, and this
 * project has already had that happen once, when the visibility vocabulary
 * changed in W27 and only one copy followed.
 *
 * So the *definitions* live here, once, and each document frames them in its
 * own voice and its own shape. This module is deliberately dependency-free —
 * `app/openapi.json/route.ts` imports it without dragging in the whole
 * documentation generator, and `test/agent-interface.test.ts` asserts that
 * every document actually carries them.
 */

/**
 * What a journal's `visibility` decides.
 *
 * Written as one sentence rather than a paragraph so it can be dropped into a
 * numbered list, a prose section and a JSON `description` without any of the
 * three needing to rephrase it.
 */
export const VISIBILITY_MEANING =
  "public is listed on this server's own index, on its landing page and in its sitemap; " +
  "private is on none of them and asks search engines not to index it — anyone sent the " +
  "address can still open it.";

/**
 * The half of it that gets misread, and the reason it must travel with the
 * sentence above wherever that goes: "private journal" sounds like a lock and
 * is not one. A person told otherwise will put something in it they should
 * not.
 */
export const VISIBILITY_NOT_A_LOCK =
  "Neither decides who may read a particular journey: that is the trip's own visibility, " +
  "which has a password, invited guests and the trip's `people:` list behind it — and a " +
  "new trip is private whichever kind of journal it is in.";

// Read from the constant rather than typed into prose: a fourth language would
// otherwise be maintained everywhere except in the sentence that tells an agent
// it exists. The media limits table already works this way.
import { MAINTAINED_LOCALES } from "../i18n";

/** One thing an agent has to ask before its first call. */
export type FirstQuestion = { ask: string; because: string };

/**
 * "Four questions", not "4 questions".
 *
 * The count comes from the list's own length so that adding a question cannot
 * leave the sentence above it lying — but a bare digit in running prose reads
 * like a form field. Only as far as the list could plausibly grow.
 */
const NUMERALS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];
export function numeral(n: number): string {
  return NUMERALS[n] ?? String(n);
}

/**
 * `ask` and `because` as one sentence, for the documents that render the list
 * as prose rather than as a table.
 *
 * The join is a full stop unless `ask` already ends in punctuation — "Public or
 * private?." is the kind of seam that makes a generated document look
 * generated. Trailing markdown emphasis is looked past to find that
 * punctuation: the question mark in `**Public or private?**` is real, and the
 * asterisks after it are not characters a reader sees.
 */
export function asSentence(question: FirstQuestion): string {
  const ask = question.ask.trimEnd();
  const joiner = /[?!.:][*`_]*$/.test(ask) ? "" : ".";
  return `${ask}${joiner} ${question.because}`;
}

/**
 * The questions to put to the person before anything else.
 *
 * Every one of them decides something they live with, and none has a default
 * worth guessing. An agent may arrive at either `/documentation.txt` or
 * `/agent.md` first, so both carry these — but as one list rendered twice, a
 * numbered list in the index and a table in the guide, rather than two lists
 * that will drift.
 *
 * Takes the site URL because the second question is about a URL.
 */
export function firstQuestions(siteUrl: string): FirstQuestion[] {
  return [
    {
      ask: "Their **email address**",
      because:
        "It is the only address that can ever get a token for this journal. Not a " +
        "preference — the credential.",
    },
    {
      ask: "The **journal's address** (`username`), if they have no journal yet",
      because:
        `It becomes ${siteUrl}/<username>, it is permanent, and it is what they will ` +
        "give people.",
    },
    {
      ask: "**Public or private?**",
      because: `Whether this server advertises the journal at all — ${VISIBILITY_MEANING}`,
    },
    {
      ask: "Their **name**, and **what the site should call them**",
      because:
        "Two answers, not one. Never split the first to get the second: it mangles any " +
        "name whose given name is not first.",
    },
    {
      ask: "**Which language** the journal is in",
      because:
        `This instance maintains ${MAINTAINED_LOCALES.join(", ")}. It sets the language of ` +
        "the site's own chrome and of the mail this server sends the owner — including the " +
        "letter that arrives the moment the journal is created, which is the first thing " +
        "the software ever says to them. Send it as `defaultLocale`.",
    },
  ];
}

/**
 * Greedy wrap to a column, for the documents that are assembled as arrays of
 * lines and hand-wrapped at 78.
 *
 * A constant pasted into one of those unwrapped is a 200-character line in a
 * file whose whole point is being read as plain text.
 */
export function wrap(text: string, width = 78, indent = ""): string[] {
  const out: string[] = [];
  let line = indent;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line === indent ? indent + word : `${line} ${word}`;
    if (candidate.length > width && line !== indent) {
      out.push(line);
      line = indent + word;
    } else {
      line = candidate;
    }
  }
  if (line !== indent) out.push(line);
  return out;
}
