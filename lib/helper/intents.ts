import "server-only";
import { formatDigestDate } from "../digest/content";
import { translateIn } from "../locales";
import type { Locale } from "../types";

/**
 * The refusal table — B817, and what is left of the registry B900 retired.
 *
 * ## What used to be here
 *
 * One row per thing the helper could do, matched by a model *before* the
 * conversation was reached. It was the right shape when there was no
 * conversation: seven rows and a text box in front of them. It became the
 * wrong shape the moment the thread had tools, because a sentence a row
 * happened to cover never reached one — "zeig mir meine reisen" answered as
 * prose where the `trips` tool answers as a list, and "mach mir einen tag von
 * gestern" handed over a wizard URL where `start_day` proposes a day. Two
 * routers that can disagree is worse than either, so the registry is gone and
 * `lib/helper/tools.ts` is the only one.
 *
 * ## What did not move, and must not
 *
 * The refusals below, and they are the half that never asked a model
 * anything. They are matched **in this file, from the sentence itself, before
 * any model is called at all** — not a low-confidence fallback and not a check
 * on what came back.
 * ---------------------------------------------------------------------- */

/** Translating, passed in rather than imported, so an answer is in the
 *  reader's own language and this file holds no English. */
export type Say = (key: string, vars?: Record<string, string>) => string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One `Say`, bound to a reader's language — and the one place a bare
 * "YYYY-MM-DD" var becomes the date a person actually reads, so no template
 * call site has to remember to convert it itself.
 *
 * B1296: the room used to hand somebody `2026-09-05`, one line above the
 * model writing the same day as "5 September" in its own free prose. A
 * guard here — every ISO-shaped var, formatted before it reaches
 * `translate()` — closes it for every existing and future `{date}`,
 * `{start}` or `{end}` at once, the way AGENTS.md says a code guard does and
 * a reworded prompt never has.
 */
export function sayIn(locale: string): Say {
  return (key, vars) =>
    translateIn(
      locale,
      key as Parameters<typeof translateIn>[1],
      vars &&
        Object.fromEntries(
          Object.entries(vars).map(([name, value]) => [
            name,
            ISO_DATE.test(value) ? formatDigestDate(locale as Locale, value) : value,
          ]),
        ),
    );
}

/* -------------------------------------------------------------------------
 * The territories with no row, and what is said instead — B817 and B783.
 *
 * **This is a safety mechanism before it is a courtesy.** "take down the day
 * with the photo of anna" routed to `write_day` and opened the wizard at step
 * one, pre-set to today, ready to *create* a day. Nothing was wrong with the
 * model: the registry has no row anywhere near removal, so the nearest
 * neighbour won, and the nearest neighbour to "take this down" is the screen
 * that puts things up.
 *
 * So these are matched **in this file, from the sentence itself, before a
 * model is asked anything at all.** Not a low-confidence fallback and not a
 * check on what came back: a deterministic refusal that no confidence can get
 * past, because the failure it prevents is a person publishing a day while
 * trying to remove one.
 *
 * Each refusal is an *answer*: it names what it will not do and says where the
 * thing actually happens. None of them is a route to doing it, and the removal
 * one in particular must never read as though this box could delete something
 * if only it were asked more nicely. It cannot, and it never has been able to.
 *
 * The words are matched in three languages because the box is offered in
 * three. A stem rather than a whole word wherever the language inflects
 * ("lösch" for löschen/lösche/gelöscht, "törl" for törlés/törölni), and no
 * `\b` around the non-ASCII ones.
 * ---------------------------------------------------------------------- */
export type Refusal = {
  /** Reported as the intent, so this is visible in a log and in a test. */
  name: string;
  match: RegExp;
  /** The sentence shown, in the reader's own language. */
  key: string;
};

