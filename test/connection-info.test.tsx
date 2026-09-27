// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ConnectionInfo from "@/components/ConnectionInfo";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2465 — fernscout.ch (the operator's own `site.hosting.host`) rendered the
 * generic self-hosted line instead of the official one. This checks the
 * branch itself — reached host vs `hosting.host`, case-insensitively, over
 * https — is correct, since that is the whole of what code review here could
 * establish; the ticket's own note is that a live-server-only cause could not
 * be ruled out without VPS access. Also covers B2465's second half: the
 * install-context label on the version row (Web version / Installed app
 * (PWA)), reusing `useStandalone` moved to components/nativeShell.ts so
 * B2463's OfflineTrips can share it too.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function stubStandalone(standalone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function render(props: Parameters<typeof ConnectionInfo>[0]) {
  stubStandalone(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <ConnectionInfo {...props} />
      </LocaleProvider>,
    );
  });
}

describe("ConnectionInfo (B2465)", () => {
  test("the operator's own host, reached over https, gets the official line", async () => {
    vi.stubGlobal("location", { ...window.location, protocol: "https:", host: "fernscout.ch" });
    await render({
      build: { version: "1.0.0" },
      hosting: { host: "fernscout.ch", where: "in Europe" },
    });
    expect(container!.textContent).toContain("official Fernscout server");
    expect(container!.textContent).toContain("in Europe");
    expect(container!.textContent).not.toContain("self-hosted");
  });

  test("a host that does not match site.hosting.host is called self-hosted", async () => {
    vi.stubGlobal("location", { ...window.location, protocol: "https:", host: "travel.example.org" });
    await render({
      build: { version: "1.0.0" },
      hosting: { host: "fernscout.ch", where: "in Europe" },
    });
    expect(container!.textContent).toContain("self-hosted server travel.example.org");
  });

  test("case in the reached host does not defeat the match", async () => {
    vi.stubGlobal("location", { ...window.location, protocol: "https:", host: "Fernscout.ch" });
    await render({
      build: { version: "1.0.0" },
      hosting: { host: "fernscout.ch", where: "in Europe" },
    });
    expect(container!.textContent).toContain("official Fernscout server");
  });

  test("no hosting configured at all is self-hosted, never official", async () => {
    vi.stubGlobal("location", { ...window.location, protocol: "https:", host: "fernscout.ch" });
    await render({ build: { version: "1.0.0" } });
    expect(container!.textContent).toContain("self-hosted server fernscout.ch");
  });

  test("an installed home-screen app labels the version row Installed app (PWA)", async () => {
    vi.stubGlobal("location", { ...window.location, protocol: "https:", host: "fernscout.ch" });
    stubStandalone(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <ConnectionInfo build={{ version: "1.0.0" }} />
        </LocaleProvider>,
      );
    });
    expect(container!.textContent).toContain("Installed app (PWA)");
    expect(container!.textContent).not.toContain("Web version");
  });

  test("an ordinary browser tab still says Web version", async () => {
    vi.stubGlobal("location", { ...window.location, protocol: "https:", host: "fernscout.ch" });
    await render({ build: { version: "1.0.0" } });
    expect(container!.textContent).toContain("Web version");
    expect(container!.textContent).not.toContain("Installed app (PWA)");
  });
});
