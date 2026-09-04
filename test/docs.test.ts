import { describe, expect, test } from "vitest";
import { demote, dropTitle, readRepoFile, section } from "@/lib/docs";

/**
 * `app/docs/page.tsx` builds its content by extracting sections out of
 * `README.md` rather than retyping them, so the failure mode to guard
 * against is a heading changing shape underneath it and the page quietly
 * losing a section. `section()` throws instead of returning "" for exactly
 * that reason — these tests are what turn a rename in `README.md` into a
 * red build instead of a blank box on the live page.
 */

describe("section()", () => {
  test("extracts a known heading's body from README.md", () => {
    const readme = readRepoFile("README.md");
    const dayEntry = section(readme, "What a day looks like");
    // The exact example `/docs` shows a visitor: a frontmatter block with
    // the fields the task asked for by name.
    expect(dayEntry).toContain("time:");
    expect(dayEntry).toContain("lat:");
    expect(dayEntry).toContain("lng:");
    expect(dayEntry).toContain("```markdown");
  });

  test("stops at the next heading, not the whole rest of the file", () => {
    const readme = readRepoFile("README.md");
    const running = section(readme, "Running it");
    expect(running).toContain("npm run dev");
    // "Writing with an agent" is the next `##` — its own heading text must
    // not leak into the section above it.
    expect(running).not.toContain("Writing with an agent");
  });

  test("keeps a nested ### heading inside its parent ## section", () => {
    // docs/ingest.md's "## Options" contains a "### Notes files" subsection —
    // both must survive, and the cut has to land on the next `##` after them.
    const options = section(readRepoFile("docs/ingest.md"), "Options");
    expect(options).toContain("Notes files");
    expect(options).toContain("Name it after the");
    expect(options).not.toContain("Privacy: what reaches the internet");
  });

  test("a heading that does not exist fails loudly rather than silently", () => {
    expect(() => section("## Real heading\nbody", "Nonexistent heading")).toThrow();
  });
});

describe("demote()", () => {
  test("pushes every heading level down by one, leaving prose untouched", () => {
    const out = demote("# One\n\nbody\n\n## Two\n### Three\nNot a #heading — a word.");
    expect(out).toContain("## One");
    expect(out).toContain("### Two");
    expect(out).toContain("#### Three");
    // A `#` mid-sentence is not a heading and must not be touched.
    expect(out).toContain("Not a #heading — a word.");
  });

  test("demotes by an arbitrary number of levels", () => {
    const out = demote("## Two\n### Three", 2);
    expect(out).toContain("#### Two");
    expect(out).toContain("##### Three");
  });

  test("never demotes past ######, markdown's own ceiling", () => {
    expect(demote("###### Six", 3)).toContain("###### Six");
  });
});

describe("dropTitle()", () => {
  test("removes a leading `# Title` and the blank line after it", () => {
    expect(dropTitle("# Ingest — photos\n\nBody starts here.")).toBe("Body starts here.");
  });

  test("does nothing to a file with no leading title", () => {
    expect(dropTitle("## Not a title\nBody.")).toBe("## Not a title\nBody.");
  });
});
