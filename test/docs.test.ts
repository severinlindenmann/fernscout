import { describe, expect, test } from "vitest";
import { readRepoFile, section } from "@/lib/docs";

/**
 * `app/docs/page.tsx` builds part of its content by extracting sections out
 * of `README.md` and `CONTRIBUTING.md` rather than retyping them, so the
 * failure mode to guard against is a heading changing shape underneath it
 * and the page quietly losing a section. `section()` throws instead of
 * returning "" for exactly that reason — these tests are what turn a rename
 * in either file into a red build instead of a blank box on the live page.
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

  test("the four checks, from CONTRIBUTING.md's own words", () => {
    const contributing = readRepoFile("CONTRIBUTING.md");
    const gate = section(contributing, "Before you open a PR");
    expect(gate).toContain("npm run build");
    expect(gate).toContain("npx vitest run");
    expect(gate).not.toContain("What a good PR looks like");
  });

  test("keeps a nested ### heading inside its parent ## section", () => {
    const nested = "## Parent\nintro\n\n### Child\nchild body\n\n## Next\nnope";
    const parent = section(nested, "Parent");
    expect(parent).toContain("### Child");
    expect(parent).toContain("child body");
    expect(parent).not.toContain("nope");
  });

  test("a heading that does not exist fails loudly rather than silently", () => {
    expect(() => section("## Real heading\nbody", "Nonexistent heading")).toThrow();
  });
});
