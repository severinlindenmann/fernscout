import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B2115 — the iPhone shell's own sender.
 *
 * `lib/push/apns.ts` is dependency-free by design (`node:http2` and
 * `node:crypto` only, mirroring `lib/sms/index.ts`'s reasoning about
 * Twilio), which is exactly what makes it mockable with nothing more than a
 * fake `http2.connect()` here — no fixture server, no real Apple account.
 */

let dir: string;
let keyPem: string;
let publicKey: crypto.KeyObject;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-apns-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-apns-data-"));
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  keyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  publicKey = pair.publicKey;
  process.env.APNS_KEY_ID = "KEY123";
  process.env.APNS_TEAM_ID = "TEAM123";
  process.env.APNS_KEY = keyPem;
  process.env.APNS_TOPIC = "ch.fernscout.app";
});

afterEach(async () => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_TEAM_ID;
  delete process.env.APNS_KEY;
  delete process.env.APNS_TOPIC;
  delete process.env.APNS_ENVIRONMENT;
  vi.doUnmock("node:http2");
  vi.resetModules();
  const { clearConfigCache } = await import("@/lib/config");
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeConfig(backend: string) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { applePush: { enabled: true, backend } },
    }),
  );
}

describe("apnsProviderToken", () => {
  test("accepts the key written on one line with literal \\n, as an env file carries it", async () => {
    const { apnsProviderToken } = await import("@/lib/push/apns");
    const oneLine = keyPem.trim().split("\n").join("\\n");
    expect(oneLine).not.toContain("\n");
    const token = apnsProviderToken({ keyId: "K", teamId: "T", key: oneLine, topic: "ch.fernscout.app", environment: "production" });
    const [header, claims, signature] = token.split(".");
    expect(
      crypto.verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")),
    ).toBe(true);
  });

  test("is a three-part JWT the matching public key can verify", async () => {
    const { apnsProviderToken } = await import("@/lib/push/apns");
    const token = apnsProviderToken({
      keyId: "KEY123",
      teamId: "TEAM123",
      key: keyPem,
      topic: "ch.fernscout.app",
      environment: "production",
    });
    const [header, claims, signature] = token.split(".");
    expect(header).toBeTruthy();
    expect(claims).toBeTruthy();
    expect(signature).toBeTruthy();

    const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(decode(claims).iss).toBe("TEAM123");
    expect(typeof decode(claims).iat).toBe("number");

    const verified = crypto.verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(verified).toBe(true);
  });
});

describe("sendApnsNotification — dry-run (default, and with backend unset)", () => {
  test("writes the payload under dataDir()/apns/ and sends nothing", async () => {
    writeConfig("dry-run");
    const { sendApnsNotification } = await import("@/lib/push/apns");
    const result = await sendApnsNotification({
      token: "deadbeef",
      title: "Hoi An",
      body: "Vietnam",
      url: "https://t.test/ana/day/hoi-an",
      tag: "day-hoi-an",
    });
    expect(result).toEqual({ ok: true });

    const written = fs.readdirSync(path.join(process.env.DATA_DIR!, "apns"));
    expect(written).toHaveLength(1);
    const payload = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR!, "apns", written[0]), "utf8"));
    expect(payload).toEqual({
      token: "deadbeef",
      title: "Hoi An",
      body: "Vietnam",
      url: "https://t.test/ana/day/hoi-an",
      tag: "day-hoi-an",
    });
  });
});

/** A fake `http2.ClientHttp2Stream` — just enough of the event contract
 *  `lib/push/apns.ts` reads (`response`, `data`, `end`) to drive both
 *  branches without a real socket. */
function fakeStream(
  status: number,
  body: string,
): EventEmitter & { end: (b: unknown) => void; setEncoding: (enc: string) => void } {
  const stream = new EventEmitter() as EventEmitter & {
    end: (b: unknown) => void;
    setEncoding: (enc: string) => void;
  };
  stream.setEncoding = () => undefined;
  stream.end = () => {
    queueMicrotask(() => {
      stream.emit("response", { ":status": status });
      stream.emit("data", body);
      stream.emit("end");
    });
  };
  return stream;
}

