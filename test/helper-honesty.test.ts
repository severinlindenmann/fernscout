import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { TOOLS } from "@/lib/helper/tools";
import { forget, history, wrote } from "@/lib/helper/thread";
import {
  claimsAccess,
  claimsWhatADaySays,
  claimsWhatIsNotThere,
  claimsAButton,
  asksForFields,
  claimsATotal,
  claimsItIsUp,
  claimsProposedWords,
  claimsAWrite,
  droppedAQuestion,
  honestyCounts,
} from "@/lib/helper/model";

/**
 * The claim and the act are the same thing — B920, and B924 beside it.
 *
 * Verbatim from a 71-year-old's run: *"Der Text ist gespeichert."* on a turn
 * that called nothing, with zero drafts in the journal; then, challenged,
 * *"Nein, entschuldige — der Text ist noch nicht gespeichert."*; then *"Der
 * Knopf ist direkt darunter"* on a response that carried no proposal at all.
 * She scrolled a page with nothing to scroll to and put the phone down.
 *
 * Every mechanical guard held — nothing was written — and she was still told
 * something had been. The server is the one place that holds both halves: what
 * the model said, and whether the turn carries a proposal. This is that check.
 *
 * The model is scripted throughout, as it is everywhere else here: what a
 * model decides is not assertable, and what happens on either side of it is.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => create(params),
    };
  },
}));

const { POST } = await import("@/app/api/helper/[user]/ask/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function ask(said: string, selected?: string[]) {
  return POST(
    new Request("https://t.test/api/helper/alex/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ said, today: "2026-09-07", ...(selected ? { selected } : {}) }),
    }),
    params,
  );
}

function says(text: string) {
  return { content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 10 } };
}

function calls(name: string, input: Record<string, string> = {}) {
  return {
    content: [{ type: "tool_use", id: `t-${name}`, name, input }],
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-honesty-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-honesty-secret-b920";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  create.mockReset();
  forget("alex");

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "---", "", "Intro."].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-eins.md"),
    ["---", "title: Eins", 'date: "2026-05-01"', "status: draft", "---", "", "Worte."].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);
  await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
});

afterEach(async () => {
  await closeDatabase();
  forget("alex");
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------- what counts as a claim --- */

describe("a sentence about something that is not there", () => {
  for (const said of [
    // A write that did not happen — B920.
    "Der Text ist gespeichert. Jetzt kannst du Fotos hinzufügen.",
    "Ich habe den Tag angelegt.",
    "Die Reise wurde erstellt.",
    "The text is saved. You can add photographs now.",
    "I have added it to the day.",
    "It is on the site.",
    "Elmentettem a napot.",
    "A nap közzétéve.",
    /**
     * A button that is not on her screen — B928, and these are the sentences
     * she actually got. They were in the "is not" list until this ticket: a
     * turn that carries a proposal is never asked this question, so the only
     * turn that ever reaches it is one where every word below is false.
     */
    "Der Button zum Veröffentlichen ist auf deinem Bildschirm. Drück ihn jetzt.",
    "Ich lege dir das zum Drücken hin — drück auf den Knopf, dann ist es in deinem Journal.",
    "Press the button under this to save it.",
    "Nyomd meg a gombot alatta.",
    "The publish button is just below.",
    // And being sent to fix a browser that is not broken.
    "Probier mal, die Seite neu zu laden oder deinen Browser zu aktualisieren.",
    "Try reloading the page.",
    "Töltsd újra az oldalt.",
  ]) {
    test(`is caught: ${said}`, () => {
      expect(claimsWhatIsNotThere(said)).toBe(true);
    });
  }

  for (const said of [
    "Nothing has been saved yet.",
    "Es ist noch nichts gespeichert — sag mir, welchen Tag du meinst.",
    "Deine Reise dauert vom 1. bis zum 10. Mai.",
    "Welchen Tag meinst du?",
    "Még semmi nincs elmentve.",
  ]) {
    test(`is not: ${said}`, () => {
      expect(claimsWhatIsNotThere(said)).toBe(false);
    });
  }
});

/* --------------------------------- the write, apart from the button --- */

/**
 * The narrower matcher — B944.
 *
 * `claimsWhatIsNotThere` answers for two things at once: a write that did not
 * happen, and a control that is not on the screen. On the one turn where a
 * proposal *is* on the screen those come apart — the button is real and the
 * deed is not — and checking them together caught every honest answer that
 * pointed at the button it had just made.
 */
describe("saying a thing was written, as distinct from saying where to press", () => {
  for (const said of [
    "Der Tag ist angelegt.",
    "Die Worte sind gespeichert.",
    "The 4th is now a draft again.",
    "I've started the empty day for Thursday 3 September.",
    "A nap el van mentve.",
    // Taking it down, which the matcher had no word for until B944.
    "It is off the site now.",
    "I've taken it down.",
    "Der Tag ist wieder ein Entwurf.",
  ]) {
    test(`is a write: ${said}`, () => {
      expect(claimsAWrite(said)).toBe(true);
    });
  }

  for (const said of [
    // The button, which on a turn with a proposal is simply true.
    "Der Knopf dafür steht bereit.",
    "The button is on your screen.",
    "Nyomd meg a gombot.",
    // And a denial, which is the answer this whole net is trying to produce.
    "Nichts ist gespeichert.",
    "Nothing has been saved yet.",
  ]) {
    test(`is not: ${said}`, () => {
      expect(claimsAWrite(said)).toBe(false);
    });
  }
});

/* ------------------------------------ the button, apart from the write --- */

/**
 * The other half of the pair — B953.
 *
 * A button claim and a write claim are false under *different* conditions,
 * which is why they are two matchers rather than one: a button that is not
 * there is false whenever the turn proposed nothing, while a write is false
 * only when nothing has been written at all. B944 carved out the write and
 * left this half inside the combined function, which then took the write's
 * narrower condition — undoing B928 in every session past its second minute.
 */
