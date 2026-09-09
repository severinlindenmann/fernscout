// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AgentWizard from "@/components/AgentWizard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { typeInto } from "./support/type-input";

/**
 * B731 — the quick-create trip form never asked who could read the trip.
 *
 * The ask box's own `create_trip` tool already renders three labelled
 * options (see `test/helper-tools.test.ts`); this is the sibling surface,
 * the wizard's plain "new trip" form, which posted only a title and two
 * dates. This asserts the same three options are on this screen too,
 * default to "guest" like the tool does, and that the choice actually
 * reaches the POST body rather than being drawn and dropped.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function withLocale(node: React.ReactNode) {
  return (
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      {node}
    </LocaleProvider>
  );
}

describe("the wizard's own quick-create trip form", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  function form(): HTMLFormElement {
    return container!.querySelector("form") as HTMLFormElement;
  }

  function radio(value: string): HTMLInputElement {
    return container!.querySelector(
      `input[name="wizard-new-trip-visibility"][value="${value}"]`,
    ) as HTMLInputElement;
  }

  function mount() {
    root = createRoot(container!);
    act(() => {
      root!.render(
        withLocale(
          <AgentWizard
            username="alex"
            trips={[]}
            drafts={[]}
            currency={{ base: "EUR", currencies: ["EUR"], rates: { EUR: 1 } }}
            helper={{
              enabled: true,
              consented: true,
              speech: false,
              consentedSpeech: false,
              speechProvider: "none",
              consentedPhotos: true,
              credits: 0,
            }}
          />,
        ),
      );
    });
  }

  test("shows the three labels the ask box's own tool uses, defaulted to guest", () => {
    mount();

    expect(radio("public")).toBeTruthy();
    expect(radio("guest")).toBeTruthy();
    expect(radio("private")).toBeTruthy();
    expect(radio("guest").checked).toBe(true);
    expect(radio("public").checked).toBe(false);
    expect(radio("private").checked).toBe(false);

    // The same sentences the ask box's confirmation uses (agent.tool.visibility*),
    // so the two surfaces cannot drift apart in wording.
    expect(container!.textContent).toContain("Guests — everybody you have let into this journal");
    expect(container!.textContent).toContain("Private — only the people who were on the trip");
    expect(container!.textContent).toContain("Public — anybody at all can read it");
  });

  test("the chosen visibility reaches the POST body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, id: "a-new-trip" }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    mount();

    typeInto(
      container!.querySelector("#wizard-new-trip-title") as HTMLInputElement,
      "A trip",
    );
    typeInto(
      container!.querySelector("#wizard-new-trip-start") as HTMLInputElement,
      "2026-05-01",
    );
    typeInto(
      container!.querySelector("#wizard-new-trip-end") as HTMLInputElement,
      "2026-05-03",
    );

    await act(async () => {
      radio("private").click();
    });

    await act(async () => {
      form().requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body?: string }];
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(body.visibility).toBe("private");
    expect(body.title).toBe("A trip");
  });
});
