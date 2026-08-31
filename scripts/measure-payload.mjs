// Measures what a reader actually downloads.
//
//   node scripts/measure-payload.mjs
//
// Builds the app twice — once against the real content, once against a
// generated 200-day trip — starts each and records the bytes of HTML for the
// story page and the bytes of JavaScript referenced by /costs. Prints a table.
//
// Slow (two production builds) and therefore not a test; the assertions that
// guard this live in test/payload.test.ts.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-measure-"));

/** Waits for the server to answer, then returns. */
async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never came up at ${url}`);
}

/** Every <script src> and modulepreload the page pulls, summed. */
async function jsBytes(origin, pathname) {
  const html = await (await fetch(origin + pathname)).text();
  const srcs = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) srcs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="preload"[^>]+href="([^"]+\.js)"/g))
    srcs.add(m[1]);
  let total = 0;
  const files = [];
  for (const src of srcs) {
    const res = await fetch(src.startsWith("http") ? src : origin + src);
    const buf = Buffer.from(await res.arrayBuffer());
    total += buf.length;
    files.push([src, buf.length]);
  }
  return { total, files, count: srcs.size };
}

/** Does any script on this page contain the baked world outline? */
async function pageHasLandData(origin, pathname) {
  const html = await (await fetch(origin + pathname)).text();
  const srcs = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) srcs.add(m[1]);
  for (const src of srcs) {
    const body = await (await fetch(src.startsWith("http") ? src : origin + src)).text();
    // The outline is a long list of SVG path strings — "M x,y L x,y … Z",
    // thousands of segments in all.
    const hits = body.match(/ L-?\d+(\.\d+)?,-?\d+(\.\d+)?/g);
    if (hits && hits.length > 500) return src;
  }
  return null;
}

async function measure({ label, contentDir, storyPath, costsPath, port }) {
  const env = { ...process.env, CONTENT_DIR: contentDir, NEXT_TELEMETRY_DISABLED: "1" };

  // One .next at a time: distDir is a config option, not an environment
  // variable, so the two builds have to run in sequence.
  console.error(`\n[${label}] building…`);
  const build = spawnSync("npx", ["next", "build"], { env, cwd: root, stdio: "inherit" });
  if (build.status !== 0) throw new Error(`build failed for ${label}`);

  const server = spawn("npx", ["next", "start", "-p", String(port)], {
    env,
    cwd: root,
    stdio: "ignore",
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitFor(origin + storyPath);
    const res = await fetch(origin + storyPath);
    // A 404 would "measure" an error page and quietly report a huge win.
    if (!res.ok) throw new Error(`${label}: ${storyPath} answered ${res.status}`);
    const html = await res.text();
    const costs = await jsBytes(origin, costsPath);
    const story = await jsBytes(origin, storyPath);
    const land = await pageHasLandData(origin, costsPath);
    return { label, htmlBytes: Buffer.byteLength(html), costs, story, land };
  } finally {
    server.kill("SIGTERM");
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const fixture = path.join(tmp, "content-200");
spawnSync("node", ["scripts/make-scale-fixture.mjs", fixture, "200"], {
  cwd: root,
  stdio: "inherit",
});

/** The journal to measure: this instance's default user, or the demo. */
const defaultUser =
  JSON.parse(fs.readFileSync(path.join(root, "content", "config.json"), "utf8")).site
    ?.defaultUser ?? "example";

const results = [];
results.push(
  await measure({
    label: "real-13-days",
    contentDir: path.join(root, "content"),
    // Whoever this instance serves by default — never a username written into
    // the script, which would measure nothing on anybody else's clone.
    storyPath: `/${defaultUser}`,
    costsPath: `/${defaultUser}/costs`,
    port: 4311,
  }),
);
results.push(
  await measure({
    label: "generated-200-days",
    contentDir: fixture,
    storyPath: "/traveller",
    costsPath: "/traveller/costs",
    port: 4312,
  }),
);

console.log("\n=== payload ===");
for (const r of results) {
  console.log(
    `${r.label.padEnd(20)} story HTML ${kb(r.htmlBytes).padStart(10)}   ` +
      `story JS ${kb(r.story.total).padStart(10)}   ` +
      `/costs JS ${kb(r.costs.total).padStart(10)} (${r.costs.count} files)   ` +
      `land data on /costs: ${r.land ?? "no"}`,
  );
}
const [a, b] = results;
if (a && b) {
  const perDay = (b.htmlBytes - a.htmlBytes) / (200 - 12);
  console.log(`\nmarginal HTML per extra day: ${perDay.toFixed(0)} bytes`);
}
fs.rmSync(tmp, { recursive: true, force: true });