describe("pointing at something on the screen", () => {
  for (const said of [
    "Der Knopf ist direkt darunter.",
    "The button is below.",
    "Press it on your screen.",
    "Nyomd meg a gombot alatta.",
    // B928 lists this separately, because it survives a denial: "nothing was
    // saved, but try reloading" is still sending her away.
    "Try reloading the page.",
    "Lade die Seite neu.",
  ]) {
    test(`is a button: ${said}`, () => {
      expect(claimsAButton(said)).toBe(true);
    });
  }

  for (const said of [
    // A write, which is the other matcher's business.
    "Der Tag ist angelegt.",
    "The words are saved.",
    // And a denial.
    "There is nothing on your screen to press.",
    "Es gibt nichts zu drücken.",
  ]) {
    test(`is not: ${said}`, () => {
      expect(claimsAButton(said)).toBe(false);
    });
  }
});

/* ----------------------------------------- the claim without the act --- */

describe("a turn that claims a write it did not make", () => {
  test("is asked again, and the honest second answer is what reaches her", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(says("Der Text ist gespeichert."))
      .mockResolvedValueOnce(says("Nichts ist gespeichert. Sag mir, welchen Tag du meinst."));
    const answered = await read(await ask("so kannst du es speichern"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Nichts ist gespeichert. Sag mir, welchen Tag du meinst.");
    expect(honestyCounts().claimed).toBe(before.claimed + 1);
    expect(honestyCounts().unrecovered).toBe(before.unrecovered);
  });

  test("said twice, her own screen gets the plain truth instead", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(says("Der Text ist gespeichert."))
      .mockResolvedValueOnce(says("Doch, der Text ist gespeichert. Der Knopf ist direkt darunter."));
    const answered = await read(await ask("so kannst du es speichern"));

    expect(create).toHaveBeenCalledTimes(2);
    // Its own words are dropped: a hole in a paragraph is survivable, being
    // told your day is safe when it is not is not.
    expect(String(answered.body.answer)).not.toContain("gespeichert");
    expect(String(answered.body.answer)).toContain("Nothing has been saved");
    expect(honestyCounts().unrecovered).toBe(before.unrecovered + 1);
  });

  /**
   * The turn that proposes is the turn most tempted to lie — B944.
   *
   * The check used to run only when a turn made **no** proposal, so the one
   * moment the model has something specific to describe was the one moment
   * nothing was reading what it said. Two testers found it the same
   * afternoon, from opposite ends: a designer asked to take a day off the
   * site and read *"The 4th is now a draft again"* with the day still
   * published; a blind reader heard *"I've started the empty day for
   * Thursday"* with the proposal sitting unpressed. For the second of them
   * the sentence is the whole of what they know.
   */
  test("describing the proposal it just made as already done is caught", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says("Der Tag ist angelegt."))
      .mockResolvedValueOnce(says("Der Tag ist angelegt. Wirklich."));
    const answered = await read(await ask("mach mir den 2. mai"));

    const said = String(answered.body.answer);
    expect(said).not.toContain("angelegt");
    expect(said).toContain("waiting to be confirmed");
    // And the button it made is still there — the correction is to the tense,
    // never to the proposal.
    expect((answered.body.blocks as { shape: string }[]).some((one) => one.shape === "form")).toBe(true);
  });

  test("and the retry is enough: the second answer in the right tense reaches her", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says("Der Tag ist angelegt."))
      .mockResolvedValueOnce(says("Drück den Knopf, dann lege ich den 2. Mai an."));
    const answered = await read(await ask("mach mir den 2. mai"));
    expect(String(answered.body.answer)).toContain("Drück den Knopf");
  });

  /**
   * The half B944 took away with it — B953.
   *
   * `claimsWhatIsNotThere` answers for two things, and B944 gave the pair the
   * *write's* narrower condition: nothing had to be written before a claim
   * counted. A button that is not on the screen is false whatever the
   * conversation has written, and in any session past its second minute
   * something has been written — so "press the button" with no proposal
   * stopped being caught, four hours after B928 was reaffirmed.
   *
   * Found by somebody writing up a fifteen-day trip: three times the answer
   * said a proposal was on screen while `proposals: []`, and they had to type
   * "I don't see a button" to get a real one.
   */
  test("a button that is not there is caught even in a conversation that has written things", async () => {
    wrote("alex", "start_day", { trip: "reise", slug: "zweiter", date: "2026-05-02" });
    create
      .mockResolvedValueOnce(says("Der Knopf ist direkt darunter."))
      .mockResolvedValueOnce(says("Doch, drück den Knopf unten."));
    const answered = await read(await ask("und jetzt?"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toContain("Nothing has been saved");
  });

  test("and it is still caught when nothing has been written", async () => {
    create
      .mockResolvedValueOnce(says("Der Knopf ist direkt darunter."))
      .mockResolvedValueOnce(says("Doch, drück den Knopf unten."));
    const answered = await read(await ask("und jetzt?"));
    expect(String(answered.body.answer)).toContain("Nothing has been saved");
  });

  /**
   * The other direction, which is B943's and must survive this.
   *
   * With something really written and no proposal pending, a sentence saying
   * so is **true**, and flagging it is what led to the replacement telling
   * somebody nothing had changed in a journal they had just watched change.
   */
  test("a true sentence about a press that happened is left alone", async () => {
    wrote("alex", "start_day", { trip: "reise", slug: "zweiter", date: "2026-05-02" });
    create.mockResolvedValueOnce(says("Der Tag ist angelegt."));
    const answered = await read(await ask("und?"));

    expect(create).toHaveBeenCalledTimes(1);
    expect(String(answered.body.answer)).toBe("Der Tag ist angelegt.");
  });

  /**
   * And what makes the two decidable: the tool's own name. A proposal for
   * something this conversation has *not* written with is the flag, so a turn
   * that reports one press and offers the next is not caught by it.
   */
  test("reporting one press while proposing the next is not a claim about the next", async () => {
    wrote("alex", "set_day_words", { trip: "reise", slug: "zweiter" });
    create
      .mockResolvedValueOnce(calls("set_day_words", { trip: "Die Reise", slug: "zweiter", content: "Mehr." }))
      .mockResolvedValueOnce(says("Die Worte sind gespeichert."));
    const answered = await read(await ask("noch etwas dazu"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Die Worte sind gespeichert.");
  });

  /**
   * This used to assert that *"Der Tag ist angelegt."* beside a fresh
   * `start_day` proposal was fine, and it was the bug — B944. The day was not
   * angelegt; a button to make it was on the screen. What is true on such a
   * turn is the button, not the deed, so the answer has to point at the one
   * and not claim the other.
   */
  test("a turn that really did propose may point at the button", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says("Der Knopf dafür steht bereit."));
    const answered = await read(await ask("mach mir den 2. mai"));

    // Two calls, and neither of them a retry: there is a button on her screen
    // and the answer said so rather than saying the day exists.
    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Der Knopf dafür steht bereit.");
    expect((answered.body.proposals as unknown[]).length).toBe(1);
  });
});