/**
 * ## What B900 narrowed, and why that is not a softening
 *
 * There used to be three rows and one of them was `publish`, because there was
 * nothing in this software a sentence could safely lead to that put a day on
 * the site. There is now: `publish_day` renders the day as its readers will
 * see it and then one button, and `unpublish_day` puts a day back to being a
 * draft. Both end in a press, and a refusal in front of them would only be
 * telling somebody to go and press the identical button somewhere else.
 *
 * So the words that mean *take it off the site* now reach the conversation,
 * and the words that mean *destroy it* still do not — the split is the point,
 * and it is the same split B816 made when it built a takedown that is not a
 * delete. **There is no delete tool**, so a sentence matched below has
 * nowhere to land at all; that is why these are answers rather than errors.
 *
 * Postcards used to be a third row here, on the same reasoning: there was no
 * tool for them either. There is now — `propose_postcards` in
 * `lib/helper/tools/areas/printed.ts` writes a real, pending order — so a
 * sentence naming one reaches the conversation like any other, and the row
 * that used to intercept it is gone. What stays true, and is the tool's own
 * job to say, is that pressing still happens on the owner's own postcards
 * page and never here.
 *
 * ## The floor B914 put back, and the one case it covers
 *
 * B900's loosening was reviewed by the owner and kept — **with a floor**:
 * publishing may only ever be proposed from a sentence that names a day,
 * never from *"publish everything now"*. That is the one shape where a vague
 * sentence touches the path that puts things on the site, which is the
 * dangerous direction; unpublishing has no equivalent row, because taking
 * everything down is reversible and errs the safe way.
 *
 * **Half of it was already built and is not here.** `proposeWith` in
 * `./tools.ts` refuses to offer any proposal whose `slug` came back empty
 * (B925) — so a publish sentence the model could not resolve to a day already
 * ends in "which day did you mean" and no button. What that cannot catch is
 * the model being *helpful*: asked to publish everything, picking the first
 * unpublished day and resolving it perfectly. B925 waves that through, because
 * nothing about the proposal is empty. Only a check on the sentence itself,
 * before a model reads it, closes that — which is why the row is here and not
 * there.
 *
 * It is deliberately narrow. "Publish all the photographs on the day about the
 * pass" is caught too, and answered by asking which day — a person says it
 * again naming the day and it works. That is a second sentence, not a refusal
 * of something they are entitled to do, and the alternative is a regex trying
 * to decide whether a day was named, which is not a thing a regex knows.
 */
/** Wanting something gone, in the three languages the box is offered in. */
const DESTROY = String.raw`\b(delete|deleting|deleted|erase|erasing|wipe|destroy|get rid of|remove|removing)\b|lösch|vernicht|entfern|törl|töröl|megsemmisít`;

/** The two things this helper can actually take away: a photograph on a day,
 *  and a file still waiting in the inbox. `remove_photo` and `discard_file`. */
const REMOVABLE = String.raw`\b(photo|photos|photograph|photographs|picture|pictures|image|images|file|files|foto|fotos|bild|bilder|datei|dateien|kép|képet|képek|képével|fénykép|fényképet|fényképével|fájl|fájlt)\b`;

/**
 * And the things nothing here can: naming one of these refuses the sentence
 * even when it also names a photograph, because "delete the day with the
 * photo of Anna" is a request to delete a day.
 *
 * **"all"/"everything" is deliberately not in this list** — B1391. It used
 * to be, and "lösche alle Dateien in meiner Inbox" named the removable thing
 * explicitly (`Dateien`) and was refused anyway, purely because `alle` also
 * happened to be a word this list watched for. That branch of the match
 * below only exists to catch a *kept* thing riding alongside a removable
 * one ("the day with the photo of Anna"); it was never needed for bare
 * bulk quantifiers, because the match's other branch already refuses any
 * destruction word with **no** removable thing named at all — which is what
 * still catches "lösche alles" on its own, with nothing else changed here.
 * `day`/`trip`/`journal`/`account`/`entry`/`entries` stay exactly as they
 * were: nothing about this loosens what those words already lock.
 */
const KEPT = String.raw`\b(day|days|trip|trips|journal|account|entry|entries|yesterday)\b|\btage?\b|reise|tagebuch|konto|\bnapot?\b|napló|\bútat?\b|fiók`;

/** The publish-word alternation, pulled out so B1562's preview check can
 *  mirror it exactly rather than typing its own copy beside it. */
const PUBLISH_WORD = String.raw`\bpublish|veröffentlich|publizier|közzé|publikál|\b(put|stell)[\s\S]*\bonline\b`;

