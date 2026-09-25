/**
 * Describes photographs that are already in a journal, without spending a
 * credit or calling the instance.
 *
 *   npx tsx --conditions=react-server scripts/describe-backfill.mts \
 *     --user alex --trips ungarn-2026,asia-2018 --plan /tmp/backfill
 *   …agents write one JSON per photograph into /tmp/backfill/answers…
 *   npx tsx --conditions=react-server scripts/describe-backfill.mts \
 *     --user alex --apply /tmp/backfill
 *
 * Why it exists: `describeImage` (B1866) is the product's path and charges a
 * credit per ten photographs, which is right for a photograph arriving today
 * and wrong for fifteen hundred that arrived over four years. This does the
 * same work through agents the owner already pays for, and writes the same
 * `described` block the product would have written — same schema, same
 * validation, same provenance fields, so nothing downstream can tell which
 * route a block came from except by reading `model`.
 *
 * `--plan` writes a proof copy of each photograph (1100 px, which is where a
 * vision model's accuracy stops improving for this kind of question) plus a
 * manifest. `--apply` validates every answer against `describedFormSchema`
 * and refuses the file if it does not fit, because a backfill that writes
 * malformed blocks is worse than no backfill.
 *
 * It never overwrites a `described` block that is already there, and it never
 * touches `authored`: a person's words outrank a machine's, always.
 *
 * `--image-facts` is the same walk doing a different and far cheaper job —
 * B1955. No model, no credit, no proofs, no answers: just `measureImage`
 * (B1865) over files already on disk, through `imageFactsFor` so a photograph
 * that already carries a `version: 1` block is left alone and a second run
 * writes nothing.
 *
 *   npx tsx --conditions=react-server scripts/describe-backfill.mts \
 *     --user alex --image-facts
 *
 * `--signals` (with `--plan` or `--apply`) is the 2026-09-22 backfill: only
 * photographs whose block has no `subject` are planned (a photograph with no
 * `described` block at all is planned too, since applying gives it a full
 * one), and applying merges `subject`, `people` and `printworthiness` into
 * the block that is there.
 *
 *   npx tsx --conditions=react-server scripts/describe-backfill.mts \
 *     --user alex --signals --plan /tmp/signals
 *
 * A `--signals` manifest carries the three fields `describedFormSchema` now
 * requires, next to `tags`, so an answering agent working from an old batch's
 * shape is not silently refused:
 *
 *   "signals": {
 *     "subject": "{x,y,width,height} fractions of the frame, top-left origin, or null",
 *     "people": "integer >= 0",
 *     "printworthiness": "integer 1-5"
 *   }
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import sharp from "sharp";

import { contentRoot } from "../lib/contentRoot.ts";
import { tripRef } from "../lib/trips.ts";
import { imageFactsFor, readTripSidecar, writeTripSidecar } from "../lib/sidecar.ts";
import { captionIsEmpty, clampSignals, DESCRIBED_SCHEMA_VERSION, DESCRIBED_TAG_VOCABULARY, describedFormSchema } from "../lib/photos/described.ts";
import { loadUserConfig } from "../lib/config.ts";
import { contentHash } from "../lib/ingest/hash.ts";

const PROOF_EDGE = 1100;
const BATCH = 18;
/** What a person's agent run is, told apart from `describeImage`'s own calls. */
const MODEL_LABEL = "agent:claude-haiku-4-5";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function required(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`--${name} <value> is required`);
    process.exit(1);
  }
  return value;
}

const user = required("user");

const planDir = arg("plan");
const applyDir = arg("apply");
const imageFacts = process.argv.includes("--image-facts");
/** Only the three signals of 2026-09-22, onto blocks that predate them.
 *  Texts are never rewritten: a caption somebody already read stays. */
const signalsOnly = process.argv.includes("--signals");
if (!planDir && !applyDir && !imageFacts) {
  console.error("give me --plan <dir>, --apply <dir> or --image-facts");
  process.exit(1);
}

const locales = loadUserConfig(user).locales ?? ["de"];
const schema = describedFormSchema(locales);

type Item = { id: string; trip: string; rel: string; proof: string; hash: string };

function tripsWanted(): string[] {
  const named = arg("trips");
  const root = path.join(contentRoot(), user, "trips");
  const all = fs.existsSync(root) ? fs.readdirSync(root).filter(t => fs.statSync(path.join(root, t)).isDirectory()) : [];
  if (!named) return all;
  const want = new Set(named.split(",").map(s => s.trim()));
  return all.filter(t => want.has(t));
}

/** Every photograph under a trip's media directory that `done` does not already
 *  answer for. Posters are skipped: a frame lifted from a clip is not a
 *  photograph anybody chose. */
function pending(trip: string, done: (s: ReturnType<typeof readTripSidecar>) => boolean): { rel: string; abs: string }[] {
  const ref = tripRef(user, trip);
  const media = path.join(contentRoot(), user, "trips", trip, "media");
  if (!fs.existsSync(media)) return [];
  const out: { rel: string; abs: string }[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) { walk(abs); continue; }
      if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
      if (/-poster\.jpg$/i.test(name)) continue;
      const rel = path.relative(media, abs).split(path.sep).join("/");
      if (done(readTripSidecar(ref, rel))) continue;
      out.push({ rel, abs });
    }
  };
  walk(media);
  return out;
}