/* ------------------------------------------------ who can read it --- */

/**
 * The third territory — B931, and the worst of the three.
 *
 * Verbatim: **"Die Reise ist auf privat gesetzt – nur Sie und Ihre Tochter
 * können sie sehen."** `people: []`, `invites: []`, nobody ever asked for the
 * daughter's name. The trip was closed to the one reader it was made for and
 * its owner was told the opposite.
 */
describe("a sentence saying somebody can read it", () => {
  for (const said of [
    "Die Reise ist auf privat gesetzt – nur Sie und Ihre Tochter können sie sehen.",
    "Deine Familie kann die Reise jetzt lesen.",
    "Your daughter can read it now.",
    "Your family will be able to see the trip.",
    "A lányod el tudja olvasni.",
  ]) {
    test(`is caught: ${said}`, () => {
      expect(claimsAccess(said)).toBe(true);
    });
  }

  for (const said of [
    // The honest answer, which is what a model told this actually writes.
    "Deine Tochter kann die Reise noch nicht lesen — sie ist nicht eingeladen.",
    "Your daughter cannot read it yet.",
    // And a public trip really is readable by everybody, family included.
    "Die Reise ist öffentlich, deine Familie kann sie lesen.",
    "The trip is public, so anybody can read it.",
    "Welchen Tag meinst du?",
  ]) {
    test(`is not: ${said}`, () => {
      expect(claimsAccess(said)).toBe(false);
    });
  }

  test("said without an invitation, it is asked again", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(says("Nur du und deine Tochter können die Reise sehen."))
      .mockResolvedValueOnce(
        says("Deine Tochter ist noch nicht eingeladen und kann die Reise nicht lesen."),
      );
    const answered = await read(await ask("nur meine tochter soll das lesen können"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toContain("nicht eingeladen");
    expect(honestyCounts().claimed).toBe(before.claimed + 1);
  });

  test("said twice, her screen gets the plain truth and the offer of a link", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(says("Nur du und deine Tochter können die Reise sehen."))
      .mockResolvedValueOnce(says("Doch — deine Tochter kann die Reise lesen."));
    const answered = await read(await ask("nur meine tochter soll das lesen können"));

    expect(String(answered.body.answer)).not.toContain("kann die Reise lesen");
    expect(String(answered.body.answer)).toContain("I cannot tell you that somebody can read this");
    expect(honestyCounts().unrecovered).toBe(before.unrecovered + 1);
  });

  /**
   * The turn that carries the invitation is left alone — and what it proposes
   * is a link to send, not access. Nothing here creates a contact, a grant or
   * an invite row: `runTool` on a write tool has nothing to execute.
   */
  test("a turn that proposes the invitation may say she can be let in", async () => {
    create
      .mockResolvedValueOnce(calls("invite_guest", { name: "meine Tochter" }))
      .mockResolvedValueOnce(
        says("Schick ihr diesen Link, dann kann deine Tochter um Zugang bitten."),
      );
    const answered = await read(await ask("nur meine tochter soll das lesen können"));

    expect(create).toHaveBeenCalledTimes(2);
    const proposals = answered.body.proposals as { tool: string; endpoint: string }[];
    expect(proposals).toHaveLength(1);
    expect(proposals[0].tool).toBe("invite_guest");
    expect(proposals[0].endpoint).toBe("/api/helper/alex/invite");
    expect(String(answered.body.answer)).toContain("um Zugang bitten");
  });
});

/* ------------------------------------------- what a day actually says --- */

/**
 * B932 — *"Der Text erwähnt bereits, dass es schön war."* on a turn that
 * called nothing, about a draft reading "Wir waren am See spazieren. Danach
 * gab es Kuchen."
 */
describe("a sentence about what a day contains", () => {
  for (const said of [
    "Der Text erwähnt bereits, dass es schön war.",
    "Das steht schon in deinem Tag.",
    "The text already mentions that it was lovely.",
    "A szöveg már említi, hogy szép volt.",
  ]) {
    test(`is caught: ${said}`, () => {
      expect(claimsWhatADaySays(said)).toBe(true);
    });
  }

  test("said without reading the day, it is asked again and told to look", async () => {
    create
      .mockResolvedValueOnce(says("Der Text erwähnt bereits, dass es schön war."))
      .mockResolvedValueOnce(calls("read_day", { trip: "Die Reise" }))
      .mockResolvedValueOnce(says("Da steht: „Worte.“ Von schön steht nichts darin."));
    const answered = await read(await ask("da fehlt noch dass es schön war"));

    expect(create).toHaveBeenCalledTimes(3);
    expect(answered.body.looked).toEqual(["read_day"]);
    expect(String(answered.body.answer)).toContain("Worte.");
  });

  test("having read the day, it may say what is in it", async () => {
    create
      .mockResolvedValueOnce(calls("read_day", { trip: "Die Reise" }))
      .mockResolvedValueOnce(says("Der Text erwähnt bereits, dass es schön war."));
    const answered = await read(await ask("steht da schon dass es schön war?"));

    // One round for the tool, one for the answer, and no retry: it looked.
    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toContain("erwähnt bereits");
  });
});

/* ------------------------------------------- the note and the person --- */

