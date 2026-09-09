import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Everything the owner's own conversation reads, it reads as the owner — B959.
 *
 * `trip_costs` called `getCostSummary` with no `ReadOptions`, so it read the
 * trip as an anonymous visitor and **costs on a day still in draft were
 * invisible** — in the owner's own conversation, about their own money. The
 * write-up case is exactly the one it breaks: somebody logging what they spent
 * as they write, before publishing anything.
 *
 * Three answers in one session, every one of them false: *"the total is 0 CHF
 * because nothing has been saved yet"* with two costs on disk, *"nothing has
 * been recorded yet"* with four, and *"31 CHF"* with six — the two that
 * happened to be on published days.
 *
 * The reason this is a source test rather than a behavioural one: the fault is
 * an **omission**, and an omission has no behaviour of its own to drive. Every
 * other read in the file passed `AS_AUTHOR` and this one did not, for a year,
 * because nothing was looking. A test that reads the file is what looks.
 */

/**
 * **Every file in the registry** — B1042 split it into areas, and a guard that
 * reads one file while capabilities are added in six others is checking a
 * sixth of the thing it claims to check.
 */
const ROOT = path.join(process.cwd(), "lib/helper/tools");

function registrySource(): string {
  return fs
    .readdirSync(ROOT, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => fs.readFileSync(path.join(ROOT, name), "utf8"))
    .join("\n");
}

/** Every call to a content reader in the registry, with its arguments. */
function readsIn(source: string): { call: string; args: string }[] {
  const found: { call: string; args: string }[] = [];
  for (const name of ["getAllEntries", "getCostSummary", "getAllCosts", "getEntryBySlug"]) {
    for (const at of source.matchAll(new RegExp(`\\b${name}\\(`, "g"))) {
      // Balance the parentheses so a nested call does not truncate the match.
      let depth = 0;
      let end = at.index! + at[0].length - 1;
      for (; end < source.length; end += 1) {
        if (source[end] === "(") depth += 1;
        else if (source[end] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      found.push({ call: name, args: source.slice(at.index! + at[0].length, end) });
    }
  }
  return found;
}

describe("the reader every tool in the registry reads as", () => {
  const source = registrySource();

  test("there is something to check", () => {
    expect(readsIn(source).length).toBeGreaterThan(3);
  });

  for (const { call, args } of readsIn(registrySource())) {
    test(`${call}(${args.replace(/\s+/g, " ").slice(0, 60)}) says whose eyes it reads with`, () => {
      // `AS_AUTHOR` is the whole assertion. This file is the owner's own
      // conversation: there is no caller here for whom the public view is the
      // right one, and a read that does not say so is a read that forgot.
      expect(args).toContain("AS_AUTHOR");
    });
  }
});
