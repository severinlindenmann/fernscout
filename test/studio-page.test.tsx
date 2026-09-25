import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StudioPage from "@/components/studio/StudioPage";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2061 — the shell every studio page renders through. PageHeader is stubbed:
 * its own tests cover it, and here only the `backTo` it receives matters.
 */
vi.mock("@/components/PageHeader", () => ({
  default: ({ backTo }: { backTo?: { href: string } }) => <header data-back={backTo?.href} />,
}));

function render(props: Partial<React.ComponentProps<typeof StudioPage>> = {}) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <StudioPage username="alex" title="A new trip" {...props}>
        <p id="body">the body</p>
      </StudioPage>
    </LocaleProvider>,
  );
}

describe("StudioPage", () => {
  test("renders exactly one h1, the body and the way back to the studio", () => {
    const html = render({ group: "plan", lede: "Two dates are enough." });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("A new trip");
    expect(html).toContain('id="body"');
    expect(html).toContain('data-back="/alex/studio"');
    expect(html).toContain("Plan");
    expect(html).toContain("Two dates are enough.");
  });

  test("back={false} (the hub) hands the header no way back", () => {
    expect(render({ back: false })).not.toContain("data-back=");
  });

  test("no error, no alert", () => {
    expect(render()).not.toContain('role="alert"');
  });

  test("an error renders in a role=alert line", () => {
    expect(render({ error: "A title is needed." })).toMatch(/<p role="alert"[^>]*text-coral-600[^>]*>A title is needed\.<\/p>/);
  });

  test("capabilityOff renders the off panel instead of the body", () => {
    const html = render({ capabilityOff: { banner: "Printing is off.", body: "On purpose." } });
    expect(html).toContain("Printing is off.");
    expect(html).not.toContain('id="body"');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  test("the indicator renders only when given", () => {
    expect(render()).not.toContain("2 of 4");
    expect(render({ indicator: { total: 4, current: 2, label: "2 of 4" } })).toContain("2 of 4");
  });

  test.each([
    [undefined, "max-w-xl"],
    ["flow", "max-w-xl"],
    ["board", "max-w-3xl"],
    ["wide", "max-w-5xl"],
  ] as const)("width %s is %s px-4 py-8", (width, cls) => {
    const main = render({ width }).match(/<main[^>]*class="([^"]*)"/)![1].split(" ");
    expect(main).toEqual(expect.arrayContaining([cls, "px-4", "py-8", "mx-auto", "w-full"]));
    expect(main.filter((c) => c.startsWith("max-w-"))).toHaveLength(1);
  });
});