if (planDir) {
  const proofs = path.join(planDir, "proofs");
  fs.mkdirSync(proofs, { recursive: true });
  fs.mkdirSync(path.join(planDir, "answers"), { recursive: true });

  const items: Item[] = [];
  for (const trip of tripsWanted()) {
    for (const { rel, abs } of pending(trip, (s) => {
      const block = s?.described;
      return Boolean(block) && !(signalsOnly && block!.subject === undefined);
    })) {
      const id = crypto.createHash("sha256").update(`${trip}/${rel}`).digest("hex").slice(0, 16);
      const proof = path.join(proofs, `${id}.jpg`);
      if (!fs.existsSync(proof)) {
        await sharp(fs.readFileSync(abs))
          .rotate()
          .resize({ width: PROOF_EDGE, height: PROOF_EDGE, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 78 })
          .toFile(proof);
      }
      // The identity the product's own cache would use, so a block written
      // here and one written by describeImage are answerable the same way.
      items.push({ id, trip, rel, proof, hash: contentHash(new Uint8Array(fs.readFileSync(abs))) });
    }
  }

  const batches: Item[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  const signals = {
    subject: "{x,y,width,height} fractions of the frame, top-left origin, or null",
    people: "integer >= 0",
    printworthiness: "integer 1-5",
  };
  fs.writeFileSync(path.join(planDir, "manifest.json"),
    JSON.stringify({ user, locales, tags: DESCRIBED_TAG_VOCABULARY, signals, signalsOnly, batches }, null, 1));

  console.log(`${items.length} photographs without a ${signalsOnly ? "subject box" : "description"}, in ${batches.length} batches of up to ${BATCH}.`);
  for (const [i, b] of batches.entries()) console.log(`  batch ${i}: ${b.length}`);
  console.log(`\nmanifest: ${path.join(planDir, "manifest.json")}`);
}

if (applyDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(applyDir, "manifest.json"), "utf8")) as {
    batches: Item[][];
    signalsOnly?: boolean;
  };
  const answers = path.join(applyDir, "answers");
  let written = 0, missing = 0, refused = 0;

  for (const item of manifest.batches.flat()) {
    const file = path.join(answers, `${item.id}.json`);
    if (!fs.existsSync(file)) { missing++; continue; }
    let parsed;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      // `longDescription: null` is the shorthand a describer reaches for when
      // an image needs no long form, and it means exactly what the per-locale
      // object of nulls means. Widen it here rather than refuse eighteen
      // otherwise-good answers over a shape nobody could misread.
      if (raw.longDescription === null || raw.longDescription === undefined) {
        raw.longDescription = Object.fromEntries(locales.map((code) => [code, null]));
      }
      parsed = schema.safeParse(raw);
    } catch (err) {
      console.warn(`  refused ${item.id}: not JSON — ${(err as Error).message}`);
      refused++; continue;
    }
    if (!parsed.success) {
      console.warn(`  refused ${item.id}: ${parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      refused++; continue;
    }
    // An answer with no caption is refused like a malformed one — B1923: a
    // written block is cached forever, so nothing is better than nothing.
    if (captionIsEmpty(parsed.data)) {
      console.warn(`  refused ${item.id}: caption is empty`);
      refused++; continue;
    }
    // Tags outside the vocabulary are dropped rather than refused: a stray
    // word is not a reason to throw away four usable sentences.
    const tags = parsed.data.tags.filter(t => (DESCRIBED_TAG_VOCABULARY as readonly string[]).includes(t));
    const ref = tripRef(user, item.trip);
    const existing = readTripSidecar(ref, item.rel)?.described;
    const signals = clampSignals(parsed.data);
    if (existing && manifest.signalsOnly) {
      // Only the three fields. `writeTripSidecar` merges at the top level,
      // so the whole block is re-sent with them added; nothing else changes.
      writeTripSidecar(ref, item.rel, {
        described: { ...existing, subject: signals.subject, people: signals.people, printworthiness: signals.printworthiness },
      });
      written++;
      continue;
    }
    if (existing) continue; // never overwrite a full block
    writeTripSidecar(ref, item.rel, {
      described: {
        ...signals,
        tags,
        at: new Date().toISOString(),
        model: MODEL_LABEL,
        schemaVersion: DESCRIBED_SCHEMA_VERSION,
        contentHash: item.hash,
      },
    });
    written++;
  }
  console.log(`wrote ${written}, still missing an answer ${missing}, refused ${refused}`);
}

/**
 * `--image-facts` — B1955.
 *
 * `imageFactsFor` decides cached-or-compute and writes the block itself, so
 * this only has to find the files and count what happened. The extra
 * `readTripSidecar` before the call is for the count alone: without it
 * "already present" and "measured just now" are the same answer.
 *
 * A file that will not decode is counted and skipped. Nothing here may remove
 * a photograph or fail the run, and nothing here writes any block but `image`.
 */
if (imageFacts) {
  let measured = 0, present = 0, failed = 0;
  for (const trip of tripsWanted()) {
    const ref = tripRef(user, trip);
    let m = 0, p = 0, f = 0;
    for (const { rel, abs } of pending(trip, () => false)) {
      if (readTripSidecar(ref, rel)?.image?.version === 1) { p++; continue; }
      if (await imageFactsFor(ref, rel, abs)) m++;
      else { f++; console.warn(`  failed to measure ${trip}/${rel}`); }
    }
    measured += m; present += p; failed += f;
    if (m + p + f > 0) console.log(`${trip}: measured ${m}, already present ${p}, failed ${f}`);
  }
  console.log(`\nmeasured ${measured}, already present ${present}, failed ${failed}`);
  if (measured === 0 && failed === 0) console.log("nothing to do — every photograph is already measured.");
}
