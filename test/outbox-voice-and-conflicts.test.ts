import { describe, expect, it } from "vitest";
import {
  decideReplay,
  keepPhoneVersion,
  keepServerVersion,
  newIntent,
  pendingConflicts,
  pendingVoiceTranscripts,
  runOutbox,
  type DayEditConflict,
  type OutboxIntent,
  type OutboxStore,
} from "@/lib/outbox";

/** B2331 — its own in-memory `OutboxStore`, deliberately not shared with
 *  `test/outbox.test.ts` (a second builder's own wave touches that file's
 *  `media.upload` path at the same time); a structured-clone `list`, same
 *  as that file's own, so a test never passes by accident on sharing
 *  IndexedDB never gives it. */
function memoryStore(seed: OutboxIntent[]): OutboxStore & { rows: OutboxIntent[] } {
  const rows = [...seed];
  return {
    rows,
    async list(user) {
      return rows
        .filter((r) => r.user === user)
        .map((r) => structuredClone(r))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async add(intent) {
      rows.push(intent);
    },
    async remove(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
    async setState(id, state, details) {
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.state = state;
        if (details !== undefined) row.details = details;
      }
    },
    async clear(user) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].user === user) rows.splice(i, 1);
    },
    async remapMediaId() {
      // Not exercised by this file's own intents.
    },
  };
}

/** `newIntent` always sets `state: "pending"` — right for the shape a queue
 *  actually starts in, wrong for a test that wants to fabricate one already
 *  `"transcribed"` or `"conflict"`. `state`/`details` are applied after, the
 *  same way `id`/`createdAt` already are below. */
function voiceIntent(over: Partial<OutboxIntent> = {}): OutboxIntent {
  return {
    ...newIntent({
      user: "severin",
      kind: "voice.note",
      method: "POST",
      url: "/api/helper/severin/transcribe",
      body: { date: "2026-04-02", mediaType: "audio/webm", seconds: 12, language: "en", locale: "en" },
      blob: new Blob(["fake-audio-bytes"], { type: "audio/webm" }),
      ...over,
    }),
    ...(over.id ? { id: over.id } : {}),
    ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    ...(over.state ? { state: over.state } : {}),
    ...(over.details !== undefined ? { details: over.details } : {}),
  };
}

function editIntent(over: Partial<OutboxIntent> = {}): OutboxIntent {
  return {
    ...newIntent({
      user: "severin",
      kind: "day.edit",
      method: "PATCH",
      url: "/api/web/severin/trips/japan-2026/days/2026-04-02-kyoto",
      body: { content: "Walked around the old town." },
      headers: { "if-match": "v1" },
      ...over,
    }),
    ...(over.id ? { id: over.id } : {}),
    ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    ...(over.state ? { state: over.state } : {}),
    ...(over.details !== undefined ? { details: over.details } : {}),
  };
}

describe("voice.note (B2331, D4 — a voice note recorded offline)", () => {
  it("2xx with a transcript moves the intent to 'transcribed' rather than removing it", async () => {
    const store = memoryStore([voiceIntent()]);
    const calls: { url: string; body: string } = { url: "", body: "" };
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.url = String(url);
      calls.body = String(init?.body ?? "");
      return { status: 200, json: async () => ({ ok: true, text: "Walked around the old town." }) } as Response;
    };
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.done).toBe(1);
    expect(outcome.transcribed).toBe(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].state).toBe("transcribed");
    expect(store.rows[0].details).toBe("Walked around the old town.");
    // The Blob went out as base64 JSON, not multipart — the transcribe
    // route (`app/api/helper/[user]/transcribe/route.ts`) has no multipart
    // handling at all.
    expect(calls.url).toBe("/api/helper/severin/transcribe");
    const sent = JSON.parse(calls.body);
    expect(sent.date).toBe("2026-04-02");
    expect(typeof sent.audio).toBe("string");
    expect(sent.audio.length).toBeGreaterThan(0);
  });

  it("2xx with an empty transcript (silence) is simply dropped — nothing for the owner to confirm", async () => {
    const store = memoryStore([voiceIntent()]);
    const outcome = await runOutbox(store, "severin", async () => ({ status: 200, json: async () => ({ ok: true, text: "" }) }) as unknown as Response);
    expect(outcome.done).toBe(1);
    expect(outcome.transcribed ?? 0).toBe(0);
    expect(store.rows).toHaveLength(0);
  });

  it("a network error leaves it pending for the next run, same as any other kind", async () => {
    const store = memoryStore([voiceIntent()]);
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.stoppedForRetry).toBe(true);
    expect(store.rows[0].state).toBe("pending");
  });
});