describe("sendApnsNotification — real backend (http2 mocked)", () => {
  test("200: ok", async () => {
    writeConfig("apns");
    vi.doMock("node:http2", () => ({
      default: {
        connect: () => ({
          request: () => fakeStream(200, ""),
          close: () => undefined,
          on: () => undefined,
        }),
      },
    }));
    const { sendApnsNotification } = await import("@/lib/push/apns");
    const result = await sendApnsNotification({
      token: "deadbeef",
      title: "t",
      body: "b",
      url: "https://t.test/x",
      tag: "day-x",
    });
    expect(result).toEqual({ ok: true });
  });

  test("410 Unregistered: gone, so the caller prunes the subscription", async () => {
    writeConfig("apns");
    vi.doMock("node:http2", () => ({
      default: {
        connect: () => ({
          request: () => fakeStream(410, JSON.stringify({ reason: "Unregistered" })),
          close: () => undefined,
          on: () => undefined,
        }),
      },
    }));
    const { sendApnsNotification } = await import("@/lib/push/apns");
    const result = await sendApnsNotification({
      token: "deadbeef",
      title: "t",
      body: "b",
      url: "https://t.test/x",
      tag: "day-x",
    });
    expect(result).toEqual({ ok: false, gone: true, status: 410, body: JSON.stringify({ reason: "Unregistered" }) });
  });

  test("400 BadDeviceToken: gone, the same as 410", async () => {
    writeConfig("apns");
    vi.doMock("node:http2", () => ({
      default: {
        connect: () => ({
          request: () => fakeStream(400, JSON.stringify({ reason: "BadDeviceToken" })),
          close: () => undefined,
          on: () => undefined,
        }),
      },
    }));
    const { sendApnsNotification } = await import("@/lib/push/apns");
    const result = await sendApnsNotification({
      token: "deadbeef",
      title: "t",
      body: "b",
      url: "https://t.test/x",
      tag: "day-x",
    });
    expect(result.ok).toBe(false);
    expect((result as { gone: boolean }).gone).toBe(true);
  });

  test("400 for any other reason: not gone, left alone", async () => {
    writeConfig("apns");
    vi.doMock("node:http2", () => ({
      default: {
        connect: () => ({
          request: () => fakeStream(400, JSON.stringify({ reason: "PayloadTooLarge" })),
          close: () => undefined,
          on: () => undefined,
        }),
      },
    }));
    const { sendApnsNotification } = await import("@/lib/push/apns");
    const result = await sendApnsNotification({
      token: "deadbeef",
      title: "t",
      body: "b",
      url: "https://t.test/x",
      tag: "day-x",
    });
    expect(result).toEqual({ ok: false, gone: false, status: 400, body: JSON.stringify({ reason: "PayloadTooLarge" }) });
  });

  test("the request carries the topic, an alert push type and a bearer JWT", async () => {
    writeConfig("apns");
    const requests: Record<string, unknown>[] = [];
    vi.doMock("node:http2", () => ({
      default: {
        connect: () => ({
          request: (headers: Record<string, unknown>) => {
            requests.push(headers);
            return fakeStream(200, "");
          },
          close: () => undefined,
          on: () => undefined,
        }),
      },
    }));
    const { sendApnsNotification } = await import("@/lib/push/apns");
    await sendApnsNotification({ token: "deadbeef", title: "t", body: "b", url: "https://t.test/x", tag: "day-x" });

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req[":path"]).toBe("/3/device/deadbeef");
    expect(req["apns-topic"]).toBe("ch.fernscout.app");
    expect(req["apns-push-type"]).toBe("alert");
    expect(String(req.authorization)).toMatch(/^bearer /);
  });

  test("throws rather than silently sending nothing when the backend is 'apns' but the key is missing", async () => {
    writeConfig("apns");
    delete process.env.APNS_KEY;
    const { sendApnsNotification } = await import("@/lib/push/apns");
    await expect(
      sendApnsNotification({ token: "deadbeef", title: "t", body: "b", url: "https://t.test/x", tag: "day-x" }),
    ).rejects.toThrow(/APNS_KEY/);
  });
});
