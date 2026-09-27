import { describe, expect, test, vi } from "vitest";
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
    // The exact example `/docs` shows a visitor: a day document with the
    // fields the task asked for by name. JSON spelling since B1598 — the
    // point of the assertion is that the worked example still names the
    // field, not which punctuation surrounds it.
    expect(dayEntry).toContain('"time"');
    expect(dayEntry).toContain('"lat"');
    expect(dayEntry).toContain('"lng"');
    expect(dayEntry).toContain("```json");
  });

  test("stops at the next heading, not the whole rest of the file", () => {
    const readme = readRepoFile("README.md");
    const running = section(readme, "Run it");
    expect(running).toContain("npm run dev");
    // "How it works" is the next `##` — its own heading text must not leak
    // into the section above it.
    expect(running).not.toContain("How it works");
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

/**
 * B2475 — `/docs/hosting` answered 500 in production because four headings it
 * asked `docs/capabilities.md` for had been renamed away. The page now drops
 * a missing block instead of throwing, and this is what keeps that from
 * hiding a rename: every heading the page asks for has to exist.
 */
describe("/docs/hosting sources", () => {
  test("every section the hosting page shows exists", async () => {
    const { HOSTING_CAPABILITY_SECTIONS } = await import("@/lib/docs");
    const capabilities = readRepoFile("docs/capabilities.md");
    for (const heading of ["The rules", ...HOSTING_CAPABILITY_SECTIONS]) {
      expect(() => section(capabilities, heading), heading).not.toThrow();
    }
    expect(() => section(readRepoFile("README.md"), "What a day looks like")).not.toThrow();
  });

  test("a missing file or heading is null, not a thrown page", async () => {
    const { sectionOrNull } = await import("@/lib/docs");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(sectionOrNull("docs/no-such-file.md", "Anything")).toBeNull();
    expect(sectionOrNull("README.md", "No such heading")).toBeNull();
    expect(sectionOrNull("README.md", "What a day looks like")).toContain("```json");
    quiet.mockRestore();
  });

  test("the page renders when its source files are missing", async () => {
    const fs = await import("node:fs");
    const real = fs.default.readFileSync;
    // Only the markdown sources vanish; config and locale files still load.
    const read = vi.spyOn(fs.default, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file).endsWith(".md")) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return (real as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof real);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/lib/locales", async (orig) => ({
      ...(await orig<typeof import("@/lib/locales")>()),
      requestLocale: async () => "en",
    }));
    try {
      const { default: HostingPage } = await import("@/app/docs/hosting/page");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const html = renderToStaticMarkup(await HostingPage());
      expect(html).toContain("<h1");
      expect(html).toContain("Run it locally");
    } finally {
      read.mockRestore();
      quiet.mockRestore();
      vi.doUnmock("@/lib/locales");
    }
  });
});
