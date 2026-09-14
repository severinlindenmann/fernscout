import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache, loadServerConfig } from "@/lib/config";

/**
 * Who may be shown "start your own journal" over their trips — B1718.
 *
 * The list is the **operator's**, and the point of these tests is that it can
 * only ever be the operator's. `content/<user>/config.json` belongs to a
 * journal's owner and is writable over the API; `site/config.json` is read at
 * boot and written by nothing. Putting the flag in the first would have let
 * one person hang an advertisement over another person's photographs — or let
 * an owner opt a journal in for readers who never agreed to it.
 */

let dir: string;

function withSite(site: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "N", url: "https://x.test", ...site } }),
  );
  clearConfigCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-showcase-"));
  process.env.FERNSCOUT_CONFIG = path.join(dir, "config.json");
  clearConfigCache();
});

afterEach(() => {
  delete process.env.FERNSCOUT_CONFIG;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("site.showcase", () => {
  test("absent means nobody — a fork advertises on no journal at all", () => {
    withSite({});
    expect(loadServerConfig().site.showcase).toEqual([]);
  });

  test("names the journals the operator listed, trimmed", () => {
    withSite({ showcase: ["example", " second "] });
    expect(loadServerConfig().site.showcase).toEqual(["example", "second"]);
  });

  test("a malformed list refuses to boot rather than being half-honoured", () => {
    // The same bargain every other key in this file makes: a config that does
    // not parse stops the server with the reason, rather than starting with a
    // silently different meaning. An operator who mistyped the shape finds out
    // now, not months later when they notice the demo never asked anybody.
    withSite({ showcase: "example" });
    expect(() => loadServerConfig()).toThrow(/site\.showcase/);
    withSite({ showcase: ["example", ""] });
    expect(() => loadServerConfig()).toThrow(/site\.showcase/);
  });

  test("this instance ships the demo journal and nothing else", () => {
    delete process.env.FERNSCOUT_CONFIG;
    clearConfigCache();
    expect(loadServerConfig().site.showcase).toEqual(["example"]);
  });
});

describe("a showcase journal asks one thing, not two", () => {
  /**
   * B1724. `/example` offered "Get the next day?" to a reader who is not
   * following Alex Berger's trip — they are deciding whether to make a
   * journal of their own — and it landed on top of the bar that answers that
   * question. The layout picks one, so each journal carries exactly one of
   * the two in its document.
   */
  test("the layout renders the bar or the prompt, never both", () => {
    const layout = fs.readFileSync(
      path.join(process.cwd(), "app/[user]/layout.tsx"),
      "utf8",
    );
    // A ternary on the showcase list, not two independent conditions that
    // could both be true.
    expect(layout).toMatch(
      /site\.showcase\.includes\(username\)\s*\?[\s\S]{0,200}<ShowcaseBar[\s\S]{0,200}<PushPrompt/,
    );
    expect(layout.match(/<PushPrompt/g)).toHaveLength(1);
    expect(layout.match(/<ShowcaseBar/g)).toHaveLength(1);
  });

  test("and the prompt no longer carries an offset it can never need", () => {
    const prompt = fs.readFileSync(
      path.join(process.cwd(), "components/PushPrompt.tsx"),
      "utf8",
    );
    expect(prompt).not.toContain("--fs-showcase-bar");
    // The document's own room for the bar is a different question and stays.
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/body\s*\{\s*\n?\s*padding-bottom:\s*var\(--fs-showcase-bar/);
  });
});

describe("no API route can add a journal to the list", () => {
  /** Every file under `app/api/`, which is the whole of the network surface. */
  function routes(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return routes(full);
      return e.isFile() && /\.tsx?$/.test(e.name) ? [full] : [];
    });
  }

  test("the word does not appear under app/api at all", () => {
    const offenders = routes(path.join(process.cwd(), "app/api")).filter((file) =>
      fs.readFileSync(file, "utf8").includes("showcase"),
    );
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

});
