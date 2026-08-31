// Refreshes the cached European Central Bank reference rates.
//
//   npm run rates:update -- --dry-run
//
// This is a *refresh* script, never a build step. The build reads
// content/rates/ecb.json off disk and must succeed with no network at all —
// see lib/rates.ts. Run this occasionally, commit the result.
//
// The ECB publishes one euro-quoted table a day, free, with no API key:
// https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
// Every value is "units of this currency for one euro". Around 30 currencies
// are covered; anything outside that list gets a manual rate in
// content/config.json under site.manualRates.
import fs from "node:fs";
import path from "node:path";

/**
 * Where the table comes from.
 *
 * Overridable because not everyone can reach ecb.europa.eu: an air-gapped
 * install may hold a mirror, and CI should not need the open internet to check
 * that this script still writes where it says it does. The document format is
 * the ECB's either way.
 */
const URL =
  process.env.ECB_RATES_URL ||
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const ROOT = path.join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

/**
 * The document is a fixed, tiny shape that has not changed in twenty years,
 * so it is read with a regex rather than by adding an XML parser to the
 * dependency list for one file.
 */
function parseEcbXml(xml) {
  const date = xml.match(/<Cube\s+time=['"]([\d-]{10})['"]/)?.[1];
  if (!date) throw new Error("no <Cube time=…> in the ECB document");

  const rates = {};
  const re = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  for (const [, code, value] of xml.matchAll(re)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) rates[code] = n;
  }
  if (Object.keys(rates).length === 0) throw new Error("no rates in the ECB document");
  return { date, rates };
}

let xml;
try {
  const res = await fetch(URL, { headers: { accept: "application/xml" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  xml = await res.text();
} catch (err) {
  console.error(`Could not reach the ECB: ${err.message}`);
  console.error("The cached rates on disk are left exactly as they were.");
  process.exit(1);
}

const { date, rates } = parseEcbXml(xml);
const snapshot = {
  source: "European Central Bank euro foreign exchange reference rates",
  url: URL,
  base: "EUR",
  // The ECB's own publication date, which is what the site cites — not the
  // day this script happened to run.
  date,
  fetchedAt: new Date().toISOString(),
  note: "Units of each currency for one euro.",
  rates: Object.fromEntries(Object.entries(rates).sort(([a], [b]) => a.localeCompare(b))),
};

const json = `${JSON.stringify(snapshot, null, 2)}\n`;
const written = [];
// Rates are server-wide, not per user: they convert every journal's base
// currency into whatever a reader picked, so there is one cache for the
// instance rather than a copy under each person.
const file = path.join(ROOT, "content", "rates", "ecb.json");
if (!dryRun) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, json);
}
written.push(path.relative(ROOT, file));

console.log(
  `${dryRun ? "Would write" : "Wrote"} ${Object.keys(rates).length} rates ` +
    `for ${date}: ${written.join(", ") || "(nowhere — no content folder)"}`,
);
