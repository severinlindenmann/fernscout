import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DatabaseUrlError, parseDatabaseUrl } from "@/lib/db";
import { defaultSqliteFile } from "@/lib/db/url";

const original = process.env.DATA_DIR;
afterEach(() => {
  if (original === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = original;
});

describe("parseDatabaseUrl", () => {
  test("no URL means no database, which is a supported way to run", () => {
    expect(parseDatabaseUrl(undefined)).toBeNull();
    expect(parseDatabaseUrl("")).toBeNull();
    expect(parseDatabaseUrl("   ")).toBeNull();
  });

  test("a bare sqlite: falls back to the file under DATA_DIR", () => {
    process.env.DATA_DIR = "/tmp/fernscout-test";
    expect(parseDatabaseUrl("sqlite:")).toEqual({
      dialect: "sqlite",
      file: path.join("/tmp/fernscout-test", "fernscout.db"),
      label: expect.stringContaining("sqlite"),
    });
    expect(defaultSqliteFile()).toBe("/tmp/fernscout-test/fernscout.db");
  });

  test("relative sqlite paths resolve against the working directory", () => {
    const target = parseDatabaseUrl("sqlite:./.data/fernscout.db");
    expect(target?.dialect).toBe("sqlite");
    expect(target).toMatchObject({ file: path.resolve(process.cwd(), ".data/fernscout.db") });
  });

  test("the slashes in sqlite:// are an empty authority, not part of the path", () => {
    expect(parseDatabaseUrl("sqlite:///var/lib/fernscout.db")).toMatchObject({
      file: "/var/lib/fernscout.db",
    });
  });

  test("file: is accepted as a synonym", () => {
    expect(parseDatabaseUrl("file:/var/lib/fernscout.db")).toMatchObject({
      dialect: "sqlite",
      file: "/var/lib/fernscout.db",
    });
  });

  test(":memory: stays :memory:", () => {
    expect(parseDatabaseUrl("sqlite::memory:")).toMatchObject({ file: ":memory:" });
  });

  test("postgres URLs are passed through to the driver", () => {
    expect(parseDatabaseUrl("postgres://ana@db.example:5432/fernscout")).toEqual({
      dialect: "postgres",
      connectionString: "postgres://ana@db.example:5432/fernscout",
      label: expect.any(String),
    });
    expect(parseDatabaseUrl("postgresql://db/fernscout")?.dialect).toBe("postgres");
  });

  test("the label never contains the password", () => {
    const target = parseDatabaseUrl("postgres://ana:hunter2@db.example:5432/fernscout");
    expect(target?.label).not.toContain("hunter2");
    expect(target?.label).toContain("***");
  });

  test("an unknown scheme is an error, not a silent no-database", () => {
    expect(() => parseDatabaseUrl("mysql://localhost/x")).toThrow(DatabaseUrlError);
    expect(() => parseDatabaseUrl("just-a-path.db")).toThrow(DatabaseUrlError);
    expect(() => parseDatabaseUrl("postgres://")).toThrow(DatabaseUrlError);
  });

  test("the error says what is supported", () => {
    expect(() => parseDatabaseUrl("mysql://localhost/x")).toThrow(/sqlite:/);
  });
});
