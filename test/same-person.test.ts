import { describe, expect, test } from "vitest";
import { addPerson, nameOnlyMatch, samePerson } from "@/lib/samePerson";

describe("samePerson / addPerson (B-2949)", () => {
  test("the same address is the same person; different addresses are not, whatever the name", () => {
    expect(samePerson({ name: "A", email: "x@e.com" }, { name: "B", email: "X@e.com" })).toBe(true);
    expect(samePerson({ name: "Nicolas", email: "a@e.com" }, { name: "Nicolas", email: "b@e.com" })).toBe(false);
  });

  test("with no address on one side the name decides, ignoring case and spaces", () => {
    expect(samePerson({ name: "Nicolas" }, { name: " nicolas ", email: "n@e.com" })).toBe(true);
    expect(samePerson({ name: "Nicolas" }, { name: "Nico", email: "n@e.com" })).toBe(false);
  });

  test("a name-only entry takes the address in place, keeping its position and name", () => {
    const list = [{ name: "Murielle", email: "m@e.com" }, { name: "Nicolas" }, { name: "Jo" }];
    expect(addPerson(list, { name: "nicolas", email: "N@e.com" })).toEqual([
      { name: "Murielle", email: "m@e.com" },
      { name: "Nicolas", email: "n@e.com" },
      { name: "Jo" },
    ]);
  });

  test("a nickname from either side is kept", () => {
    expect(addPerson([{ name: "N" }], { name: "N", email: "n@e.com", nickname: "Nic" })).toEqual([
      { name: "N", email: "n@e.com", nickname: "Nic" },
    ]);
  });

  test("somebody already there changes nothing and returns the same list", () => {
    const list = [{ name: "Nicolas", email: "n@e.com" }];
    expect(addPerson(list, { name: "Nicolas" })).toBe(list);
    expect(addPerson(list, { name: "Nicolas", email: "n@e.com" })).toBe(list);
  });

  test("two people who share a first name but have different addresses stay two", () => {
    const list = [{ name: "Nicolas", email: "a@e.com" }];
    expect(addPerson(list, { name: "Nicolas", email: "b@e.com" })).toHaveLength(2);
  });

  test("nameOnlyMatch finds only an entry without an address", () => {
    const list = [{ name: "Nicolas", email: "n@e.com" }, { name: "Jo" }];
    expect(nameOnlyMatch(list, "nicolas")).toBeUndefined();
    expect(nameOnlyMatch(list, "JO")).toEqual({ name: "Jo" });
  });
});