describe("pendingVoiceTranscripts", () => {
  it("lists only this owner's transcribed voice notes, by date", async () => {
    const store = memoryStore([
      voiceIntent({ id: "a", body: { date: "2026-04-02" }, state: "transcribed", details: "Kyoto words" }),
      voiceIntent({ id: "b", body: { date: "2026-04-03" }, state: "pending" }),
      voiceIntent({ id: "c", user: "viki", body: { date: "2026-04-02" }, state: "transcribed", details: "not mine" }),
    ]);
    const rows = await pendingVoiceTranscripts(store, "severin");
    expect(rows).toEqual([{ id: "a", date: "2026-04-02", text: "Kyoto words" }]);
  });
});

describe("day.edit conflict — the two-versions screen (B2331, D3)", () => {
  it("a 409 stale_document keeps the response body on the intent as 'details'", async () => {
    const store = memoryStore([editIntent()]);
    const serverDoc = { content: "Someone else's paragraph.", title: "Kyoto" };
    const fetchImpl = async (): Promise<Response> =>
      ({ status: 409, json: async () => ({ error: "stale_document", details: serverDoc }) }) as Response;
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.conflicts).toBe(1);
    expect(store.rows[0].state).toBe("conflict");
    expect(store.rows[0].details).toEqual({ error: "stale_document", details: serverDoc });
  });

  it("pendingConflicts reads the phone's own patch and the server's current doc apart", async () => {
    const serverDoc = { content: "Someone else's paragraph.", title: "Kyoto" };
    const store = memoryStore([
      editIntent({
        id: "e1",
        state: "conflict",
        details: { error: "stale_document", details: serverDoc },
      }),
    ]);
    const conflicts = await pendingConflicts(store, "severin");
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c.phonePatch).toEqual({ content: "Walked around the old town." });
    expect(c.serverDoc).toEqual(serverDoc);
    expect(c.url).toBe("/api/web/severin/trips/japan-2026/days/2026-04-02-kyoto");
  });

  it("keepPhoneVersion re-reads the fresh etag and resends, then removes the intent once accepted", async () => {
    const conflict: DayEditConflict = {
      id: "e1",
      url: "/api/web/severin/trips/japan-2026/days/2026-04-02-kyoto",
      createdAt: "2026-04-02T10:00:00.000Z",
      phonePatch: { content: "Walked around the old town." },
      serverDoc: { content: "Someone else's paragraph." },
    };
    const store = memoryStore([editIntent({ id: "e1" })]);
    const calls: { method: string; headers: Record<string, string> }[] = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      calls.push({ method, headers: (init?.headers as Record<string, string>) ?? {} });
      if (method === "GET") return { ok: true, status: 200, json: async () => ({ etag: "v2" }) } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    };
    const ok = await keepPhoneVersion(store, conflict, fetchImpl);
    expect(ok).toBe(true);
    expect(store.rows).toHaveLength(0);
    expect(calls[0].method).toBe("GET");
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].headers["if-match"]).toBe("v2");
  });

  it("keepPhoneVersion leaves the conflict in place when the resend still fails", async () => {
    const conflict: DayEditConflict = {
      id: "e1",
      url: "/api/web/severin/trips/japan-2026/days/2026-04-02-kyoto",
      createdAt: "2026-04-02T10:00:00.000Z",
      phonePatch: { content: "Walked around the old town." },
      serverDoc: null,
    };
    const store = memoryStore([editIntent({ id: "e1", state: "conflict" })]);
    const fetchImpl = async (): Promise<Response> => ({ ok: false, status: 409, json: async () => ({}) }) as Response;
    const ok = await keepPhoneVersion(store, conflict, fetchImpl);
    expect(ok).toBe(false);
    expect(store.rows).toHaveLength(1);
  });

  it("keepServerVersion drops the intent — the phone's own words are not sent", async () => {
    const conflict: DayEditConflict = {
      id: "e1",
      url: "/api/web/severin/trips/japan-2026/days/2026-04-02-kyoto",
      createdAt: "2026-04-02T10:00:00.000Z",
      phonePatch: { content: "Walked around the old town." },
      serverDoc: null,
    };
    const store = memoryStore([editIntent({ id: "e1", state: "conflict" })]);
    await keepServerVersion(store, conflict);
    expect(store.rows).toHaveLength(0);
  });
});

describe("decideReplay is unaffected for kinds this file does not touch", () => {
  it("day.edit 2xx is still done", () => {
    expect(decideReplay(200, { ok: true }, editIntent()).action).toBe("done");
  });
});
