/**
 * Renders postcards from the road.
 *
 *   npm run postcard -- --photo <file> --message "..." --to <recipients.json>
 *   npm run postcard -- --photo <file> --message "..." --to <file> --guides
 *   npm run postcard -- --providers
 *
 * The default backend is `dry-run`: it writes print-ready PDFs to
 * content/<user>/postcards and calls nobody. That is the whole pipeline minus
 * the account, which is on purpose — see docs/providers/postcards.md.
 *
 * Recipients are a JSON array of postal addresses. Once the contacts work
 * lands (W10) this reads from the contacts table instead, and the file becomes
 * the fallback for people who would rather keep a file.
 */
import fs from "node:fs";
import path from "node:path";
import { renderPostcard, type PostalAddress } from "../lib/postcard/render.ts";
import { availableProviders, buildStannpRequest } from "../lib/postcard/providers.ts";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readRecipients(file: string): PostalAddress[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(`Could not read ${file}: ${(err as Error).message}`);
  }
  if (!Array.isArray(raw)) fail(`${file} must contain a JSON array of addresses.`);

  return (raw as Record<string, unknown>[]).map((entry, i) => {
    for (const key of ["name", "line1", "postcode", "city"]) {
      if (typeof entry[key] !== "string" || !entry[key]) {
        fail(`${file}[${i}] is missing "${key}". Every address needs name, line1, postcode, city.`);
      }
    }
    return entry as unknown as PostalAddress;
  });
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const args = parseArgs(process.argv.slice(2));

if (args.providers) {
  console.log("Postcard providers:\n");
  for (const [name, state] of Object.entries(availableProviders())) {
    console.log(`  ${state.ready ? "ready" : "needs setup"}  ${name}\n      ${state.note}\n`);
  }
  process.exit(0);
}

const photoPath = typeof args.photo === "string" ? args.photo : undefined;
const message = typeof args.message === "string" ? args.message : undefined;
const toPath = typeof args.to === "string" ? args.to : undefined;
const backend = typeof args.backend === "string" ? args.backend : "dry-run";
const from = typeof args.from === "string" ? args.from : "";
const owner = typeof args.user === "string" ? args.user : "";

if (!photoPath || !message || !toPath || !owner) {
  fail(
    'Usage: npm run postcard -- --user <username> --photo <file.jpg> \\\n' +
      '                          --message "..." --to <recipients.json>\n' +
      "       npm run postcard -- --providers",
  );
}
if (backend !== "dry-run") {
  const state = availableProviders()[backend as keyof ReturnType<typeof availableProviders>];
  fail(
    state
      ? `The "${backend}" backend is not connected yet.\n  ${state.note}\n` +
          `Run with --backend dry-run to produce the files, or see docs/providers/postcards.md.`
      : `Unknown backend "${backend}". Try --providers.`,
  );
}

const photo = new Uint8Array(fs.readFileSync(photoPath));
const recipients = readRecipients(toPath);
// A rendered postcard carries somebody's home address, so it lives under the
// user who sent it rather than in a directory shared by everyone on the
// instance — and it is gitignored there.
const outDir = path.join(process.cwd(), "content", owner, "postcards");
fs.mkdirSync(outDir, { recursive: true });

console.log(`Rendering ${recipients.length} postcard(s) with the ${backend} backend.\n`);

let lowResolution = false;
for (const to of recipients) {
  const result = renderPostcard({
    photo,
    message,
    from,
    to,
    guides: args.guides === true,
  });

  const base = path.join(outDir, slug(to.name));
  fs.writeFileSync(`${base}.pdf`, result.pdf);
  fs.writeFileSync(
    `${base}-front.pdf`,
    renderPostcard({ photo, message, from, to, sides: "front" }).pdf,
  );
  fs.writeFileSync(
    `${base}-back.pdf`,
    renderPostcard({ photo, message, from, to, sides: "back" }).pdf,
  );

  console.log(`  ${to.name} -> ${path.relative(process.cwd(), base)}.pdf`);
  for (const warning of result.warnings) {
    if (warning.code === "low-resolution") lowResolution = true;
    console.log(`      ! ${warning.detail}`);
  }

  // Built but not sent: this is what would go to the provider.
  const prepared = buildStannpRequest({ to, front: new Uint8Array(), back: new Uint8Array(), test: true });
  fs.writeFileSync(`${base}-stannp-request.json`, JSON.stringify(prepared, null, 2) + "\n");
}

console.log(`\nWrote ${recipients.length * 3} file(s) to content/${owner}/postcards/`);
console.log("Front and back are also written separately — Stannp takes them as two files.");
if (lowResolution) {
  console.log(
    "\nAt least one photo is below 300 DPI for this size. It will print soft.\n" +
      "Use the original from your camera rather than a web-sized copy.",
  );
}
