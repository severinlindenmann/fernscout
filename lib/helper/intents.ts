import "server-only";

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
const REFUSALS: readonly Refusal[] = [
  {
    /**
     * Destruction, and nothing else.
     *
     * A photograph, a day, a trip or a journal that somebody wants *gone* is
     * unrecoverable and finishes in a mailbox or on its own page. "Unpublish",
     * "take it down", "nimm das runter" and "vedd le" are deliberately not
     * here any more: they mean the day leaves the site and stays on disk,
     * which is `unpublish_day`, which proposes and waits to be pressed.
     */
    name: "remove",
    match:
      /\b(delete|deleting|deleted|erase|erasing|wipe|destroy|get rid of)\b|\bremove\b[^.!?]{0,40}\b(photo|photograph|picture|image|file)\b|lösch|vernicht|entfern|törl|töröl|megsemmisít/i,
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
    match:
      /^(?=[\s\S]*(\bpublish|veröffentlich|publizier|közzé|publikál|\b(put|stell)[\s\S]*\bonline\b))(?=[\s\S]*(\b(all|everything|the lot|the whole (lot|journal|trip))\b|\balles?\b|sämtlich|\bmindet\b|\bmindent\b|\bmindegyik\b|összes))/i,
    key: "agent.askRefusePublishAll",
  },
];

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
