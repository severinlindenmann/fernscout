/**
 * Does the conversation still do the right thing? — B1744.
 *
 *   npm run helper:bench                      # the whole corpus, 5 runs each
 *   npm run helper:bench -- --runs 20         # enough to beat the noise
 *   npm run helper:bench -- --only card-to-trip-vague
 *   npm run helper:bench -- --channel web
 *   npm run helper:bench -- --show           # the answer behind every failure
 *   npm run helper:bench -- --out docs/benchmarks/helper-behaviour/baseline.json
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

type Scenario = {
  id: string;
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

const RUNS = Number(flag("runs") ?? "5");

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
const nextMessageId = (scenario: string) => `wamid.bench.${scenario}.${messageSeq++}`;
const ONLY = flag("only");
const CHANNEL = flag("channel");
const OUT = flag("out");
/** Print the answer behind every failure — what to reach for before guessing
 *  at a prompt. A pass rate says something is wrong; this says what. */
const SHOW = args.includes("--show");

/**
 * One throwaway journal per run — the same discipline `test/whatsapp-*.test.ts`
 * follow, for the same reason: a scenario that inherits the last one's trips,
 * inbox or thread is not the scenario it says it is.
 */
async function withWorld<T>(
  scenario: Scenario,
  body: (ctx: { username: string; dir: string; contactIds: Record<string, string> }) => Promise<T>,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-bench-"));
  const username = "bench";
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "bench.db")}`;
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
    return await body({ username, dir, contactIds });
  } finally {
    await closeDatabase();
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
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

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    die("ANTHROPIC_API_KEY is not set. This benchmark calls a real model and spends real money.");
  }
  const corpus = JSON.parse(fs.readFileSync(corpusFile, "utf8")) as { scenarios: Scenario[] };
  const chosen = corpus.scenarios
    .filter((one) => !ONLY || one.id === ONLY)
    .filter((one) => !CHANNEL || one.channel === CHANNEL);
  if (chosen.length === 0) die("no scenario matched --only/--channel.");

  console.log(`helper-bench: ${chosen.length} scenario(s) x ${RUNS} run(s). This spends credits.\n`);
  const results: { id: string; channel: string; passed: number; runs: number; failures: string[] }[] = [];

  for (const scenario of chosen) {
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
        if (SHOW) console.log(`\n  [${scenario.id}] ${verdict.why}\n  tools: ${outcome.tools.join(",") || "none"}\n  answer: ${outcome.answer.replace(/\n/g, " ").slice(0, 300)}\n`);
      }
      process.stdout.write(verdict.pass ? "." : "x");
    }
    process.stdout.write("\n");
    results.push({ id: scenario.id, channel: scenario.channel, passed, runs: RUNS, failures });
  }

  console.log("");
  for (const result of results) {
    const rate = ((result.passed / result.runs) * 100).toFixed(0);
    console.log(`${result.passed}/${result.runs}  ${rate.padStart(3)}%  ${result.id} (${result.channel})`);
    // Only the distinct reasons: twenty runs failing the same way is one fact.
    for (const why of [...new Set(result.failures)]) console.log(`            ${why}`);
  }
  const total = results.reduce((sum, one) => sum + one.passed, 0);
  const of = results.reduce((sum, one) => sum + one.runs, 0);
  console.log(`\noverall ${total}/${of} (${((total / of) * 100).toFixed(0)}%)`);

  if (OUT) {
    const file = path.resolve(root, OUT);
    const relative = path.relative(root, file);
    if (relative.startsWith("..")) die("--out must stay inside the repository.");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ runs: RUNS, results }, null, 2)}\n`);
    console.log(`\nWrote ${relative}.`);
  }
  process.exit(0);
}

await main();
