import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { forget, history, wrote } from "@/lib/helper/thread";
import {
  claimsAccess,
  claimsWhatADaySays,
  claimsWhatIsNotThere,
  claimsAButton,
  claimsATotal,
  claimsAWrite,
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
    expect(said).toContain("waiting on your screen");
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
    const turns = history("alex");
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
    expect(history("alex")[1].text).not.toContain("waiting to be pressed");
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

  for (const said of [
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

  test("a turn that did read the costs is left alone", async () => {
    create
      .mockResolvedValueOnce(calls("trip_costs", { trip: "Die Reise" }))
      .mockResolvedValueOnce(says("Insgesamt 107 Franken."));
    const answered = await read(await ask("was hat die reise gekostet"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Insgesamt 107 Franken.");
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