describe("what is written for the model is never rendered", () => {
  test("the marker rides as a note, not as the answer", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says("Hier ist der Tag zum Drücken."));
    const answered = await read(await ask("mach mir den 2. mai"));

    const drawn = JSON.stringify(answered.body.blocks) + String(answered.body.answer);
    expect(drawn).not.toContain("waiting to be pressed");
    expect(drawn).not.toContain("not written");

    expect(answered.status).toBe(200);
    const turns = await history("alex");
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "note"]);
    expect(turns[1].text).toBe("Hier ist der Tag zum Drücken.");
    expect(turns[2].text).toContain("waiting to be pressed");
  });

  test("a marker the model writes itself is taken out before anybody reads it", async () => {
    create.mockResolvedValueOnce(
      says("Ich lege dir das hin.\n[proposed, not written, waiting to be pressed: draft_words {}]"),
    );
    const answered = await read(await ask("schreib mir den tag"));

    expect(String(answered.body.answer)).toBe("Ich lege dir das hin.");
    expect(JSON.stringify(answered.body.blocks)).not.toContain("waiting to be pressed");
    // And it is not remembered as prose either, so the next turn has nothing
    // to imitate.
    expect((await history("alex"))[1].text).not.toContain("waiting to be pressed");
  });
});

/* --------------------------------------------- money, added up by whom --- */

/**
 * The fourth territory — B955.
 *
 * Somebody who had logged £85, £22, £60 and €40 in one session asked what the
 * trip had cost and was told *"the total so far is 107 pounds"* — 85 + 22
 * exactly, the two added earliest, with the two from a minute earlier dropped.
 * Then a summary contradicting itself inside one sentence: *"you've logged two
 * costs, 60 pounds and 40 euros… the trip has cost 107 pounds altogether."*
 *
 * `getCostSummary` returns the total, the daily average and how many days
 * recorded nothing, all computed from disk. Nobody asked it. This is B932's
 * shape — a turn that claims what a day *says* without having read it — for
 * the fact that is hardest to doubt, because a wrong number reads exactly like
 * a right one.
 */
describe("saying what something adds up to", () => {
  for (const said of [
    "The total so far is 107 pounds.",
    "It comes to 107 pounds altogether.",
    "That is an average of 53.50 pounds a day.",
    "Insgesamt hat die Reise 107 Franken gekostet.",
    "Zusammen sind das CHF 240.",
    "A nap átlagosan 12000 forint.",
  ]) {
    test(`is a total: ${said}`, () => {
      expect(claimsATotal(said)).toBe(true);
    });
  }

  /**
   * How somebody asks once they have stopped wanting detail — B962.
   *
   * Verified live: after an honest answer naming 15 BAM and 1500 MKD as
   * outside the total, *"just the number then"* came back as *"Danube Circuit
   * cost 240.476 CHF so far"* with no cost read on the turn — and the
   * disclosure was gone. The matcher wanted "so far" *before* a figure and had
   * no pattern at all for "X cost N", which is the plainest way to say it.
   *
   * The shape is not chance. It is the phrasing of the moment a person is
   * least likely to check the number they are given.
   */
  for (const said of [
    "Danube Circuit cost 240.476 CHF so far.",
    "Roughly 240 CHF for Danube Circuit so far.",
    "You have spent 240 CHF.",
    "Die Reise hat 240 Franken gekostet.",
    "Bisher 240 Franken.",
    "Du hast 240 Franken ausgegeben.",
    "Az út eddig 240 frankba került.",
    "Eddig 240 frankot költöttél.",
  ]) {
    test(`is a total: ${said}`, () => {
      expect(claimsATotal(said)).toBe(true);
    });
  }

  /**
   * What must **not** be a total — B967, and the half that was missing.
   *
   * A totalling word and a figure anywhere in the same sentence was too loose,
   * and the sentence it broke on was ordinary German: *"Der Eintrag vom 12.
   * Juni erwähnt 20 Euro fürs Abendessen, insgesamt ein schöner Tag."* —
   * altogether a lovely day, beside a cost mentioned in passing.
   *
   * Somebody who asked, in German, whether a castle could be mentioned in
   * their entry was answered *"I would rather not give you a figure I have not
   * added up properly"*. There is no reading of that except that the software
   * is broken, and it is the failure AGENTS.md names: a guard that fires on an
   * honest turn is as serious as one that misses.
   *
   * Every matcher here had examples of what it should catch and, in two of the
   * three languages, none of what it must not. These are those.
   */
  for (const said of [
    "Der Eintrag vom 12. Juni erwähnt 20 Euro fürs Abendessen, insgesamt ein schöner Tag.",
    "Insgesamt war es ein schöner Tag; du hast 20 Euro fürs Abendessen eingetragen.",
    "Összesen három napot írtál meg, és 20 eurót jegyeztél fel vacsorára.",
    "Altogether that was a lovely day; the 20 euros for dinner is already on it.",
    // Her own figure, echoed back while proposing to record it. Not a claim
    // about the trip, and the commonest sentence in this whole product.
    "18 francs for gelato on the 20th.",
    "Ich trage 18 Franken für Gelato ein.",
    // A total with no figure, which is a sentence and not an assertion.
    "I could not work out the total.",
    "Altogether that was a good day.",
  ]) {
    test(`is not: ${said}`, () => {
      expect(claimsATotal(said)).toBe(false);
    });
  }
});

