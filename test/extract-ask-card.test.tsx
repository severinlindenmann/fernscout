// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import AskCard from "@/components/extract/AskCard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { Question } from "@/lib/extract/questions";

/**
 * S7a/S7c — B1803 Task 3b fix round 2, findings 1 and 2.
 *
 * Two review findings live here:
 *
 * - The `FIRST` badge must be keyed on `question.kind`, not on
 *   `questionIndex`. For a dated group the two happen to agree (the
 *   opening question is always the day's first), which is exactly why the
 *   original browser pass — dated photographs only — never caught this.
 *   An undated group's "when" gap question (`lib/extract/questions.ts`)
 *   is pushed first and would wrongly wear the badge under the old,
 *   position-keyed logic.
 * - S7a and S7c both need the header row the design draws
 *   (`← Tue 2 Jul · Hoi An` / `1 of 3`) and S7b (rendered once a recording
 *   comes back) must not, since it draws its own.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(question: Question, props: Partial<Parameters<typeof AskCard>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <AskCard
          question={question}
          username="alex"
          consentedSpeech={false}
          speechProvider=""
          onAnswer={async () => {}}
          {...props}
        />
      </LocaleProvider>,
    );
  });
}

const openingQuestion: Question = { id: "open:2026-06-02", kind: "opening", text: "What did you do?" };
const whenGapQuestion: Question = {
  id: "when:undated",
  kind: "gap",
  fills: "date",
  text: "Roughly when were these taken?",
};
const followUpQuestion: Question = { id: "after:2026-06-02", kind: "follow-up", text: "What happened next?" };

describe("AskCard's FIRST badge — keyed on kind, not position", () => {
  test("an undated group's 'when' gap question, at position 1, gets no FIRST badge", () => {
    render(whenGapQuestion, { questionIndex: 1, questionTotal: 2 });
    expect(container!.textContent).not.toContain("First");
  });

  test("the opening question gets the FIRST badge, wherever it lands", () => {
    render(openingQuestion, { questionIndex: 1, questionTotal: 1 });
    expect(container!.textContent).toContain("First");
  });

  test("a follow-up question gets its own 'one more, if you like' label, not FIRST", () => {
    render(followUpQuestion, { questionIndex: 3, questionTotal: 3 });
    expect(container!.textContent).toContain("One more, if you like");
    expect(container!.textContent).not.toContain("First");
  });
});

describe("AskCard's header row (S7a/S7c) — design-v2.html:863/911", () => {
  test("S7a shows the day's weekday, place and the question's own N of M", () => {
    render(openingQuestion, {
      date: "2026-06-02",
      place: "Hoi An",
      questionIndex: 1,
      questionTotal: 3,
    });
    expect(container!.textContent).toContain("Tuesday · Hoi An");
    expect(container!.textContent).toContain("1 of 3");
  });

  test("a day with no place omits it rather than inventing one", () => {
    render(openingQuestion, { date: "2026-06-02", questionIndex: 1, questionTotal: 3 });
    expect(container!.textContent).toContain("Tuesday");
    expect(container!.textContent).not.toContain("Hoi An");
  });

  test("the follow-up screen's header (S7c) shows the weekday only, never the place", () => {
    render(followUpQuestion, {
      date: "2026-06-02",
      place: "Hoi An",
      questionIndex: 3,
      questionTotal: 3,
    });
    // "Tuesday" appears in the header; the place must not.
    expect(container!.textContent).toContain("Tuesday");
    expect(container!.textContent).not.toContain("Hoi An");
    expect(container!.textContent).toContain("3 of 3");
  });

  test("the undated group's header carries no date clause, only the N of M", () => {
    render(whenGapQuestion, { questionIndex: 1, questionTotal: 2 });
    expect(container!.textContent).toContain("1 of 2");
  });
});

/**
 * `speechLanguage` — B1803 Task 4.2. Once Step 02's mode screen has already
 * asked which language a voice answer will be in, `RecordButton`'s own
 * per-recording select (the correction for a caller with no such answer on
 * hand) must not draw a second time: `AskCard` has to pass the manifest's
 * choice straight through as `RecordButton`'s `language` prop.
 */
describe("AskCard threads the run's chosen language to RecordButton", () => {
  function clickMic() {
    const mic = Array.from(container!.querySelectorAll("button")).find((b) =>
      b.getAttribute("aria-label")?.includes("Press to start"),
    );
    if (!mic) throw new Error("no record button found");
    act(() => {
      mic.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  test("with a run language set, the per-recording select never appears", () => {
    render(followUpQuestion, {
      consentedSpeech: true,
      speechProvider: "deepgram",
      speechLanguage: "hu",
    });
    clickMic();
    expect(container!.querySelector("select")).toBeNull();
  });

  test("with no run language, the per-recording select still offers a choice", () => {
    render(followUpQuestion, {
      consentedSpeech: true,
      speechProvider: "deepgram",
    });
    clickMic();
    expect(container!.querySelector("select")).not.toBeNull();
  });
});

/**
 * B1803 final review, finding 2 — "Type it out" was stored on the manifest
 * (`extract/start`'s own `mode`) and read by nothing, so a person who chose
 * typing got the voice-first hero on every question of every day and had to
 * press "Type this one instead" each time. The answer they gave has to
 * change what they see.
 */
describe("AskCard honours the run's own answer mode", () => {
  test("a run that chose typing gets the typing box even where speech is available", () => {
    render(openingQuestion, { speechProvider: "deepgram", answerMode: "type" });
    expect(container!.querySelector("textarea")).not.toBeNull();
    expect(container!.textContent).not.toContain("Type this one instead");
  });

  test("a run that chose voice still gets the voice-first hero", () => {
    render(openingQuestion, { speechProvider: "deepgram", answerMode: "voice" });
    expect(container!.textContent).toContain("Type this one instead");
  });
});
