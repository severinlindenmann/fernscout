/**
 * Does the conversation still do the right thing? — B1744.
 *
 *   npm run helper:bench                      # the whole corpus, once each
 *   npm run helper:bench -- --jobs 6          # six child processes; see below
 *   npm run helper:bench -- --runs 20 --only card-to-trip/web/de/1
 *   npm run helper:bench -- --scenario card-to-trip     # every case of one
 *   npm run helper:bench -- --channel whatsapp
 *   npm run helper:bench -- --show            # the answer behind every failure
 *   npm run helper:bench -- --against docs/benchmarks/helper-behaviour/baseline.json
 *   npm run helper:bench -- --out docs/benchmarks/helper-behaviour/baseline.json
 *
 * ## A scenario is a template, not a case — B1747
 *
 * The failures this repository keeps finding are *phrasing* failures: "setze X
 * auf die Namensliste" passed eight times in eight and "auf ungarn reise"
 * five in eight, on the same journal, wanting the same thing. A corpus with
 * one wording per situation measures the wording and calls it the situation.
 *
 * So a scenario carries its wordings per locale and its doors, and the runner
 * expands channels x locales x wordings into cases named
 * `<scenario>/<channel>/<locale>/<n>`. Twenty readable blocks become two
 * hundred cases, and `--only` still names exactly one of them.
 *
 * A wording is a string (one turn) or an array of strings (a conversation).
 * **Locales come from the keys of `says`**, never from a list beside it — a
 * locale cannot be claimed without wordings in it, which is what keeps
 * somebody from adding `"hu"` to an array and inventing the sentences.
 *
 * ## Why `--jobs` spawns processes rather than promises
 *
 * `withWorld` sets `CONTENT_DIR` and `DATA_DIR`, which are process-global.
 * Two cases cannot share a process, by construction, and that is not worth
 * fighting: the case list is sharded and each shard runs in its own child,
 * which writes its results to a file the parent reads.
 *
 * **This is a benchmark, not a test, and it must never enter `npm run verify`.**
 * It calls a real model, spends real money and does not give the same answer
 * twice. `npm run verify` proves the mechanism — that `stagedContact` finds a
 * card, that a proposal's arguments are a body its route accepts. This proves
 * the *behaviour*: that the model reaches for the tool at all.
 *
 * ## Why it exists
 *
 * Every rule the helper follows is a sentence in `threadSystemPrompt` or a
 * tool's `describe`, so changing one is a claim about what a model will do —
 * and until this script there was no way to check such a claim. B1737 cut a
 * sentence to fit the prompt's token ceiling and nobody could say whether it
 * mattered; the owner found out an hour later, live. B1742 then measured the
 * wrong thing three times and had to be left unfixed, because six runs cannot
 * choose between two prompts.
 *
 * ## The mistake this script exists to make impossible
 *
 * `answerInThread` does **not** compose the files-pane selection line —
 * `app/api/helper/[user]/ask/route.ts` does. A harness that calls
 * `answerInThread` directly is therefore asking the model a question nobody is
 * ever asked, and every number it produces is void. That is exactly what
 * happened in B1742. `runWeb` below performs the same composition the route
 * performs, and that is the single most important thing in this file.
 *
 * ## Reading the output
 *
 * A pass rate per scenario, over `--runs`. Treat a single run as noise and a
 * difference of one as nothing: at five runs the gap between "4 of 6" and
 * "5 of 6" is not a finding, which is the lesson B1742 paid for. Twenty runs
 * is the smallest number worth arguing from.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const corpusFile = path.join(root, "docs", "benchmarks", "helper-behaviour", "corpus.json");

type Expectation = {
  /** A tool that ran this turn, read or write. A *read* tool never proposes —
   *  it answers with a block — so `proposes` can never match one, and a
   *  scenario about `trips` or `trip_costs` that used it scored 0 of 22
   *  against a product doing the right thing every time. B1747. */
  calls?: string;
  proposes?: string;
  proposesAnyOf?: string[];
  notProposes?: string[];
  argument?: { name: string; equals: string };
  answerHasNot?: string[];
};

/** What the corpus holds: one situation, in as many wordings and doors as it
 *  is worth asking about. */
