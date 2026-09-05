import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { getTrip, tripRef } from "@/lib/trips";
import { peopleNamedIn } from "@/lib/tripPeople";
import { createTrip } from "@/lib/tripWrite";
import { PRESET_NAMES } from "@/lib/travellers/presets";

/**
 * `travellers:` on disk — read, written, and kept away from `people:`.
 *
 * The claim under test is the one that made this a separate block in the first
 * place: **a broken hair colour must not be able to revoke anybody's write
 * access**. `parsePeople` fails closed by design, so a cosmetic field sharing
 * that parser would mean a typo in a colour dropping the whole list of who may
 * write to the trip.
 */

let dir: string;

function writeTrip(id: string, extra: string[]) {
  const tripDir = path.join(dir, "alex", "trips", id);
  fs.mkdirSync(tripDir, { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "trip.md"),
    [
      "---",
      `id: ${id}`,
      `title: "${id}"`,
      'start: "2026-01-01"',
      'end: "2026-01-05"',
      "status: past",
      "visibility: public",
      ...extra,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-travellers-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: "alex" },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.com" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

const trip = (id: string) => getTrip(tripRef("alex", id))!;

describe("cosmetics cannot reach write access", () => {
  /**
   * The acceptance criterion, and the whole argument for the separate block.
   */
  test("a broken hair colour leaves people: untouched", () => {
    writeTrip("kerala", [
      "people:",
      "  - name: Ana",
      "    email: ana@example.test",
      "  - name: Bo",
      "    email: bo@example.test",
      "travellers:",
      "  - hair: chartreuse-ish",
      "    hairStyle: nonsense",
      "  - skin: deep",
    ]);

    const t = trip("kerala");
    expect(t.people.map((p) => p.email)).toEqual(["ana@example.test", "bo@example.test"]);
    expect(peopleNamedIn(t)).toContain("ana@example.test");
    expect(peopleNamedIn(t)).toContain("bo@example.test");

    // And the party still draws, with the bad words simply not taken.
    expect(t.travellers).toHaveLength(2);
    expect(t.travellers[1].skin).toBe("deep");
    expect(t.travellers[0].hairStyle).toBeUndefined();
  });

  test("a travellers: block that is not a list drops only itself", () => {
    writeTrip("nepal", [
      "people:",
      "  - name: Ana",
      "    email: ana@example.test",
      "travellers: yes please",
    ]);
    const t = trip("nepal");
    expect(t.people).toHaveLength(1);
    expect(t.travellers).toEqual([]);
  });

  test("a malformed people: block still fails closed — travellers changes nothing", () => {
    writeTrip("peru", [
      "people:",
      "  - name: Ana",
      "    email: not-an-address",
      "travellers:",
      "  - skin: deep",
    ]);
    const t = trip("peru");
    // Unchanged behaviour: the whole list drops, because that list is access.
    expect(t.people).toEqual([]);
    expect(t.travellers).toHaveLength(1);
  });
});

describe("reading the block", () => {
  test("a trip with no travellers: reads as empty, not as a default party", () => {
    writeTrip("plain", []);
    expect(trip("plain").travellers).toEqual([]);
  });

  test("the journal's own config carries a default party", () => {
    const config = JSON.parse(fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8"));
    config.travellers = [{ skin: "deep", hairStyle: "coils" }];
    fs.writeFileSync(path.join(dir, "alex", "config.json"), JSON.stringify(config));
    clearConfigCache();
    clearUserCache();
    expect(getUser("alex")!.travellers).toEqual([{ skin: "deep", hairStyle: "coils" }]);
  });

  test("`travellers` is a known field, so it raises no unknown-field warning", () => {
    writeTrip("known", ["travellers:", "  - skin: deep"]);
    expect(trip("known").unknownFields).toBeUndefined();
  });
});

describe("writing the block", () => {
  test("round-trips a party through createTrip into trip.md", () => {
    const made = createTrip("alex", {
      id: "japan-2027",
      title: "Japan",
      start: "2027-04-01",
      end: "2027-04-20",
      travellers: [
        { for: "Ana@example.test", skin: "medium-deep", hair: "black", hairStyle: "braids" },
        { age: "child", accessories: ["hat"] },
      ],
    });
    expect(made.ok).toBe(true);

    const t = trip("japan-2027");
    expect(t.travellers).toHaveLength(2);
    expect(t.travellers[0]).toMatchObject({
      for: "ana@example.test",
      skin: "medium-deep",
      hair: "black",
      hairStyle: "braids",
    });
    expect(t.travellers[1]).toMatchObject({ age: "child", accessories: ["hat"] });
  });

  test("writes nothing when the party is empty, rather than an empty key", () => {
    createTrip("alex", {
      id: "quiet",
      title: "Quiet",
      start: "2027-04-01",
      end: "2027-04-02",
      travellers: [],
    });
    const file = fs.readFileSync(path.join(dir, "alex", "trips", "quiet", "trip.md"), "utf8");
    expect(file).not.toContain("travellers:");
  });

  /**
   * Refused rather than dropped — the mirror of the read path, and for the
   * stated reason: here somebody is listening.
   */
  test("refuses a hair colour it does not know, naming the field", () => {
    const made = createTrip("alex", {
      id: "bad-hair",
      title: "Bad hair",
      start: "2027-04-01",
      end: "2027-04-02",
      travellers: [{ hair: "chartreuse-ish" }],
    });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("unreachable");
    expect(made.error).toBe("invalid_travellers");
    expect(made.message).toContain("travellers[0].hair");
    // The message lists the vocabulary, so an agent can correct itself.
    expect(made.message).toContain("auburn");
  });

  test("refuses a preset name by name, and says what to do instead", () => {
    const made = createTrip("alex", {
      id: "preset",
      title: "Preset",
      start: "2027-04-01",
      end: "2027-04-02",
      travellers: [{ preset: "west-african" }],
    });
    expect(made.ok).toBe(false);
    if (made.ok) throw new Error("unreachable");
    expect(made.message).toContain("preset");
    expect(made.message).toContain("travellers/presets");
  });

  test("refuses more figures than a hero can hold", () => {
    const made = createTrip("alex", {
      id: "crowd",
      title: "Crowd",
      start: "2027-04-01",
      end: "2027-04-02",
      travellers: Array.from({ length: 11 }, () => ({ skin: "medium" })),
    });
    expect(made.ok).toBe(false);
  });

  /**
   * A starting point is picked, resolved and thrown away. Its *name* is a
   * claim about somebody's background, and it must never be what a trip file
   * records — not least because it stops being true the moment they change
   * the hair.
   */
  test("no starting-point name ever reaches a file it writes", () => {
    createTrip("alex", {
      id: "resolved",
      title: "Resolved",
      start: "2027-04-01",
      end: "2027-04-02",
      // What an agent writes after resolving `west-african`: attributes only.
      travellers: [{ skin: "deep", hair: "black", hairStyle: "coils" }],
    });
    const file = fs.readFileSync(path.join(dir, "alex", "trips", "resolved", "trip.md"), "utf8");
    for (const name of PRESET_NAMES) {
      expect(file, `trip.md names the ${name} preset`).not.toContain(name);
    }
  });
});
