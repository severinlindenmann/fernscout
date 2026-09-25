import "server-only";
import http2 from "node:http2";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadServerConfig } from "../config";
import { dataDir } from "../dataDir";

/**
 * Sending to the iPhone shell — B2115.
 *
 * The shape mirrors `lib/sms/index.ts`: a dry-run transport that writes what
 * it would have sent and spends nothing, a real one that talks to Apple, and
 * `lib/capabilities.ts`'s `applePush` requirement is what decides which one
 * a caller gets. Deliberately no `apn`/`node-apn` dependency — an HTTP/2
 * POST and an ES256 JWT are both a few lines with `node:http2` and
 * `node:crypto` alone, the same restraint `lib/sms/index.ts`'s comment on
 * Twilio explains.
 */

export type ApnsMessage = {
  /** The device token APNs handed back at registration — this file's whole
   * reading of `StoredSubscription.endpoint` for `kind: "apns"`. */
  token: string;
  title: string;
  body: string;
  /** Same-origin path or absolute URL the tap should open — the AppDelegate
   * validates it again on the way in (`ios/App/App/AppDelegate.swift`), so a
   * wrong value here costs a silent no-op tap, never a load. */
  url: string;
  /** Coalescing key — mirrors the web payload's `tag`. */
  tag: string;
};

export type ApnsConfig = {
  keyId: string;
  teamId: string;
  /** The `.p8` file's contents, PEM, straight from the environment — never
   * written to disk, the same rule every other credential here follows. */
  key: string;
  topic: string;
  environment: "production" | "sandbox";
};

/** Reads the four `APNS_*` variables `lib/capabilities.ts`'s `applePush`
 * requirement already checked are present before a real send is ever
 * attempted; null here only when a caller reaches this with none configured,
 * which the dry-run transport below is what runs instead. */
function apnsConfigFromEnv(): ApnsConfig | null {
  const { APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY, APNS_TOPIC, APNS_ENVIRONMENT } = process.env;
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_KEY) return null;
  return {
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    key: APNS_KEY,
    topic: APNS_TOPIC && APNS_TOPIC.trim() !== "" ? APNS_TOPIC : "ch.fernscout.app",
    environment: APNS_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A fresh ES256 provider JWT, one per send.
 *
 * Apple's own guidance is to reuse a token for up to an hour rather than
 * mint one per request; this signs one every time instead, which is
 * simplest and — at the notify script's own call volume, a handful of sends
 * per published day — cheap enough not to matter.
 *
 * ponytail: no per-process cache. Add one (keyed by `keyId`, refreshed past
 * ~50 minutes) if a batch send ever makes the signing cost visible.
 *
 * `dsaEncoding: "ieee-p1363"` is what makes this dependency-free: Node's
 * default EC signature is DER, and a JWS wants the raw r‖s pair instead.
 */
export function apnsProviderToken(config: ApnsConfig): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(Date.now() / 1000) }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: config.key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

export type ApnsSendResult =
  | { ok: true }
  | {
      ok: false;
      /** Apple's own signal that this token will never work again —
       * `410 Unregistered`, or `400 BadDeviceToken`. Everything else is
       * worth logging and leaving the subscription alone. */
      gone: boolean;
      status: number;
      body: string;
    };

/** One HTTP/2 POST to Apple's provider API. A fresh connection per call: the
 * notify script's whole run is a handful of sends, not a channel worth
 * pooling — see the JWT comment above for the same call. */
function postToApns(
  config: ApnsConfig,
  message: ApnsMessage,
): Promise<ApnsSendResult> {
  const host = config.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const payload = JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: "default" },
    url: message.url,
    tag: message.tag,
  });

  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    client.on("error", reject);

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${message.token}`,
      authorization: `bearer ${apnsProviderToken(config)}`,
      "apns-topic": config.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let body = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      client.close();
      if (status === 200) {
        resolve({ ok: true });
        return;
      }
      const reason = (() => {
        try {
          return (JSON.parse(body) as { reason?: string }).reason;
        } catch {
          return undefined;
        }
      })();
      const gone = status === 410 || (status === 400 && reason === "BadDeviceToken");
      resolve({ ok: false, gone, status, body });
    });
    req.on("error", (err) => {
      client.close();
      reject(err);
    });
    req.end(payload);
  });
}

/** Writes the payload it would have sent, and sends nothing — the same
 * `dataDir()/apns/` shape `lib/sms/index.ts`'s dry-run writes under `sms/`.
 * What lets B2115 be developed and tested with no Apple developer account
 * at all. */
function dryRunSend(message: ApnsMessage): ApnsSendResult {
  const dir = path.join(dataDir(), "apns");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${message.token.slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify(message, null, 2) + "\n", "utf8");
  console.log(`[apns:dry-run] ${message.token.slice(0, 8)}… -> ${file}`);
  return { ok: true };
}

function backendName(): string {
  const configured = loadServerConfig().features.applePush?.backend;
  return typeof configured === "string" ? configured : "dry-run";
}

/**
 * Send one notification to one iPhone shell.
 *
 * `dry-run` (the default, and what every checkout with no `APNS_*`
 * environment gets) never reaches Apple. `apns` needs `apnsConfigFromEnv()`
 * to resolve — `lib/capabilities.ts`'s `applePush` requirement is what
 * refuses the capability at boot if it cannot — and throws rather than
 * silently downgrading to dry-run if it is somehow reached with a real
 * backend configured but no working key, the same "never claim success"
 * rule `lib/sms/index.ts#sendSms` follows.
 */
export async function sendApnsNotification(message: ApnsMessage): Promise<ApnsSendResult> {
  const backend = backendName();
  if (backend === "dry-run") return dryRunSend(message);

  const config = apnsConfigFromEnv();
  if (!config) {
    throw new Error(
      "features.applePush.backend is \"apns\" but APNS_KEY_ID/APNS_TEAM_ID/APNS_KEY are not all set.",
    );
  }
  return postToApns(config, message);
}