const REFUSALS: readonly Refusal[] = [
  {
    /**
     * Destruction, and nothing else.
     *
     * A day, a trip or a journal that somebody wants *gone* is unrecoverable
     * and finishes in a mailbox or on its own page. "Unpublish", "take it
     * down", "nimm das runter" and "vedd le" are deliberately not here any
     * more: they mean the day leaves the site and stays on disk, which is
     * `unpublish_day`, which proposes and waits to be pressed.
     *
     * **A photograph is no longer among them.** This row used to match
     * "remove … photo" on purpose, because nothing could do it and a refusal
     * was the honest answer. `remove_photo` and `discard_file` are that
     * something now, and a refusal firing first would make each unreachable
     * by the only sentence anybody says out loud.
     *
     * The rule is not "let a picture through", and the first attempt at this
     * got it wrong in the way worth recording: *"lösche den Tag mit dem Foto
     * von Anna"* names a picture and asks for a **day**. So the sentence has
     * to carry a destruction word, and then it is refused unless it names
     * something removable *and nothing kept* — the three lists below, in the
     * three languages the box is offered in.
     *
     * That is a pre-filter widening, not a guard removed. Nothing downstream
     * can delete a day or a trip, because no tool exists that could: a
     * sentence slipping past this row reaches a model with no way to do what
     * it asks, which is the ordinary case for every sentence this file
     * answers with null.
     */
    name: "remove",
    match: new RegExp(
      `^(?=[\\s\\S]*(${DESTROY}))(?:(?![\\s\\S]*(${REMOVABLE}))|(?=[\\s\\S]*(${KEPT})))`,
      "i",
    ),
    key: "agent.askRefuseRemove",
  },
  {
    /**
     * Publishing in bulk — B914, and the owner's own floor under B900.
     *
     * Two lookaheads rather than one alternation: the sentence has to carry
     * *both* a publishing word and a word that means all of them, in either
     * order, so "publish the day about the pass" is untouched and "publish
     * everything now" never reaches a model.
     *
     * `\bpublish` and not `publish`, so **"unpublish everything" is not
     * matched** — in "unpublish" there is no word boundary before the p.
     * Taking everything down is the reversible direction and has no row.
     *
     * `put … online` and `stell … online` are in the publishing half because
     * German and English both split that verb, and *"stell alles online"* is
     * the same sentence as *"veröffentliche alles"*. Bare `online` is
     * deliberately not a publishing word: *"are all my days online?"* is a
     * question, and refusing to answer it would be this box going quiet at
     * exactly the moment B783 was about.
     */
    name: "publish_all",
    match: new RegExp(
      `^(?=[\\s\\S]*(${PUBLISH_WORD}))(?=[\\s\\S]*(\\b(all|everything|the lot|the whole (lot|journal|trip))\\b|\\balles?\\b|sämtlich|\\bmindet\\b|\\bmindent\\b|\\bmindegyik\\b|összes))`,
      "i",
    ),
    key: "agent.askRefusePublishAll",
  },
];

/**
 * A sentence that only asks to *see* a day, never to put it on the site —
 * B1562.
 *
 * "vorschau" proposed `publish_day` — a card whose only button publishes —
 * and the owner pressed it, because the card does show the day and looks
 * exactly like consent. The read path already has the right shape
 * (`read_day`'s own `preview` block, no button at all); this is what keeps
 * `publish_day` from being offered instead of it. `\bpreview` alone would
 * also catch "preview and publish", which is why the same publish-word
 * alternation the refusal above uses is checked and required *absent*: a
 * sentence naming both keeps the card, because that is a request to publish,
 * said in a sentence that also happens to use the word "preview".
 */
export function isPreviewOnly(said: string): boolean {
  return /\bpreview(s|ing)?\b|vorschau|előnézet/i.test(said) && !new RegExp(PUBLISH_WORD, "i").test(said);
}

/**
 * The refusal a sentence has earned, or null.
 *
 * Null is the ordinary case and means the sentence goes to the conversation,
 * which is now the only other place it can go. This is the sentence
 * understood well enough to be refused by name — and refused before a model
 * has read a word of it.
 */
export function refusalFor(said: string): Refusal | null {
  return REFUSALS.find((refusal) => refusal.match.test(said)) ?? null;
}
