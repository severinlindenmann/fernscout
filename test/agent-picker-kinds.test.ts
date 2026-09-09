import { describe, expect, test } from "vitest";
import { countKinds, PICKER_ACCEPT } from "@/components/PhotoPicker";
import { INBOX_FILE_EXTENSIONS } from "@/lib/inbox";
import { dictionaryFor } from "@/lib/locales";
import { translate } from "@/lib/i18n";

/**
 * B845 — a receipt chosen in the photo picker was called a photo.
 *
 * B791 widened `accept` so a bank statement or a location export could be
 * chosen, and the label did not follow: `receipt.pdf` was answered with "1
 * photo chosen", which is the screen calling a PDF a photograph and giving no
 * sign that something different is about to happen to it.
 *
 * Two halves, and both are here. The count has to name the two kinds
 * separately — and by the *same* extension list the route sorts on, or the
 * label and the destination will disagree — and the screen has to say where
 * the file went, which is also the only place the import feature is
 * advertised at all.
 */

function file(name: string): File {
  return new File([new Uint8Array([1])], name);
}

/** What the picker's line reads, composed the way `PhotoPicker` composes it. */
function line(locale: string, names: string[]): string {
  const dictionary = dictionaryFor(locale);
  const say = (key: string, vars?: Record<string, string>) =>
    translate(dictionary, key as Parameters<typeof translate>[1], vars);
  const plural = (key: string, count: number) =>
    say(count === 1 ? `${key}.one` : key, { count: String(count) });
  const kinds = countKinds(names.map(file));
  const parts = [
    ...(kinds.photos > 0 ? [plural("agent.photosPart", kinds.photos)] : []),
    ...(kinds.files > 0 ? [plural("agent.filesPart", kinds.files)] : []),
  ].join(` ${say("agent.andJoin")} `);
  return say("agent.chosenParts", { parts });
}

describe("what was actually chosen", () => {
  test("a PDF is a file and not a photograph", () => {
    expect(countKinds([file("receipt.pdf")])).toEqual({ photos: 0, files: 1 });
    expect(line("en", ["receipt.pdf"])).toBe("1 file chosen");
    expect(line("en", ["receipt.pdf"])).not.toMatch(/photograph/);
  });

  test("the two kinds are counted and named separately", () => {
    expect(countKinds(["a.jpg", "b.heic", "c.mov", "statement.csv"].map(file))).toEqual({
      photos: 3,
      files: 1,
    });
    expect(line("de", ["a.jpg", "b.heic", "c.mov", "statement.csv"])).toBe(
      "3 Fotos und 1 Datei gewählt",
    );
    expect(line("hu", ["a.jpg", "statement.csv"])).toBe("1 fénykép és 1 fájl kiválasztva");
  });

  test("photographs alone say nothing about files", () => {
    expect(line("en", ["a.jpg", "b.jpg"])).toBe("2 photographs chosen");
  });

  test("a HEIC with no MIME type is still a photograph — the split is by extension", () => {
    expect(file("IMG_0042.HEIC").type).toBe("");
    expect(countKinds([file("IMG_0042.HEIC")])).toEqual({ photos: 1, files: 0 });
  });
});

describe("where a file goes, said on the screen", () => {
  test("every language names the inbox", () => {
    for (const locale of ["en", "de", "hu"]) {
      const said = translate(dictionaryFor(locale), "agent.filesToInbox");
      expect(said).not.toBe("agent.filesToInbox");
      expect(said.length).toBeGreaterThan(20);
    }
  });
});

describe("the section that holds the picker", () => {
  test("B863 — its heading does not call every pick a photograph", () => {
    // `PhotoPicker`'s own count line already told the two kinds apart
    // (B845); the heading above it — `agent.uploadTitle`, shared by the
    // wizard's photos step and the room's upload panel — still said only
    // "Photographs" while the same unnarrowed picker took a spreadsheet or a
    // PDF into the exact same panel.
    for (const locale of ["en", "de", "hu"]) {
      const said = translate(dictionaryFor(locale), "agent.uploadTitle");
      expect(said).not.toBe("agent.uploadTitle");
      expect(said).toMatch(/photo|foto|fénykép/i);
      expect(said.toLowerCase()).not.toMatch(/^(photographs?|fotos?|fényképek)[.!]?$/i);
    }
  });
});

describe("the client's list and the server's stay together", () => {
  test("every extension the route files into the inbox is one the picker calls a file", () => {
    for (const ext of INBOX_FILE_EXTENSIONS) {
      expect(countKinds([file(`thing${ext}`)])).toEqual({ photos: 0, files: 1 });
      // And the picker still offers it, which is B791's own assertion.
      expect(PICKER_ACCEPT).toContain(ext);
    }
  });
});
