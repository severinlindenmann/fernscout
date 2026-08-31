#!/usr/bin/env node
// Rasterise an SVG at real favicon sizes and blow the *bitmap* up, so you can
// see what a browser tab actually shows.
//
//   node .claude/skills/apply-the-brand/favicon-check.mjs docs/branding/icon-waymark.svg
//
// Scaling the vector up instead re-renders it sharply and tells you nothing —
// the whole point is to look at the 16x16 pixel grid, where thin strokes and
// interior detail disappear.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir, homedir } from "node:os";

const svgPath = process.argv[2];
if (!svgPath) {
  console.error("usage: favicon-check.mjs <path-to.svg> [more.svg ...]");
  process.exit(1);
}
const inputs = process.argv.slice(2);

/** Chromium ships with Playwright; the MCP browser downloads one too.
 *  The headless shell is strongly preferred — full Chrome/Chromium hangs on
 *  the legacy `--headless` flag instead of exiting after the screenshot. */
function findChromium() {
  const roots = [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
  ].filter(existsSync);
  const shells = [
    "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "chrome-headless-shell-mac-x64/chrome-headless-shell",
    "chrome-headless-shell-linux/chrome-headless-shell",
  ];
  const full = [
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-linux/chrome",
  ];
  // Two passes: every headless shell anywhere beats any full browser.
  for (const candidates of [shells, full]) {
    for (const root of roots) {
      for (const dir of readdirSync(root)) {
        for (const rel of candidates) {
          const p = join(root, dir, rel);
          if (existsSync(p)) return p;
        }
      }
    }
  }
  for (const p of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

const chromium = findChromium();
if (!chromium) {
  console.error(
    "No Chromium found. Install one with `npx playwright install chromium`,\n" +
      "or open the generated HTML by hand — the path is printed below either way.",
  );
}

const SIZES = [16, 24, 32];
const cards = inputs
  .map((f, i) => {
    const svg = readFileSync(f, "utf8");
    const cells = SIZES.map(
      (s) =>
        `<figure><canvas width="${s}" height="${s}" data-i="${i}" data-s="${s}"></canvas><figcaption>${s}px</figcaption></figure>`,
    ).join("");
    return `<section><h2>${basename(f)}</h2><div class="live">${svg}</div><div class="grid">${cells}</div></section>`;
  })
  .join("");

const html = `<!doctype html><meta charset="utf-8"><style>
body{background:#fffaf0;color:#1e293b;font:14px system-ui;margin:0;padding:26px;display:flex;gap:34px;align-items:flex-start}
section{display:flex;flex-direction:column;gap:14px}
h2{font-size:13px;margin:0;font-family:ui-monospace,Menlo,monospace}
.live svg{width:64px;height:64px}
.grid{display:flex;gap:14px}
figure{margin:0;text-align:center}
canvas{image-rendering:pixelated;width:128px;height:128px;border:1px solid #d8dee8;border-radius:4px}
figcaption{font-size:11px;color:#5a6a80;margin-top:5px}
</style>${cards}
<script>
const svgs=[...document.querySelectorAll('.live svg')];
let pending=0, done=0;
svgs.forEach((svg,i)=>{
  const img=new Image();
  pending++;
  img.onload=()=>{
    document.querySelectorAll('canvas[data-i="'+i+'"]').forEach(c=>{
      const s=+c.dataset.s, x=c.getContext('2d');
      x.imageSmoothingEnabled=false;
      x.clearRect(0,0,s,s);
      x.drawImage(img,0,0,s,s);   // TRUE rasterisation at s px; CSS blows it up
    });
    if(++done===pending) document.title='ready';
  };
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
});
</script>`;

const htmlPath = join(tmpdir(), `favicon-check-${process.pid}.html`);
writeFileSync(htmlPath, html);

const out = "favicon-check.png";
if (chromium) {
  const width = 220 + inputs.length * 480;
  execFileSync(
    chromium,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--user-data-dir=${join(tmpdir(), "favicon-check-profile")}`,
      `--window-size=${width},330`,
      "--virtual-time-budget=6000",
      `--screenshot=${out}`,
      `file://${htmlPath}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 },
  );
  console.log(`wrote ${out} — open it and look at the 16px column.`);
}
console.log(`harness: file://${htmlPath}`);
