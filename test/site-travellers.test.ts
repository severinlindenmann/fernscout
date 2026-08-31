import { describe, expect, test } from "vitest";
import { travellerFullNamesOf, travellerNamesOf, travellersOf } from "@/lib/site";
import type { Trip } from "@/lib/types";
import type { UserConfig } from "@/lib/config";

const user = {
  owner: { name: "Alex Berger", nickname: "Alex", email: "alex@example.com" },
} as UserConfig;

const tripWith = (people: Trip["people"]) => ({ people }) as Trip;

describe("who a trip is credited to", () => {
  test("a solo trip is the owner alone", () => {
    expect(travellerNamesOf(user, tripWith([]))).toBe("Alex");
    expect(travellerFullNamesOf(user, tripWith([]))).toBe("Alex Berger");
  });

  test("a shared trip names both, owner first", () => {
    const trip = tripWith([
      { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" },
    ]);
    expect(travellerNamesOf(user, trip)).toBe("Alex + Robin");
    expect(travellerFullNamesOf(user, trip)).toBe("Alex Berger & Robin Berger");
  });

  test("a person with no nickname is credited by name", () => {
    const trip = tripWith([{ name: "Robin Berger", email: "robin@example.com" }]);
    expect(travellerNamesOf(user, trip)).toBe("Alex + Robin Berger");
  });

  test("an owner also listed in people: is named once", () => {
    const trip = tripWith([
      { name: "Alex Berger", email: "ALEX@example.com", nickname: "Alex" },
      { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" },
    ]);
    expect(travellersOf(user, trip)).toHaveLength(2);
    expect(travellerNamesOf(user, trip)).toBe("Alex + Robin");
  });

  test("an owner with no address is still credited", () => {
    const anon = { owner: { name: "Alex Berger", nickname: "Alex" } } as UserConfig;
    expect(travellerNamesOf(anon, tripWith([]))).toBe("Alex");
  });

  test("an owner with an empty nickname is credited by full name", () => {
    const blank = {
      owner: { name: "Alex Berger", nickname: "", email: "alex@example.com" },
    } as UserConfig;
    expect(travellerNamesOf(blank, tripWith([]))).toBe("Alex Berger");
  });

  test("an owner's address differing only in case from a people: entry is still one person", () => {
    const mixedCase = {
      owner: { name: "Alex Berger", nickname: "Alex", email: "Alex@Example.com" },
    } as UserConfig;
    const trip = tripWith([
      { name: "Alex Berger", email: "alex@example.com", nickname: "Alex" },
      { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" },
    ]);
    expect(travellersOf(mixedCase, trip)).toHaveLength(2);
    expect(travellerNamesOf(mixedCase, trip)).toBe("Alex + Robin");
  });
});