type Template = {
  id: string;
  why: string;
  channels: ("web" | "whatsapp")[];
  /** Locale -> wordings. One wording is a turn or a conversation. */
  says: Record<string, (string | string[])[]>;
  /**
   * What a person would say next when asked — B1754.
   *
   * A single-message wording used to be one turn: if it did not propose, the
   * case failed, so one sensible question ("which date was that?") scored the
   * same as inventing a trip. That is not what this product intends — its own
   * prompt says to write "as soon as you understand what they want" — and it
   * is not what the clarification benchmarks do either: they measure turns to
   * resolution and penalise *inefficient* questioning, not questioning.
   *
   * These are sent, in order, only while nothing has been proposed. Per
   * locale, because the answer to a German question is German.
   *
   * **A refusal scenario must never have them.** Where the right answer is to
   * ask, there is nothing to resolve to, and a nudge would only be the
   * benchmark talking itself into a write.
   */
  nudges?: Record<string, string[]>;
  world: Scenario["world"];
  expect: Expectation;
};

/** One expanded, runnable case. */
type Scenario = {
  id: string;
  template: string;
  why: string;
  channel: "web" | "whatsapp";
  world: {
    locale?: string;
    trips?: { id: string; title: string; start: string; end: string }[];
    contacts?: { name: string; email: string }[];
    /**
     * Days already on a trip — B1748. Without these, half the corpus asked
     * unfair questions: a cost has nowhere to land on a journal with no days,
     * so "we spent 4500 forint on the 3rd" was scored a failure for an answer
     * that was correct ("there is no day yet"). `trip` names which trip.
     */
    days?: { trip: string; slug: string; date: string; title?: string; location?: string; content?: string; draft?: boolean }[];
    /** Ticked in the files pane — web only. */
    select?: string;
    /** Sent as a WhatsApp contacts message before the turns — whatsapp only. */
    share?: string;
  };
  turns: string[];
  /** Answers to a question the model asks — see `Template.nudges`. */
  nudges: string[];
  expect: Expectation;
};

type Outcome = {
  /** How many of the person's messages it took before anything was proposed —
   *  0 when nothing ever was. One is the good answer; two is a question
   *  answered; the gap between them is the clarifying-question rate. B1754. */
  turnsUsed: number;
  tools: string[];
  proposed: { tool: string; args: Record<string, string> }[];
  answer: string;
};

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}
/**
 * One run per case by default — B1747. Depth comes from *wordings* now, not
 * from repetition: a scenario with forty cases across two locales is forty
 * samples of the same situation, which is a better measurement than the same
 * sentence asked forty times. Raise `--runs` when the question is one case.
 */
const RUNS = Number(flag("runs") ?? "1");
const ONLY = flag("only");
const SCENARIO = flag("scenario");
const CHANNEL = flag("channel");
const LOCALE = flag("locale");
const OUT = flag("out");
const AGAINST = flag("against");
const JOBS = Number(flag("jobs") ?? "1");
const SHARD = flag("shard");
const RESULT_FILE = flag("result-file");
/** Print the answer behind every failure — what to reach for before guessing
 *  at a prompt. A pass rate says something is wrong; this says what. */
const SHOW = args.includes("--show");
/** How many wordings per scenario per locale to take. The default is small on
 *  purpose — see the estimate below. `--sample 0` means all of them. */
const SAMPLE = Number(flag("sample") ?? "2");
/** Past `CASE_CEILING`, the run says what it will cost and stops unless this
 *  is passed. B1754: four full sweeps in one afternoon cost twenty dollars,
 *  and not one of them printed a number before or after. */
const YES = args.includes("--yes");
const CASE_CEILING = 150;

/**
 * The application talks to stdout — every dry-run reply, every inbound line.
 * Across two hundred cases that is thousands of lines between the reader and
 * the number they asked for, so it is silenced unless somebody asked to see
 * the failures. `console.error` is left alone: a real error must never be
 * swallowed by a benchmark's tidiness, and it is where this script's own
 * progress and failures are written for the same reason.
 */
if (!SHOW) console.log = () => {};
/**
 * A wamid is never reused, across the whole process — B1744.
 *
 * `lib/idempotency.ts`'s `store` is a module-level Map that outlives a
 * scenario's temporary journal and database. Numbering messages from zero in
 * each run made every run after the first a `"replay"`: `handleInboundMessage`
 * returned silently, the bench saw no proposal and no reply, and scored a
 * working product 0 of 8. Correct on the real server, where a wamid is Meta's
 * and globally unique; a harness has to earn that the same way.
 */
/**
 * What this run has cost, in tokens — B1754.
 *
 * A benchmark that spends money and does not say how much is a benchmark
 * people stop running, or run without noticing. `lib/usage.ts` already counts
 * every call the product makes; this only adds them up and prices them from
 * `site/config.json`'s own rates, so the number on screen is the same
 * arithmetic `/admin` does.
 */