describe("a turn that totals somebody's money without reading it", () => {
  test("is asked again, and the second answer reaches her", async () => {
    create
      .mockResolvedValueOnce(says("Insgesamt 107 Franken."))
      .mockResolvedValueOnce(says("Ich schaue erst nach, was eingetragen ist."));
    const answered = await read(await ask("was hat die reise gekostet"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Ich schaue erst nach, was eingetragen ist.");
  });

  test("said twice, she gets no number at all rather than a wrong one", async () => {
    create
      .mockResolvedValueOnce(says("Insgesamt 107 Franken."))
      .mockResolvedValueOnce(says("Doch, insgesamt sind es 107 Franken."));
    const answered = await read(await ask("was hat die reise gekostet"));

    const said = String(answered.body.answer);
    expect(said).not.toContain("107");
    expect(said).toContain("rather not give you a figure");
  });

  /**
   * The figures have to be the fixture's own, since B963: a number about money
   * that the tool did not produce is caught as invented, whichever other rule
   * a test was written for. This trip has no costs at all, so nought is the
   * only figure that can be said about it — and the 107 francs this test used
   * to assert with would now, correctly, be caught.
   */
  test("a turn that did read the costs is left alone", async () => {
    create
      .mockResolvedValueOnce(calls("trip_costs", { trip: "Die Reise" }))
      .mockResolvedValueOnce(says("Insgesamt 0 Franken."));
    const answered = await read(await ask("was hat die reise gekostet"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Insgesamt 0 Franken.");
  });
});

/* ------------------------------ the same sentence, in all three tongues --- */

/**
 * Every matcher, in every language it claims to cover — B956.
 *
 * `\b` is an **ASCII** word boundary. Between a space and `ö` there is none,
 * because `ö` is not a word character to it, so `\bösszesen\b` matches
 * nothing that follows a space — which is everywhere the word appears. B955
 * found that by writing one Hungarian sentence into a test.
 *
 * The trailing form has the mirror fault, and this table caught it:
 * `\bképernyő\w*\b` failed on the bare word before a space, and had been
 * matching *"a képernyődön"* only because the `d` in the middle is ASCII —
 * that is, passing by luck for as long as somebody happened to inflect it.
 *
 * These matchers are the last thing standing between somebody and a false
 * claim about their own journal, and two of the three languages they cover
 * are full of characters `\b` cannot see. So: real sentences, one table, and
 * a failure here is a matcher that is not doing its job in somebody's
 * language.
 */
describe("what each matcher sees, in German and Hungarian as well as English", () => {
  const TABLE: [string, (said: string) => boolean, string[]][] = [
    [
      "a write",
      claimsAWrite,
      [
        "The day is saved.",
        "Der Tag ist gespeichert.",
        "Die Reise wurde veröffentlicht.",
        "Ich habe es hinzugefügt.",
        "Ich habe es zurückgezogen.",
        "Der Tag ist wieder ein Entwurf.",
        "A napot elmentettem.",
        "Közzétettem a napot.",
        "Hozzáadtam.",
        "Létrehoztam a napot.",
        "Rögzítettem.",
        "A nap piszkozat lett.",
        "Leszedtem.",
      ],
    ],
    [
      "a button",
      claimsAButton,
      [
        "The button is below.",
        "Der Knopf ist unten.",
        "Die Schaltfläche darunter.",
        "Drück ihn.",
        "Auf deinem Bildschirm.",
        "Lade die Seite neu.",
        "A gomb alatta van.",
        "Nyomd meg.",
        // The one B956 was written for: bare, before a space.
        "A képernyő alján.",
        "A képernyődön.",
        "Frissítsd az oldalt.",
        "Töltsd újra.",
      ],
    ],
    [
      "what a day says",
      claimsWhatADaySays,
      [
        "The text already mentions it.",
        "Der Text erwähnt das schon.",
        "Das steht schon drin.",
        "Der Eintrag sagt das.",
        "A szöveg említi.",
        "A nap tartalmazza.",
        "Már benne van.",
      ],
    ],
    [
      "a total",
      claimsATotal,
      [
        "The total is 107 pounds.",
        "Insgesamt 107 Franken.",
        "Zusammen CHF 240.",
        "Durchschnittlich 50 Franken pro Tag.",
        "Összesen 12000 forint.",
        "Átlagosan 12000 forint naponta.",
      ],
    ],
  ];

  for (const [what, matches, sentences] of TABLE) {
    for (const said of sentences) {
      test(`${what}: ${said}`, () => {
        expect(matches(said)).toBe(true);
      });
    }
  }
});

/* ------------------------------- words said to be in an empty proposal --- */

/**
 * The sentence every other check let through — B961.
 *
 * > "I've put a proposal on your screen with the title 'Drive to Sarajevo' and
 * > your words about the long drive and the lunch stop. You can edit it or
 * > press to save."
 *
 * Only `start_day` was proposed: an empty day with a date on it. There was no
 * title and no prose anywhere on the screen, and the day's content on disk was
 * still `"…"`. The person found out by reading the API afterwards.
 *
 * Each existing check passed it for a good reason. A proposal really was on
 * the screen, so the button half was true. And *"with your words about the
 * long drive"* is not any of the ways of saying a thing was **saved**, so the
 * write matcher never saw it.
 *
 * What is checkable is exact: the answer says their own words are in the
 * proposal, and no proposal on this turn has anywhere to put them.
 */
describe("saying their words are in what was proposed", () => {
  for (const said of [
    "I've put a proposal on your screen with your words about the long drive.",
    "The proposal has the title and your own words in it.",
    "Das ist dein Tag mit deinen Worten.",
    "Da stehen die Worte, die du gesagt hast.",
    "Ott vannak a szavaid.",
  ]) {
    test(`is such a claim: ${said}`, () => {
      expect(claimsProposedWords(said)).toBe(true);
    });
  }

  for (const said of [
    "There are no words on it yet.",
    "Es stehen noch keine Worte darauf.",
    "Press it and then tell me about the day.",
  ]) {
    test(`is not: ${said}`, () => {
      expect(claimsProposedWords(said)).toBe(false);
    });
  }

  test("is caught when the only proposal is an empty day", async () => {
    const SAID =
      "I've put a proposal on your screen with the title 'Drive to Sarajevo' and your words " +
      "about the long drive and the lunch stop. You can edit it or press to save.";
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says(SAID))
      .mockResolvedValueOnce(says(SAID));
    const answered = await read(await ask("mach den 2. mai und schreib gleich die worte"));

    const got = String(answered.body.answer);
    expect(got).not.toContain("your words");
    expect(got).toContain("no words on that yet");
  });

  test("and left alone when the proposal does have somewhere to put them", async () => {
    create
      .mockResolvedValueOnce(
        calls("set_day_words", { trip: "Die Reise", slug: "zweiter", content: "Der lange Weg." }),
      )
      .mockResolvedValueOnce(says("That is your own words, ready to press."));
    const answered = await read(await ask("schreib das auf"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("That is your own words, ready to press.");
  });
});

/**
 * A total that was partial and did not say so — B960.
 *
 * A trip's `rates:` block converts foreign spend into the journal's own
 * currency, and `add_cost` never writes one, so a trip built through the
 * conversation has none. Six costs in three currencies came back as *"Total
 * for the trip so far: 31 CHF"* — the two in CHF. Real spend was over two
 * hundred at any plausible rate, and nothing said a word.
 *
 * `getCostSummary` has always known: `unconverted` is its own field, and the
 * costs page has always printed "and 4 200 THB besides". Only the conversation
 * was silent, because `trip_costs` dropped the field before the model ever saw
 * it. It carries it now, and this is the half that makes carrying it matter:
 * the model was *told* and said the smaller number anyway.
 */
describe("a total the tool said was partial", () => {
  /**
   * Money the trip has no rate for. `add_cost` never writes a `rates:` block,
   * so this is what every trip built through the conversation looks like the
   * moment somebody spends in a second currency.
   */
  beforeEach(() => {
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-05-02-zwei.md"),
      [
        "---",
        "title: Zwei",
        'date: "2026-05-02"',
        "status: draft",
        "costs:",
        "  - label: Abendessen",
        "    amount: 4500",
        "    currency: RSD",
        "    category: food",
        "---",
        "",
        "Worte.",
      ].join("\n"),
    );
    clearUserCache();
  });

  test("is caught when the answer gives only the figure it could convert", async () => {
    create
      .mockResolvedValueOnce(calls("trip_costs", { trip: "Die Reise" }))
      .mockResolvedValueOnce(says("Insgesamt 31 Franken."))
      .mockResolvedValueOnce(says("Doch, insgesamt 31 Franken."));
    const answered = await read(await ask("was hat die reise gekostet"));

    // Twice asked, twice only the convertible half: she gets no figure rather
    // than a smaller trip than the one she took.
    expect(String(answered.body.answer)).not.toContain("31");
  });

  /**
   * And one turn later, from memory — B962.
   *
   * The disclosure held on every turn that called the tool, and was gone on
   * the next: *"just the number then"* came back as *"Danube Circuit cost
   * 240.476 CHF so far"* with `looked: []`. The same harm as the bug B960
   * closed, one turn after the fix reached.
   *
   * No new mechanism was needed once the matcher could see the sentence:
   * B955's rule — a total stated with no cost read on this turn — covers the
   * memory case on its own, and always did.
   *
   * The honest limit, since this test would hide it otherwise: a retry that
   * rephrases into something the matcher cannot see gets through. *"Doch, 240
   * Franken."* is not a total to `A_TOTAL` and never will be without matching
   * every bare figure, which would catch the person's own gelato. That is the
   * standing cost of matching text, and the reason the reads themselves are
   * where the real guarantees live.
   */
  test("a bare number a turn later, from memory, is caught by the same rule", async () => {
    create
      .mockResolvedValueOnce(says("Die Reise hat bisher 240 Franken gekostet."))
      .mockResolvedValueOnce(says("Doch, die Reise hat 240 Franken gekostet."));
    const answered = await read(await ask("nur die zahl bitte"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).not.toContain("240");
  });

  test("and left alone when the answer names what was left out", async () => {
    create
      .mockResolvedValueOnce(calls("trip_costs", { trip: "Die Reise" }))
      .mockResolvedValueOnce(
        says("Insgesamt 0 Franken, und 4500 RSD dazu, die ich nicht umrechnen kann."),
      );
    const answered = await read(await ask("was hat die reise gekostet"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toContain("4500 RSD");
  });

  /**
   * The estimate it offered instead of a blank — B963.
   *
   * Asked for a rough number, it named the money it could not convert —
   * correctly — and then offered *"about 30 CHF worth if you want a fuller
   * number"* for it. Unprompted, and not far out, which is what makes it
   * dangerous rather than obviously wrong: the trip has no rate for that
   * currency, which is exactly why it was excluded.
   *
   * B960 made the conversation honest about what it left out. This is the
   * model filling the hole back in from its own belief one sentence later,
   * because a blank felt unhelpful.
   */
  test("a figure the costs did not contain is caught, however helpful it looks", async () => {
    create
      .mockResolvedValueOnce(calls("trip_costs", { trip: "Die Reise" }))
      .mockResolvedValueOnce(
        says("Insgesamt 0 Franken, und 4500 RSD dazu — etwa 38 CHF, wenn du eine vollere Zahl willst."),
      )
      .mockResolvedValueOnce(
        says("Doch, 4500 RSD sind ungefähr 38 CHF."),
      );
    const answered = await read(await ask("und ungefähr in franken?"));

    expect(create).toHaveBeenCalledTimes(3);
    expect(String(answered.body.answer)).not.toContain("38");
  });

  test("but rounding a figure it was given is the same claim, not a new one", async () => {
    create
      .mockResolvedValueOnce(calls("trip_costs", { trip: "Die Reise" }))
      .mockResolvedValueOnce(says("Rund 4500 RSD, die ich nicht umrechnen kann. Sonst 0 Franken."));
    const answered = await read(await ask("was hat die reise gekostet"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toContain("4500 RSD");
  });
});

/* ---------------------------------- the plumbing, said to the person --- */

/**
 * The model narrating its own tools — B964.
 *
 * An answer began: *"I called trip_costs for Danube Circuit but it returned
 * Balkan Loop. The total for Danube Circuit is 240.476 CHF…"* The figure was
 * right and the trips were correctly separated afterwards; what reached the
 * person was a tool name and a suspicion about that tool, in the middle of an
 * answer about their holiday. Driven against two similarly named trips, the
 * resolution it was complaining about is correct — so there was nothing behind
 * the suspicion either.
 *
 * B924's fault, said by the model rather than written by the server: two
 * audiences, one channel. That one was fixed by making a note a note. This one
 * cannot be, because the model composes it — so the sentence is dropped, not
 * retried: it is noise rather than a false claim, and the rest of the answer
 * is usually right, as it was here.
 */
describe("what the person is not told about", () => {
  test("a sentence naming a tool is dropped and the answer survives", async () => {
    create.mockResolvedValueOnce(
      says(
        "I called trip_costs for Danube Circuit but it returned Balkan Loop. " +
          "You have one trip and no days on it yet.",
      ),
    );
    const answered = await read(await ask("wie weit bin ich"));

    const said = String(answered.body.answer);
    expect(said).not.toContain("trip_costs");
    expect(said).not.toContain("I called");
    // And what she actually asked about is still there.
    expect(said).toContain("You have one trip");
  });

  test("every tool that could be named is covered, not a list somebody typed", () => {
    // The names come from the registry, so a tool added next month is covered
    // without anybody remembering this file.
    const named = TOOLS.map((tool) => tool.name).filter((name) => name.includes("_"));
    expect(named.length).toBeGreaterThan(5);
    expect(named).toContain("trip_costs");
  });

  test("ordinary prose is untouched, including a sentence about a trip's costs", async () => {
    create.mockResolvedValueOnce(says("Die Kosten der Reise stehen noch auf null."));
    const answered = await read(await ask("was hat sie gekostet"));
    expect(String(answered.body.answer)).toBe("Die Kosten der Reise stehen noch auf null.");
  });
});

/* ------------------------------------------ whether it is on the site --- */

/**
 * The question somebody asks when they are anxious — B970.
 *
 * > "I pressed it, is June 13th live now?"
 * > "Yes, June 13th is live on the site now."
 *
 * `looked: []`. No read, no check: the answer was an inference from the
 * person's own sentence. It happened to be true, because they had just pressed
 * publish, and it was true by luck.
 *
 * B932 settled this shape for what a day *says*. Whether it is **up** is the
 * same kind of claim and is the one that gets asked precisely because somebody
 * is unsure — the answer is the whole of what they get. That a press happened
 * is not the same fact: what makes a day published is the day.
 */
describe("saying whether a day is on the site", () => {
  for (const said of [
    "Yes, June 13th is live on the site now.",
    "It is up.",
    "The day is now published.",
    "It is still a draft.",
    "Der Tag ist jetzt online.",
    "Er steht jetzt auf der Seite.",
    "Der Tag ist noch ein Entwurf.",
    "A nap fent van.",
    "Még piszkozat.",
  ]) {
    test(`is such a claim: ${said}`, () => {
      expect(claimsItIsUp(said)).toBe(true);
    });
  }

  for (const said of [
    // Proposing to publish is not saying it is published — and this is the
    // sentence the product says most often.
    "Press the button and I will put it on the site.",
    "Shall I publish it?",
    "Soll ich den Tag veröffentlichen?",
    "Ich lege dir das zum Veröffentlichen hin.",
  ]) {
    test(`is not: ${said}`, () => {
      expect(claimsItIsUp(said)).toBe(false);
    });
  }

  test("is caught when nothing was read", async () => {
    create
      .mockResolvedValueOnce(says("Ja, der Tag ist jetzt online."))
      .mockResolvedValueOnce(says("Doch, der Tag ist jetzt online."));
    const answered = await read(await ask("ist der tag jetzt oben?"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).not.toContain("online");
  });

  test("and left alone when the day was actually read", async () => {
    create
      .mockResolvedValueOnce(calls("read_day", { trip: "Die Reise", date: "2026-05-01" }))
      .mockResolvedValueOnce(says("Der Tag ist noch ein Entwurf."));
    const answered = await read(await ask("ist der tag jetzt oben?"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Der Tag ist noch ein Entwurf.");
  });
});

/* ---------------------------------- half a two-part request — B952 --- */

/**
 * *"…could you change the title of the 22nd to Homeward Bound … and also
 * remind me what currency this journal counts money in…"* — the title change
 * was proposed, and the currency question was never answered and never
 * mentioned again. Nothing untrue was said, which is why none of the checks
 * above catch it: they all catch a false claim, and an omission makes none.
 */
describe("droppedAQuestion", () => {
  test("a write with no read alongside a question is the shape of the fault", () => {
    expect(droppedAQuestion("change the title and also what currency is this in?", ["set_day_words"])).toBe(true);
  });

  test("a plain statement carries nothing to have dropped", () => {
    expect(droppedAQuestion("change the title to Homeward Bound", ["set_day_words"])).toBe(false);
  });

  test("a turn that read something to answer it is left alone", () => {
    expect(
      droppedAQuestion("change the title and also what currency is this in?", ["set_day_words", "account"]),
    ).toBe(false);
  });

  test("a question with nothing written is a turn that never touched the write half either", () => {
    expect(droppedAQuestion("what currency is this in?", [])).toBe(false);
  });
});

describe("a compound message where the write is answered and the question is not", () => {
  test("is caught, and a retry that reads something answers both", async () => {
    create
      .mockResolvedValueOnce(calls("set_day_words", { trip: "Die Reise", slug: "eins", title: "Heimreise" }))
      .mockResolvedValueOnce(says("Ich habe den neuen Titel vorgeschlagen."))
      .mockResolvedValueOnce(calls("account", {}))
      .mockResolvedValueOnce(
        says("Ich habe den neuen Titel vorgeschlagen. Dieses Journal rechnet in CHF."),
      );
    const answered = await read(
      await ask("ändere den Titel des 22. zu Heimreise und in welcher Währung rechnet dieses Journal eigentlich?"),
    );

    expect(create).toHaveBeenCalledTimes(4);
    expect(String(answered.body.answer)).toBe(
      "Ich habe den neuen Titel vorgeschlagen. Dieses Journal rechnet in CHF.",
    );
    expect((answered.body.proposals as unknown[]).length).toBe(1);
  });

  test("and if the retry still says nothing about it, she is told plainly", async () => {
    create
      .mockResolvedValueOnce(calls("set_day_words", { trip: "Die Reise", slug: "eins", title: "Heimreise" }))
      .mockResolvedValueOnce(says("Ich habe den neuen Titel vorgeschlagen."))
      .mockResolvedValueOnce(says("Ich habe den neuen Titel vorgeschlagen."));
    const answered = await read(
      await ask("ändere den Titel des 22. zu Heimreise und in welcher Währung rechnet dieses Journal eigentlich?"),
    );

    expect(create).toHaveBeenCalledTimes(3);
    expect(String(answered.body.answer)).toContain("only got to part");
    // The write itself is not undone by the omission being caught: the
    // proposal it made is still on her screen.
    expect((answered.body.proposals as unknown[]).length).toBe(1);
  });

  test("a plain request with no second question is left alone", async () => {
    create
      .mockResolvedValueOnce(calls("set_day_words", { trip: "Die Reise", slug: "eins", title: "Heimreise" }))
      .mockResolvedValueOnce(says("Ich habe den neuen Titel vorgeschlagen."));
    const answered = await read(await ask("ändere den Titel des 22. zu Heimreise"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Ich habe den neuen Titel vorgeschlagen.");
  });
});

/* ------------------ an honest single request must never trip it — B952 --- */

/**
 * The coordinator's own counter-example: a polite request is grammatically a
 * question, produces exactly one write and reads nothing, and is answered in
 * full. `droppedAQuestion`'s naive form — a `?`, a write tool, no read tool —
 * cannot tell this apart from the currency example, and firing here is the
 * bug AGENTS.md names as seriously as a miss: a person who asked one thing
 * and got it, told they still have a question outstanding, is exactly the
 * uselessness *"I would rather not give you a figure"* describes when there
 * was never a figure to ask for.
 */
describe("an honest single request phrased as a question is left alone", () => {
  test("could you write up today? — English", async () => {
    create
      .mockResolvedValueOnce(
        calls("draft_words", {
          trip: "Die Reise",
          slug: "eins",
          notes: "we went to the museum and then the harbour",
        }),
      )
      .mockResolvedValueOnce(says("Here is a first pass at today — have a look."));
    const answered = await read(await ask("could you write up today? we went to the museum and then the harbour"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Here is a first pass at today — have a look.");
  });

  test("Kannst du den heutigen Tag schreiben? — German", async () => {
    create
      .mockResolvedValueOnce(
        calls("draft_words", {
          trip: "Die Reise",
          slug: "eins",
          notes: "Wir waren im Museum und dann am Hafen.",
        }),
      )
      .mockResolvedValueOnce(says("Hier ist ein erster Entwurf für heute."));
    const answered = await read(
      await ask("Kannst du den heutigen Tag schreiben? Wir waren im Museum und dann am Hafen."),
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Hier ist ein erster Entwurf für heute.");
  });

  test("Megírnád a mai napot? — Hungarian", async () => {
    create
      .mockResolvedValueOnce(
        calls("draft_words", {
          trip: "Die Reise",
          slug: "eins",
          notes: "Elmentünk a múzeumba, aztán a kikötőbe.",
        }),
      )
      .mockResolvedValueOnce(says("Íme egy első változat a mai napról."));
    const answered = await read(
      await ask("Megírnád a mai napot? Elmentünk a múzeumba, aztán a kikötőbe."),
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Íme egy első változat a mai napról.");
  });

  test("shall I put this in for the 14th? — a bare confirmation with no notes at all", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-14" }))
      .mockResolvedValueOnce(says("Der Knopf dafür steht bereit."));
    const answered = await read(await ask("shall I put this in for the 14th?"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Der Knopf dafür steht bereit.");
  });

  test("can you save that? — a bare confirmation of a write already discussed", async () => {
    create
      .mockResolvedValueOnce(calls("set_day_words", { trip: "Die Reise", slug: "eins", title: "Heimreise" }))
      .mockResolvedValueOnce(says("Der Titel ist vorgeschlagen."));
    const answered = await read(await ask("can you save that?"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Der Titel ist vorgeschlagen.");
  });
});

/* ------------------------------- a paragraph where a card belongs --- */

/**
 * The fault the whole product is arranged against — B1041.
 *
 * Pressing "Neue Reise" got a paragraph asking for a title, a start date *"(YYYY-MM-DD)"*,
 * an end date, and which of three visibilities — every one of them a field on
 * the card `create_trip` would have proposed, including a select whose three
 * options are those three sentences as labels.
 *
 * Somebody was asked to type a date in a format by a tool whose entire purpose
 * is to put a date picker in front of them.
 */
describe("asking for what a card would have asked", () => {
  for (const said of [
    "Ich brauche ein paar Angaben: Startdatum (YYYY-MM-DD) und Enddatum.",
    "What is the start date? Please give it as YYYY-MM-DD.",
    "Gib mir das Datum bitte als TT.MM.JJJJ.",
  ]) {
    test(`is asking for fields: ${said}`, () => {
      expect(asksForFields(said)).toBe(true);
    });
  }

  for (const said of [
    // The honest shape: the card is on the screen and it says so.
    "Ein Vorschlag für eine neue Reise wartet auf deinem Bildschirm.",
    "Welche Reise meinst du?",
    // A date said as a person says it is not a format.
    "Der 30. April ist noch nicht fertig.",
    "I have put the 1st of May on your screen.",
  ]) {
    test(`is not: ${said}`, () => {
      expect(asksForFields(said)).toBe(false);
    });
  }

  test("a turn that asks instead of proposing is caught and asked again", async () => {
    create
      .mockResolvedValueOnce(says("Wie soll die Reise heissen? Startdatum (YYYY-MM-DD)?"))
      .mockResolvedValueOnce(calls("create_trip", { title: "Alpen" }))
      .mockResolvedValueOnce(says("Ein Vorschlag wartet auf deinem Bildschirm."));
    const answered = await read(await ask("ich möchte eine neue reise anlegen"));

    // It proposed on the retry, which is the whole point.
    expect((answered.body.blocks as { shape: string }[]).some((one) => one.shape === "form")).toBe(true);
    expect(String(answered.body.answer)).not.toContain("YYYY");
  });

  test("and a turn that already proposed is left alone, whatever it says", async () => {
    create
      .mockResolvedValueOnce(calls("create_trip", { title: "Alpen" }))
      .mockResolvedValueOnce(says("Trag die Daten ein, das Format ist YYYY-MM-DD."));
    const answered = await read(await ask("neue reise"));

    // Ugly, but the card is there — and this guard is about the missing card,
    // not about policing prose beside one.
    expect(create).toHaveBeenCalledTimes(2);
  });
});
