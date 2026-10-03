// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import SpeakTray from "@/components/studio/day/SpeakTray";
import { SPEECH_LANGUAGE_LABEL, speechLanguageFor } from "@/lib/helper/speech";
import { appendSpoken, undoSpoken } from "@/lib/studio/speak";
import { dictionaryFor } from "@/lib/locales";

/**
 * The Speak sheet — B2761. Behaviour, not mechanism: the guide question is
 * only shown, Undo takes back exactly the inserted words, and the chip names
 * the language the transcribe route will use.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let sent: Record<string, unknown> | null;

class FakeRecorder {
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x".repeat(64)]) });
    this.onstop?.();
  }
}

beforeEach(() => {
  sent = null;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string }) => {
      sent = JSON.parse(init?.body ?? "{}");
      return { ok: true, json: async () => ({ text: "we climbed the pass" }) };
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

let current = "";
function Host({ initial, defaultLanguage }: { initial: string; defaultLanguage?: "en" | "de" | "de-CH" }) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    current = value;
  });
  return (
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SpeakTray
        username="alex"
        speech={{ consented: true, provider: "dry-run" }}
        defaultLanguage={defaultLanguage}
        value={value}
        setValue={setValue}
      />
    </LocaleProvider>
  );
}

function mount(initial: string, defaultLanguage?: "en" | "de" | "de-CH") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Host initial={initial} defaultLanguage={defaultLanguage} />));
}

const button = (name: RegExp) =>
  [...document.body.querySelectorAll("button")].find((b) => name.test(b.textContent ?? b.getAttribute("aria-label") ?? "") || name.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement;

async function tap(el: HTMLButtonElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("pure helpers", () => {
  test("Undo removes only the inserted words", () => {
    const after = appendSpoken("Morning walk.", "we climbed the pass");
    expect(after).toBe("Morning walk. we climbed the pass");
    expect(undoSpoken(after, "we climbed the pass")).toBe("Morning walk.");
    expect(undoSpoken(appendSpoken("", "hello"), "hello")).toBe("");
    // words typed elsewhere in the text survive; absent words change nothing
    expect(undoSpoken("hello there. hello", "hello")).toBe("hello there.");
    expect(undoSpoken("abc", "zzz")).toBe("abc");
  });
});

describe("the sheet", () => {
  test("the chip names the language the server will use", () => {
    mount("", "de-CH");
    expect(button(/Schwiizerdütsch/).textContent).toContain(SPEECH_LANGUAGE_LABEL[speechLanguageFor(null, "de-CH")!]);
  });

  test("the question is shown but never reaches the day; Undo takes back only the words", async () => {
    mount("Morning walk.", "en");
    await tap(button(/^Speak$/));
    expect(document.body.textContent).toContain("Not sure what to say?");
    expect(document.body.textContent).toContain("How was your day?");
    await tap(button(/Another question/));
    expect(document.body.textContent).toContain("What did you do?");
    // pause and resume keep it open
    await tap(button(/Pause recording/));
    expect(document.body.textContent).toContain("Paused");
    await tap(button(/Resume recording/));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    await tap(button(/Finish recording/));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(sent?.language).toBe("en");
    expect(current).toBe("Morning walk. we climbed the pass");
    expect(current).not.toMatch(/How was your day|What did you do|Not sure/);
    expect(document.body.textContent).toContain("Added ·");
    await tap(button(/^Undo$/));
    expect(current).toBe("Morning walk.");
  });

  test("a recording too short to send says so in the sheet's own words — B2819", async () => {
    mount("", "en");
    await tap(button(/^Speak$/));
    await tap(button(/Finish recording/));
    expect(document.body.textContent).toContain("too short to write down");
    expect(document.body.textContent).not.toContain("hold the button");
    expect(sent).toBeNull();
  });
});