const spent = { input: 0, output: 0 };

let messageSeq = 0;
const nextMessageId = (scenario: string) => `wamid.bench.${scenario}.${messageSeq++}`;/**
 * One throwaway journal per run — the same discipline `test/whatsapp-*.test.ts`
 * follow, for the same reason: a scenario that inherits the last one's trips,
 * inbox or thread is not the scenario it says it is.
 */
async function withWorld<T>(
  scenario: Scenario,
  body: (ctx: { username: string; dir: string; contactIds: Record<string, string> }) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-bench-"));
  // Two directories, as a real instance has them. One temporary folder for
  // both made `whatsapp-replies/` (B1741) sit beside the journals, so
  // `getUsernames` tried to read it as one and said so on every single turn.
  const dir = path.join(root, "content");
  const data = path.join(root, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  const username = "bench";
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(data, "bench.db")}`;
  process.env.WHATSAPP_APP_SECRET = "bench-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "bench-token";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Bench", url: "https://bench.test" },
      users: { reserved: [] },
      features: {
        helper: { enabled: true },
        credits: { enabled: true },
        whatsappInbound: { enabled: true },
        whatsapp: { enabled: true, backend: "dry-run" },
      },
    }),
  );

  const { clearConfigCache } = await import("../lib/config");
  const { clearUserCache } = await import("../lib/users");
  const { closeDatabase, getDatabase } = await import("../lib/db");
  const { migrateToLatest } = await import("../lib/db/migrate");
  const { createJournal } = await import("../lib/journals");
  const { grant } = await import("../lib/credits");
  const { storeInboxFile } = await import("../lib/inbox");
  const { toVCard } = await import("../lib/whatsapp/vcard");
  const { writeTripFixture, writeDayFixture } = await import("../test/fixtures/content");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username,
    title: "A journal",
    ownerEmail: "bench@example.test",
    ownerName: "Owner",
    ownerNickname: "Owner",
    defaultLocale: scenario.world.locale ?? "de",
    ...(scenario.channel === "whatsapp"
      ? {
          ownerTel: "41790000000",
          ownerTelProvenAt: new Date().toISOString(),
          ownerTelProvenMethod: "sms" as const,
        }
      : {}),
  });
  if (!created.ok) die(`could not create the bench journal: ${JSON.stringify(created)}`);
  await grant(username, 5);
  if (scenario.channel === "whatsapp") {
    // Writing by chat is off until a journal says yes — `handleInboundMessage`
    // otherwise spends the first two turns offering to switch it on, which is
    // its own correct behaviour and not the scenario under test.
    const { setJournalFeatures } = await import("../lib/journals");
    const switched = setJournalFeatures(username, { whatsappInbound: true });
    if (!switched.ok) die(`could not switch whatsappInbound on: ${JSON.stringify(switched)}`);
  }

  for (const trip of scenario.world.trips ?? []) {
    writeTripFixture(username, { ...trip, visibility: "private" });
  }
  for (const day of scenario.world.days ?? []) {
    writeDayFixture(dir, username, day.trip, {
      slug: day.slug,
      date: day.date,
      ...(day.title ? { title: day.title } : {}),
      ...(day.location ? { location: day.location } : {}),
      ...(day.content ? { content: day.content } : {}),
      ...(day.draft ? { status: "draft" as const } : {}),
    });
  }

  // Staged directly for the web door; the WhatsApp door sends a real contacts
  // message instead, so the card arrives the way it really arrives.
  const contactIds: Record<string, string> = {};
  if (scenario.channel === "web") {
    for (const contact of scenario.world.contacts ?? []) {
      const stored = storeInboxFile(
        username,
        "contact",
        `${contact.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.vcf`,
        Buffer.from(toVCard({ name: contact.name, emails: [contact.email] })),
        { source: "whatsapp" },
      );
      contactIds[contact.name] = stored.entry.id;
    }
  }

  try {
    const answer = await body({ username, dir: data, contactIds });
    // Before the database is closed and the folder removed — `lib/usage.ts`
    // has been counting every call the product made, and it is the only
    // honest source for what a sweep costs. B1754.
    try {
      const rows = await (await getDatabase()).db
        .selectFrom("usage")
        .select(["input_tokens", "output_tokens"])
        .where("owner_id", "=", username)
        .execute();
      for (const row of rows) {
        spent.input += Number(row.input_tokens ?? 0);
        spent.output += Number(row.output_tokens ?? 0);
      }
    } catch {
      // Bookkeeping about bookkeeping. A sweep must not fail over it.
    }
    return answer;
  } finally {
    await closeDatabase();
    clearConfigCache();
    clearUserCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The web room, composed the way `app/api/helper/[user]/ask/route.ts` composes
 * it. **Read this file's header before changing a line of this function.**
 */
async function runWeb(scenario: Scenario): Promise<Outcome> {
  return withWorld(scenario, async ({ username, contactIds }) => {
    const { answerInThread } = await import("../lib/helper/model");
    const { describeSelection } = await import("../lib/helper/server");
    const { forget, remember, history } = await import("../lib/helper/thread");
    const say = ((key: string) => key) as never;

    forget(username);
    const selected = scenario.world.select ? [`inbox:${contactIds[scenario.world.select]}`] : [];
    const today = "2026-06-03";
    let last: Outcome = { turnsUsed: 0, tools: [], proposed: [], answer: "" };
    let spoken = 0;

    for (const said of [...scenario.turns, ...scenario.nudges]) {
      // route.ts:334 — the selection line is built here, from disk, and rides
      // as one bracketed line after their words. Omitting it is what voided
      // B1742's first three rounds of measurement.
      const context = selected.length > 0 ? describeSelection(username, selected) : "";
      const withContext = context === "" ? said : `${said}\n${context}`;
      const thread = await answerInThread(
        username,
        withContext,
        await history(username),
        today,
        say,
        selected,
        scenario.world.locale ?? "de",
        "web",
      );
      remember(username, said, thread.answer, "web");
      spoken++;
      last = {
        turnsUsed: thread.proposals.length > 0 ? spoken : 0,
        tools: thread.looked,
        proposed: thread.proposals.map((one) => ({ tool: one.tool, args: one.arguments })),
        answer: thread.answer,
      };
      // A turn that already proposed has answered the scenario; saying the
      // next line would only be a second question about a settled card.
      if (last.proposed.length > 0) break;
    }
    forget(username);
    return last;
  });
}

/**
 * The WhatsApp door, through `handleInboundMessage` — the same entry point
 * `app/api/webhooks/whatsapp/route.ts` calls and `test/whatsapp-*.test.ts`
 * already drive.
 *
 * **What the turn did is read from the held proposal and the replies that
 * actually went out, never from `helper_sessions`.** The first version of
 * this read that table and produced 0 of 8 on a scenario the product gets
 * right: `lib/whatsapp/dispatch.ts` records a turn with `void recordTurn(…)`,
 * deliberately un-awaited (losing an answer to an analytics insert would be
 * trading the product for the bookkeeping), so a read straight afterwards
 * races the insert and finds the greeting instead. Two false zeroes in one
 * afternoon is what this comment is for.
 *
 * `peekPendingProposal` is the honest signal and carries the arguments too,
 * so this door answers `argument` expectations exactly as the web one does.
 */
async function runWhatsapp(scenario: Scenario): Promise<Outcome> {
  return withWorld(scenario, async ({ username, dir }) => {
    const { handleInboundMessage } = await import("../lib/whatsapp/dispatch");
    const { peekPendingProposal } = await import("../lib/whatsapp/pendingProposal");
    const { forget } = await import("../lib/helper/thread");
    const tel = "41790000000";
    const id = () => nextMessageId(scenario.id);

    forget(username);
    // Bind the number, then take the disclosure — the two exchanges every real
    // conversation on this channel begins with (B1138).
    await handleInboundMessage({ kind: "text", id: id(), from: tel, timestamp: "1700000000", body: "hallo" });
    await handleInboundMessage({ kind: "text", id: id(), from: tel, timestamp: "1700000000", body: "ja" });

    if (scenario.world.share) {
      const contact = (scenario.world.contacts ?? []).find((one) => one.name === scenario.world.share);
      if (!contact) die(`${scenario.id}: world.share names no contact`);
      await handleInboundMessage({
        kind: "contacts",
        id: id(),
        from: tel,
        timestamp: "1700000000",
        contacts: [{ name: contact.name, emails: [contact.email] }],
      });
    }

    const before = repliesTo(dir, username).length;
    let spoken = 0;
    for (const said of [...scenario.turns, ...scenario.nudges]) {
      await handleInboundMessage({ kind: "text", id: id(), from: tel, timestamp: "1700000000", body: said });
      spoken++;
      if (peekPendingProposal(username, tel)) break;
    }

    const pending = peekPendingProposal(username, tel);
    // Everything this turn actually sent, joined the way a person reads several
    // bubbles in a row — `dispatch.ts` joins its own record the same way.
    const answer = repliesTo(dir, username).slice(before).join("\n\n");
    // Which tools *ran* is only in `helper_sessions`, and `recordTurn` is
    // un-awaited on purpose — so poll for the row instead of reading once and
    // calling the absence a fact. The proposal above is never taken from here.
    const tools = await pollRecordedTools(username);
    forget(username);
    return {
      turnsUsed: pending ? spoken : 0,
      tools,
      proposed: pending ? [{ tool: pending.tool, args: pending.arguments }] : [],
      answer,
    };
  });
}

/**
 * The tools the last recorded turn ran — polled, never read once.
 *
 * `lib/whatsapp/dispatch.ts` records with `void recordTurn(…)`, deliberately
 * un-awaited: losing an answer to an analytics insert would be trading the
 * product for the bookkeeping. A single read after the turn therefore races
 * the insert, and reading an absence as "no tools ran" is what scored a
 * working scenario 0 of 8 once already (B1744). Half a second of patience is
 * the honest version of the same read.
 */
async function pollRecordedTools(username: string): Promise<string[]> {
  const { getDatabase } = await import("../lib/db");
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await (await getDatabase()).db
      .selectFrom("helper_sessions")
      .select(["tools"])
      .where("owner_id", "=", username)
      .where("kind", "=", "turn")
      .orderBy("created_at", "desc")
      .limit(1)
      .execute();
    const tools = (rows[0]?.tools ?? "").split(",").filter(Boolean);
    if (tools.length > 0) return tools;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

/** The dry-run backend's own record of what went out — `lib/whatsapp/reply.ts`,
 *  under DATA_DIR since B1741. The suite reads these files for the same
 *  reason: they are what the person on the other end received. */
function repliesTo(dir: string, username: string): string[] {
  const at = path.join(dir, "whatsapp-replies", username);
  if (!fs.existsSync(at)) return [];
  return fs
    .readdirSync(at)
    .sort()
    .map((file) => (JSON.parse(fs.readFileSync(path.join(at, file), "utf8")) as { body?: string }).body ?? "");
}

function judge(outcome: Outcome, expect: Expectation): { pass: boolean; why: string } {
  const tools = outcome.proposed.map((one) => one.tool);
  if (expect.calls && !outcome.tools.includes(expect.calls)) {
    return { pass: false, why: `did not call ${expect.calls} (called: ${outcome.tools.join(",") || "nothing"})` };
  }
  if (expect.proposes && !tools.includes(expect.proposes)) {
    return { pass: false, why: `did not propose ${expect.proposes} (proposed: ${tools.join(",") || "nothing"})` };
  }
  if (expect.proposesAnyOf && !expect.proposesAnyOf.some((tool) => tools.includes(tool))) {
    return { pass: false, why: `proposed none of ${expect.proposesAnyOf.join("/")} (proposed: ${tools.join(",") || "nothing"})` };
  }
  for (const forbidden of expect.notProposes ?? []) {
    if (tools.includes(forbidden)) return { pass: false, why: `proposed ${forbidden}, which it should not` };
  }
  if (expect.argument) {
    const match = outcome.proposed.find((one) => one.tool === expect.proposes);
    const got = match?.args[expect.argument.name];
    if (match && got !== expect.argument.equals) {
      return { pass: false, why: `${expect.argument.name} was "${got ?? ""}", wanted "${expect.argument.equals}"` };
    }
  }
  const answer = outcome.answer.toLowerCase();
  for (const phrase of expect.answerHasNot ?? []) {
    if (answer.includes(phrase.toLowerCase())) {
      return { pass: false, why: `the answer asked for something it already had ("${phrase}")` };
    }
  }
  return { pass: true, why: "" };
}
/**
 * Channels x locales x wordings — B1747. A case id is
 * `<scenario>/<channel>/<locale>/<n>`, stable as long as the wordings keep
 * their order, which is what lets `--only` name one and a baseline compare
 * against the same thing next week.
 *
 * `{name}` and `{trip}` are filled from the world, so a wording is written
 * once and stays true when a fixture's names change.
 */
function expand(templates: Template[]): Scenario[] {
  const out: Scenario[] = [];
  /**
   * A stratified sample, not the first N — B1754. The tidy wordings are
   * written first and the phone-typed ones appended, so taking a prefix would
   * quietly test only the easy half and report a flattering number. Striding
   * across the list keeps both kinds in every sample, and the stride is fixed
   * rather than random so two runs are comparable.
   */
  const sample = <T,>(all: T[]): T[] => {
    if (SAMPLE <= 0 || all.length <= SAMPLE) return all;
    const stride = all.length / SAMPLE;
    return Array.from({ length: SAMPLE }, (_, i) => all[Math.floor(i * stride)]);
  };
  for (const template of templates) {
    const name = template.world.share ?? template.world.select ?? template.world.contacts?.[0]?.name ?? "";
    const trip = template.world.trips?.[0]?.title ?? "";
    const fill = (text: string) => text.replaceAll("{name}", name).replaceAll("{trip}", trip);
    for (const channel of template.channels) {
      for (const [locale, wordings] of Object.entries(template.says)) {
        // The index is the wording's place in the *full* list, so a case id
        // means the same thing whether or not the run was sampled.
        sample(wordings.map((wording, n) => [wording, n] as const)).forEach(([wording, n]) => {
          out.push({
            id: `${template.id}/${channel}/${locale}/${n}`,
            template: template.id,
            why: template.why,
            channel,
            world: { ...template.world, locale },
            turns: (Array.isArray(wording) ? wording : [wording]).map(fill),
            nudges: (template.nudges?.[locale] ?? []).map(fill),
            expect: template.expect,
          });
        });
      }
    }
  }
  return out;
}

type Result = {
  id: string;
  template: string;
  channel: string;
  passed: number;
  /** Of the passes, how many needed no question — B1754. A question is
   *  friction, so the two numbers are reported side by side and neither is
   *  allowed to hide behind the other. */
  straightAway: number;
  runs: number;
  failures: string[];
};

async function runCases(cases: Scenario[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const scenario of cases) {
    const failures: string[] = [];
    let passed = 0;
    let straightAway = 0;
    for (let run = 0; run < RUNS; run++) {
      let outcome: Outcome;
      try {
        outcome = scenario.channel === "web" ? await runWeb(scenario) : await runWhatsapp(scenario);
      } catch (thrown) {
        failures.push(`threw: ${(thrown as Error).message}`);
        continue;
      }
      const verdict = judge(outcome, scenario.expect);
      if (verdict.pass) {
        passed++;
        // `turnsUsed` counts the person's messages; anything the scenario
        // itself scripted is not a question the model asked.
        if (outcome.turnsUsed <= scenario.turns.length) straightAway++;
      } else {
        failures.push(verdict.why);
        if (SHOW)
          console.error(
            `\n  [${scenario.id}] ${verdict.why}\n  said: ${scenario.turns.join(" | ")}\n  answer: ${outcome.answer.replace(/\n/g, " ").slice(0, 300)}\n`,
          );
      }
    }
    results.push({ id: scenario.id, template: scenario.template, channel: scenario.channel, passed, straightAway, runs: RUNS, failures });
    if (!RESULT_FILE) process.stderr.write(passed === RUNS ? "." : "x");
  }
  return results;
}

/**
 * One child per shard — B1747, and processes rather than promises because
 * `withWorld` sets `CONTENT_DIR` and `DATA_DIR`, which are process-global.
 * Each child writes its own results file, so nothing has to be parsed back
 * out of the application's own chatter on stdout.
 */
async function runInJobs(cases: Scenario[]): Promise<Result[]> {
  const { spawn } = await import("node:child_process");
  const shards = Array.from({ length: JOBS }, (_, i) => i);
  const files = shards.map((i) => path.join(os.tmpdir(), `helper-bench-shard-${process.pid}-${i}.json`));
  // `--out` and `--against` are the parent's business; a child that wrote the
  // baseline would have every shard overwrite it with a sixth of the answer.
  const drop = new Set(["--jobs", "--out", "--against"]);
  const passthrough = args.filter((one, i) => !drop.has(one) && !drop.has(args[i - 1]));
  await Promise.all(
    shards.map(
      (i) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [...process.execArgv, process.argv[1], ...passthrough, "--shard", `${i}/${JOBS}`, "--result-file", files[i]],
            { stdio: ["ignore", "ignore", "inherit"] },
          );
          child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`shard ${i} exited ${code}`))));
        }),
    ),
  );
  const all: Result[] = [];
  for (const file of files) {
    const shard = JSON.parse(fs.readFileSync(file, "utf8")) as { results: Result[]; spent: typeof spent };
    all.push(...shard.results);
    spent.input += shard.spent?.input ?? 0;
    spent.output += shard.spent?.output ?? 0;
    fs.rmSync(file, { force: true });
  }
  const order = new Map(cases.map((one, i) => [one.id, i]));
  return all.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Rolled up per scenario, because a per-case rate over three runs is noise and
 * the same scenario across three wordings is a number. The cases are still in
 * the `--out` file, for when one wording is the question.
 */
/**
 * How far this rate could have landed from the truth by luck alone — B1752.
 *
 * Printed beside every figure because of the afternoon that made it
 * necessary: three runs of one scenario read 67%, 63% and 60% and were
 * reported as a fix, a regression and a regression. Then the *same code* ran
 * twice and gave 60% and 68%. Nothing had changed. Two standard errors of a
 * binomial at 84 cases is about ten points, which is exactly the spread
 * observed and exactly the size of every "finding" that afternoon produced.
 *
 * The consequence is worth stating plainly: at this corpus size only a very
 * large change is visible in the rate at all. Anything smaller needs the
 * paired comparison above, which asks a different and much sharper question.
 */
function marginOf(passed: number, runs: number): number {
  if (runs === 0) return 0;
  const p = passed / runs;
  return 196 * Math.sqrt((p * (1 - p)) / runs);
}

function byTemplate(results: Result[]): Map<string, { passed: number; straightAway: number; runs: number; failures: string[]; channel: string }> {
  const rolled = new Map<string, { passed: number; straightAway: number; runs: number; failures: string[]; channel: string }>();
  for (const one of results) {
    const at = rolled.get(one.template) ?? { passed: 0, straightAway: 0, runs: 0, failures: [], channel: one.channel };
    at.passed += one.passed;
    at.straightAway += one.straightAway ?? 0;
    at.runs += one.runs;
    at.failures.push(...one.failures);
    if (at.channel !== one.channel) at.channel = "both";
    rolled.set(one.template, at);
  }
  return rolled;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    die("ANTHROPIC_API_KEY is not set. This benchmark calls a real model and spends real money.");
  }
  const corpus = JSON.parse(fs.readFileSync(corpusFile, "utf8")) as { scenarios: Template[] };
  let cases = expand(corpus.scenarios)
    .filter((one) => !ONLY || one.id === ONLY)
    .filter((one) => !SCENARIO || one.template === SCENARIO)
    .filter((one) => !CHANNEL || one.channel === CHANNEL)
    .filter((one) => !LOCALE || one.world.locale === LOCALE);
  if (cases.length === 0) die("no case matched --only/--scenario/--channel/--locale.");

  if (SHARD) {
    const [index, of] = SHARD.split("/").map(Number);
    cases = cases.filter((_, i) => i % of === index);
    if (!RESULT_FILE) die("--shard needs --result-file");
    const mine = await runCases(cases);
    // The tokens too: a child counts its own spend, and a parent that only
    // collected results would report a sweep as free.
    fs.writeFileSync(RESULT_FILE, JSON.stringify({ results: mine, spent }));
    process.exit(0);
  }

  const started = Date.now();
  /**
   * Roughly what this will cost, before it is spent — B1754.
   *
   * Measured from the sweeps that prompted this: about five US dollars for 884
   * cases, so a bit over half a cent a case. It is an estimate and it says so;
   * the real figure is printed at the end from `lib/usage.ts`'s own rows.
   */
  const estimate = cases.length * RUNS * 0.006;
  console.error(
    `helper-bench: ${cases.length} case(s) x ${RUNS} run(s)${JOBS > 1 ? `, ${JOBS} jobs` : ""}` +
      `${SAMPLE > 0 ? `, ${SAMPLE} wording(s) per scenario per locale` : ", every wording"}.\n` +
      `This calls a real model. Rough cost: $${estimate.toFixed(2)}.\n`,
  );
  if (cases.length * RUNS > CASE_CEILING && !YES) {
    die(
      `That is ${cases.length * RUNS} model conversations, about $${estimate.toFixed(2)}. ` +
        `Pass --yes to run it, or narrow it with --sample / --scenario / --channel / --locale.`,
    );
  }
  const results = JOBS > 1 ? await runInJobs(cases) : await runCases(cases);
  process.stderr.write("\n\n");

  const rolled = byTemplate(results);
  const before = AGAINST
    ? (JSON.parse(fs.readFileSync(path.resolve(root, AGAINST), "utf8")) as { results: Result[] }).results
    : null;
  const previous = before ? byTemplate(before) : null;
  /** The earlier run's outcome for one case, for the paired comparison. */
  const wasByCase = new Map((before ?? []).map((one) => [one.id, one]));
  let regressed = false;
  const lines: string[] = [];

  for (const [template, one] of rolled) {
    const rate = (one.passed / one.runs) * 100;
    let delta = "";
    if (previous?.has(template)) {
      const was = previous.get(template) as { passed: number; runs: number };
      const rateBefore = (was.passed / was.runs) * 100;
      /**
       * **Compared case by case, not rate against rate** — B1752.
       *
       * Two identical runs of the same 84 cases came back 60% and 68%. That
       * is ordinary binomial noise (see `marginOf`), and every verdict this
       * bench printed before today was inside it — including two "worse"
       * findings that were nothing at all.
       *
       * The same cases run twice are a *paired* sample, so the question is
       * not "did the average move" but "which individual cases changed, and
       * in which direction". Only the cases that disagree carry information:
       * with `wins` and `losses` of them, a sign test says whether the split
       * is further from even than chance would ordinarily manage. Everything
       * that passed or failed both times tells you nothing and is exactly
       * what drowns the signal in the rate-against-rate version.
       */
      let wins = 0;
      let losses = 0;
      for (const now of results.filter((r) => r.template === template)) {
        const then = wasByCase.get(now.id);
        if (!then) continue;
        if (now.passed > then.passed) wins++;
        else if (now.passed < then.passed) losses++;
      }
      const discordant = wins + losses;
      // Two standard deviations of a fair coin over the disagreeing cases.
      const needed = Math.ceil(discordant / 2 + Math.sqrt(discordant) + 1);
      if (discordant === 0) delta = `  unchanged (was ${rateBefore.toFixed(0)}%)`;
      else if (wins >= needed) delta = `  BETTER: ${wins} up, ${losses} down (was ${rateBefore.toFixed(0)}%)`;
      else if (losses >= needed) {
        delta = `  WORSE: ${losses} down, ${wins} up (was ${rateBefore.toFixed(0)}%)`;
        regressed = true;
      } else {
        delta = `  no difference to see: ${wins} up, ${losses} down of ${discordant} changed (was ${rateBefore.toFixed(0)}%)`;
      }
    }
    // Two numbers: resolved at all, and resolved without having to ask.
    const asked = one.passed - one.straightAway;
    const straight = `${((one.straightAway / one.runs) * 100).toFixed(0)}%`;
    lines.push(
      `${String(one.passed).padStart(3)}/${String(one.runs).padEnd(3)} ${rate.toFixed(0).padStart(3)}%±${marginOf(one.passed, one.runs).toFixed(0).padStart(2)}  ` +
        `(${straight.padStart(4)} straight away${asked > 0 ? `, ${asked} after a question` : ""})  ${template} (${one.channel})${delta}`,
    );
    for (const why of [...new Set(one.failures)]) lines.push(`             ${why}`);
  }
  const total = results.reduce((sum, one) => sum + one.passed, 0);
  const of = results.reduce((sum, one) => sum + one.runs, 0);
  lines.push(`\noverall ${total}/${of} (${((total / of) * 100).toFixed(0)}%) in ${Math.round((Date.now() - started) / 1000)}s`);
  // Priced from `site/config.json`'s own rates, so this is the arithmetic
  // /admin does rather than a second opinion about what a token costs.
  if (spent.input + spent.output > 0) {
    const { loadServerConfig } = await import("../lib/config");
    const price = loadServerConfig().costs.models["claude-haiku-4-5"];
    const rappen = price
      ? (spent.input * price.inputPerMillionRappen + spent.output * price.outputPerMillionRappen) / 1_000_000
      : 0;
    lines.push(
      `spent ${(spent.input / 1000).toFixed(0)}k in / ${(spent.output / 1000).toFixed(0)}k out` +
        (rappen ? ` = ${(rappen / 100).toFixed(2)} CHF` : ""),
    );
  }
  // Through stderr, because `--show` is the only thing allowed to own stdout
  // and the report must print either way.
  console.error(lines.join("\n"));

  if (OUT) {
    const file = path.resolve(root, OUT);
    if (path.relative(root, file).startsWith("..")) die("--out must stay inside the repository.");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ runs: RUNS, overall: `${total}/${of}`, results }, null, 2)}\n`);
    console.error(`\nWrote ${path.relative(root, file)}.`);
  }
  // A regression is what makes this runnable before a merge rather than only
  // during an investigation.
  process.exit(regressed ? 1 : 0);
}

await main();
