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
    /** Ticked in the files pane — web only. */
    select?: string;
    /** Sent as a WhatsApp contacts message before the turns — whatsapp only. */
    share?: string;
  };
  turns: string[];
  expect: Expectation;
};

type Outcome = {
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
  const { writeTripFixture } = await import("../test/fixtures/content");

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
    return await body({ username, dir: data, contactIds });
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
    let last: Outcome = { tools: [], proposed: [], answer: "" };

    for (const said of scenario.turns) {
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
      last = {
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
    for (const said of scenario.turns) {
      await handleInboundMessage({ kind: "text", id: id(), from: tel, timestamp: "1700000000", body: said });
      if (peekPendingProposal(username, tel)) break;
    }

    const pending = peekPendingProposal(username, tel);
    // Everything this turn actually sent, joined the way a person reads several
    // bubbles in a row — `dispatch.ts` joins its own record the same way.
    const answer = repliesTo(dir, username).slice(before).join("\n\n");
    forget(username);
    return {
      tools: pending ? [pending.tool] : [],
      proposed: pending ? [{ tool: pending.tool, args: pending.arguments }] : [],
      answer,
    };
  });
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
  for (const template of templates) {
    const name = template.world.share ?? template.world.select ?? template.world.contacts?.[0]?.name ?? "";
    const trip = template.world.trips?.[0]?.title ?? "";
    const fill = (text: string) => text.replaceAll("{name}", name).replaceAll("{trip}", trip);
    for (const channel of template.channels) {
      for (const [locale, wordings] of Object.entries(template.says)) {
        wordings.forEach((wording, n) => {
          out.push({
            id: `${template.id}/${channel}/${locale}/${n}`,
            template: template.id,
            why: template.why,
            channel,
            world: { ...template.world, locale },
            turns: (Array.isArray(wording) ? wording : [wording]).map(fill),
            expect: template.expect,
          });
        });
      }
    }
  }
  return out;
}

type Result = { id: string; template: string; channel: string; passed: number; runs: number; failures: string[] };

async function runCases(cases: Scenario[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const scenario of cases) {
    const failures: string[] = [];
    let passed = 0;
    for (let run = 0; run < RUNS; run++) {
      let outcome: Outcome;
      try {
        outcome = scenario.channel === "web" ? await runWeb(scenario) : await runWhatsapp(scenario);
      } catch (thrown) {
        failures.push(`threw: ${(thrown as Error).message}`);
        continue;
      }
      const verdict = judge(outcome, scenario.expect);
      if (verdict.pass) passed++;
      else {
        failures.push(verdict.why);
        if (SHOW)
          console.error(
            `\n  [${scenario.id}] ${verdict.why}\n  said: ${scenario.turns.join(" | ")}\n  answer: ${outcome.answer.replace(/\n/g, " ").slice(0, 300)}\n`,
          );
      }
    }
    results.push({ id: scenario.id, template: scenario.template, channel: scenario.channel, passed, runs: RUNS, failures });
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
    all.push(...(JSON.parse(fs.readFileSync(file, "utf8")) as Result[]));
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
function byTemplate(results: Result[]): Map<string, { passed: number; runs: number; failures: string[]; channel: string }> {
  const rolled = new Map<string, { passed: number; runs: number; failures: string[]; channel: string }>();
  for (const one of results) {
    const at = rolled.get(one.template) ?? { passed: 0, runs: 0, failures: [], channel: one.channel };
    at.passed += one.passed;
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
    fs.writeFileSync(RESULT_FILE, JSON.stringify(await runCases(cases)));
    process.exit(0);
  }

  const started = Date.now();
  console.error(
    `helper-bench: ${cases.length} case(s) x ${RUNS} run(s)${JOBS > 1 ? `, ${JOBS} jobs` : ""}. ` +
      `This spends credits — one model turn per conversation turn, plus one small routing call each.\n`,
  );
  const results = JOBS > 1 ? await runInJobs(cases) : await runCases(cases);
  process.stderr.write("\n\n");

  const rolled = byTemplate(results);
  const previous = AGAINST
    ? byTemplate((JSON.parse(fs.readFileSync(path.resolve(root, AGAINST), "utf8")) as { results: Result[] }).results)
    : null;
  let regressed = false;
  const lines: string[] = [];

  for (const [template, one] of rolled) {
    const rate = (one.passed / one.runs) * 100;
    let delta = "";
    if (previous?.has(template)) {
      const was = previous.get(template) as { passed: number; runs: number };
      const before = (was.passed / was.runs) * 100;
      const change = rate - before;
      // One case moving by one run is not a finding — B1744 paid for that
      // lesson twice. Ten points is the smallest change worth printing.
      if (change <= -10) {
        delta = `  WORSE (was ${before.toFixed(0)}%)`;
        regressed = true;
      } else if (change >= 10) delta = `  better (was ${before.toFixed(0)}%)`;
    }
    lines.push(
      `${String(one.passed).padStart(3)}/${String(one.runs).padEnd(3)} ${rate.toFixed(0).padStart(3)}%  ${template} (${one.channel})${delta}`,
    );
    for (const why of [...new Set(one.failures)]) lines.push(`             ${why}`);
  }
  const total = results.reduce((sum, one) => sum + one.passed, 0);
  const of = results.reduce((sum, one) => sum + one.runs, 0);
  lines.push(`\noverall ${total}/${of} (${((total / of) * 100).toFixed(0)}%) in ${Math.round((Date.now() - started) / 1000)}s`);
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
