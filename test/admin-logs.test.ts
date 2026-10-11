import { describe, expect, it } from "vitest";
import { filterLogs, LOG_WINDOWS, parseLogEntries, readLogs } from "@/lib/adminLogs";

const line = (message: string, at = 1_791_000_000_000) => JSON.stringify({ MESSAGE: message, __REALTIME_TIMESTAMP: String(at * 1000) });

const OUTPUT = [
  line("[req-error] 3f9a1c2e POST /api/v2/[user]/days journal=alice Cannot read properties of undefined\n    at buildDay (lib/api/entries.ts:212:18)\n    at POST (route.ts:41:9)"),
  line('[client-error] a71c09de ios 331d216 /@alice/studio "TypeError: undefined is not an object"'),
  line("[req] c0d15b7a POST /api/v2/[user]/import 429 8ms journal=ben err=rate_limited"),
  line("[req] 9be44f10 GET /api/v2/[user]/figures 500 1210ms journal=alice err=internal"),
  line("[req] 11111111 GET /api/v2/[user]/days 404 3ms journal=carl err=not_found"),
  line("[req] 22222222 GET /api/v2/[user]/days 200 3ms journal=carl err=-"),
  line("[req-error] 7e57e57e GET /api/v2/health boom"),
  line("[request] 33333333 GET /x ua=\"curl\""),
  "not json at all",
  JSON.stringify({ MESSAGE: Array.from(Buffer.from("[req] 44444444 GET /r 503 9ms journal=- err=unavailable")), __REALTIME_TIMESTAMP: "1791000000000000" }),
].join("\n");

describe("admin logs parser", () => {
  const entries = parseLogEntries(OUTPUT);

  it("keeps only errors and warnings, and skips lines it does not know", () => {
    expect(entries.map((e) => e.id)).toEqual(["3f9a1c2e", "a71c09de", "c0d15b7a", "9be44f10", "11111111", "7e57e57e", "44444444"]);
  });

  it("levels: 5xx and crashes are errors, other 4xx are warnings, 401/404 are routine", () => {
    const by = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(by["9be44f10"].level).toBe("error");
    expect(by["c0d15b7a"].level).toBe("warn");
    expect(by["11111111"]).toMatchObject({ level: "warn", routine: true });
    expect(by["44444444"]).toMatchObject({ level: "error", journal: null });
  });

  it("attributes a journal from journal=, the client route, or leaves it instance-wide", () => {
    const by = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(by["3f9a1c2e"].journal).toBe("alice");
    expect(by["a71c09de"].journal).toBe("alice");
    expect(by["7e57e57e"].journal).toBeNull();
  });

  it("keeps a stack on its own lines and scrubs it", () => {
    expect(entries[0].detail.split("\n")).toHaveLength(3);
    const hostile = parseLogEntries(line("[req-error] x GET /a journal=a b me@example.com Bearer abcdef.ghijkl"));
    expect(hostile[0].detail).not.toContain("me@example.com");
    expect(hostile[0].detail).not.toContain("abcdef.ghijkl");
  });

  it("refuses a journal name that is not a slug", () => {
    const e = parseLogEntries(line("[req] x GET /a 500 1ms journal=<script>alert(1) err=-"));
    expect(e[0].journal).toBeNull();
    const f = parseLogEntries(line("[req-error] x GET /a journal=../../etc boom"));
    expect(f[0].journal).toBeNull();
  });

  it("filters by level, journal, source and the routine switch", () => {
    const all = { level: "all", journal: "all", kind: "all", routine: false } as const;
    expect(filterLogs(entries, all).map((e) => e.id)).not.toContain("11111111");
    expect(filterLogs(entries, { ...all, routine: true }).map((e) => e.id)).toContain("11111111");
    expect(filterLogs(entries, { ...all, level: "warn" }).map((e) => e.id)).toEqual(["c0d15b7a"]);
    expect(filterLogs(entries, { ...all, journal: "alice" }).map((e) => e.id)).toEqual(["3f9a1c2e", "a71c09de", "9be44f10"]);
    expect(filterLogs(entries, { ...all, journal: "instance" }).map((e) => e.id)).toEqual(["7e57e57e", "44444444"]);
    expect(filterLogs(entries, { ...all, kind: "client-error" }).map((e) => e.id)).toEqual(["a71c09de"]);
  });
});

describe("readLogs", () => {
  it("passes fixed arguments only and clamps the window", async () => {
    let seen: string[] = [];
    const r = await readLogs(99999, async (args) => ((seen = args), { stdout: OUTPUT }));
    expect(seen).toContain("--since=-24h");
    expect(seen).toContain("--namespace=fernscout");
    expect(r.state).toBe("ok");
    expect(LOG_WINDOWS).toContain(24);
  });

  it("says why when journalctl is missing or refuses, instead of an empty list", async () => {
    const none = await readLogs(24, async () => ({ error: "spawn journalctl ENOENT", missing: true }));
    expect(none).toMatchObject({ state: "unavailable" });
    const denied = await readLogs(24, async () => ({ error: "No journal files were opened due to insufficient permissions." }));
    expect(denied).toMatchObject({ state: "unavailable" });
  });

  it("retries without --grep when journalctl has no PCRE2", async () => {
    const calls: string[][] = [];
    const r = await readLogs(24, async (args) => (calls.push(args), calls.length === 1 ? { error: "Compiled without pattern matching support" } : { stdout: OUTPUT }));
    expect(calls).toHaveLength(2);
    expect(calls[1].some((a) => a.startsWith("--grep"))).toBe(false);
    expect(r.state).toBe("ok");
  });
});
