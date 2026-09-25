// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import AskCard from "@/components/extract/AskCard";
import { statusFor } from "@/components/extract/DayBoard";
import LocaleProvider from "@/components/LocaleProvider";
import { countDays } from "@/lib/extract/dayCount";
import { daysLeftToTell, groupIntoDays } from "@/lib/extract/group";
import { questionsForDay } from "@/lib/extract/questions";
import { dictionaryFor } from "@/lib/locales";
import en from "@/site/locales/en.json";
import de from "@/site/locales/de.json";
import hu from "@/site/locales/hu.json";
import type { PhotoRow, RunManifest } from "@/lib/staging/manifest";

/**
 * B2057 — "Finish Monday" left the day untold while the quiet Skip beside it
 * told it, and the hub's resume count (`daysLeftToTell`, which counted
 * committed days) disagreed with the board (which counts days with no open
 * question). One definition of told now: no open question.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("Finish closes the day the way Skip does", () => {
  test("Finish with nothing typed skips the follow-up rather than leaving it open", async () => {
    const onSkip = vi.fn(async () => {});
    const onAnswer = vi.fn(async () => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <AskCard
            question={{ id: "after:2026-06-01", kind: "follow-up", text: "What happened right after this?" }}
            date="2026-06-01"
            username="alex"
            consentedSpeech={false}
            speechProvider=""
            onAnswer={onAnswer}
            onSkip={onSkip}
          />
        </LocaleProvider>,
      );
    });
    const finish = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Finish Monday"))!;
    await act(async () => finish.click());
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

const photo = (id: string, takenAt: string): PhotoRow => ({
  id, filename: id, bytes: 1, kind: "image", takenAt, date: takenAt.slice(0, 10), lat: 46.5, lng: 8.1,
});

describe("one definition of told", () => {
  test("the hub's days-left count equals the board's, with one of two days finished", () => {
    const photos = [photo("a", "2026-06-01T10:00:00"), photo("b", "2026-06-02T10:00:00")];
    const run = {
      photos,
      // Monday answered and its follow-up skipped/finished; nothing committed.
      days: [{ date: "2026-06-01", answered: ["open:2026-06-01", "after:2026-06-01"] }],
    } as unknown as RunManifest;
    const groups = groupIntoDays(photos);
    const boardTold = groups.filter(
      (g) => !g.undated && statusFor(questionsForDay(g, photos, run.days.find((d) => d.date === g.date) ?? { date: g.date, answered: [] })) === "told",
    ).length;
    expect(boardTold).toBe(1);
    expect(daysLeftToTell(run)).toBe(countDays(groups) - boardTold);
  });
});

describe("the untrue sentences are gone", () => {
  test.each([["en", en], ["de", de], ["hu", hu]])("%s drops the removed keys", (_, dict) => {
    const keys = dict as Record<string, string>;
    expect(keys["studio.photos.resume.daysStay"]).toBeUndefined();
    expect(keys["studio.photos.found.withoutPlaceBody"]).toBeUndefined();
  });

  test("no English line claims finished days are already in the journal, or where a file came from", () => {
    const all = Object.values(en as Record<string, string>).join("\n");
    expect(all).not.toMatch(/already finished are part of your journal/);
    expect(all).not.toMatch(/sent to you, or downloaded/);
  });
});
