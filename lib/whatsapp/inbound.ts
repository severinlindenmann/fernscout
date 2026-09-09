import "server-only";
import crypto from "node:crypto";

/**
 * Reading an inbound WhatsApp webhook — B1057.
 *
 * `lib/whatsapp/` only ever sent, until now: `cloud.ts` uploads a photograph
 * and sends an approved template, and `types.ts` says at length why its
 * message type has no free-form variant — outside a 24-hour window the Cloud
 * API accepts nothing else, and a publish notice is by definition
 * business-initiated. This file is the other half: the route Meta calls when
 * somebody replies.
 *
 * Modelled on `app/api/webhooks/stripe/route.ts`, which already solves the
 * same three problems a webhook always has — verify the sender, answer fast,
 * do not process the same event twice.
 */

/** `X-Hub-Signature-256` is `sha256=<hex>`, HMAC-SHA256 of the **raw** body
 * bytes under the app secret. Must run before anything parses the body —
 * re-serialising changes whitespace and key order, and the signature would
 * no longer match. Constant-time compare, the same discipline every secret
 * comparison in this codebase follows. */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const supplied = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(supplied, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** One inbound message, normalised out of Meta's envelope shape — text,
 * image, audio, document, location, contacts, interactive reply. What each
 * becomes is B1058 through B1060; this only says what arrived. */
export type InboundMessage =
  | { kind: "text"; id: string; from: string; timestamp: string; body: string }
  | {
      kind: "image" | "video" | "document" | "sticker";
      id: string;
      from: string;
      timestamp: string;
      mediaId: string;
      mimeType: string;
      sha256: string;
      caption?: string;
      filename?: string;
    }
  | {
      kind: "audio";
      id: string;
      from: string;
      timestamp: string;
      mediaId: string;
      mimeType: string;
      /** A held-button voice note, as opposed to an audio file somebody
       * forwarded — B1060 should treat the two differently. */
      voice: boolean;
    }
  | {
      kind: "location";
      id: string;
      from: string;
      timestamp: string;
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    }
  | {
      kind: "contacts";
      id: string;
      from: string;
      timestamp: string;
      contacts: Array<{ name?: string; phones?: string[]; emails?: string[] }>;
    }
  | {
      kind: "interactive";
      id: string;
      from: string;
      timestamp: string;
      replyId: string;
      title: string;
    }
  | { kind: "unsupported"; id: string; from: string; timestamp: string; type: string };

type MetaMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: MetaMedia;
  video?: MetaMedia;
  document?: MetaMedia & { filename?: string };
  sticker?: MetaMedia;
  audio?: MetaMedia & { voice?: boolean };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: Array<{
    name?: { formatted_name?: string };
    phones?: Array<{ wa_id?: string; phone?: string }>;
    emails?: Array<{ email?: string }>;
  }>;
  interactive?: {
    type?: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
};

type MetaMedia = { id: string; mime_type: string; sha256: string; caption?: string };

function normaliseOne(m: MetaMessage): InboundMessage {
  const base = { id: m.id, from: m.from, timestamp: m.timestamp };
  switch (m.type) {
    case "text":
      return { kind: "text", ...base, body: m.text?.body ?? "" };
    case "image":
    case "video":
    case "sticker": {
      const media = m[m.type as "image" | "video" | "sticker"] as MetaMedia | undefined;
      return {
        kind: m.type as "image" | "video" | "sticker",
        ...base,
        mediaId: media?.id ?? "",
        mimeType: media?.mime_type ?? "",
        sha256: media?.sha256 ?? "",
        ...(media?.caption ? { caption: media.caption } : {}),
      };
    }
    case "document":
      return {
        kind: "document",
        ...base,
        mediaId: m.document?.id ?? "",
        mimeType: m.document?.mime_type ?? "",
        sha256: m.document?.sha256 ?? "",
        ...(m.document?.caption ? { caption: m.document.caption } : {}),
        ...(m.document?.filename ? { filename: m.document.filename } : {}),
      };
    case "audio":
      return {
        kind: "audio",
        ...base,
        mediaId: m.audio?.id ?? "",
        mimeType: m.audio?.mime_type ?? "",
        voice: m.audio?.voice === true,
      };
    case "location":
      return {
        kind: "location",
        ...base,
        latitude: m.location?.latitude ?? 0,
        longitude: m.location?.longitude ?? 0,
        ...(m.location?.name ? { name: m.location.name } : {}),
        ...(m.location?.address ? { address: m.location.address } : {}),
      };
    case "contacts":
      return {
        kind: "contacts",
        ...base,
        contacts: (m.contacts ?? []).map((c) => ({
          ...(c.name?.formatted_name ? { name: c.name.formatted_name } : {}),
          ...(c.phones?.length
            ? { phones: c.phones.map((p) => p.wa_id ?? p.phone ?? "").filter(Boolean) }
            : {}),
          ...(c.emails?.length
            ? { emails: c.emails.map((e) => e.email ?? "").filter(Boolean) }
            : {}),
        })),
      };
    case "interactive": {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
      if (reply) return { kind: "interactive", ...base, replyId: reply.id, title: reply.title };
      return { kind: "unsupported", ...base, type: "interactive" };
    }
    default:
      return { kind: "unsupported", ...base, type: m.type };
  }
}

/** Every inbound message in one webhook delivery — a delivery can carry
 * several, from one conversation or several at once. Status updates
 * (`statuses[]` — delivered, read, failed) are not messages and are skipped
 * here; nothing in this ticket reads them. */
export function parseInboundMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = isRecord(body) && Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = isRecord(entry) && Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = isRecord(change) ? change.value : undefined;
      const messages = isRecord(value) && Array.isArray(value.messages) ? value.messages : [];
      for (const m of messages) {
        if (isRecord(m) && typeof m.id === "string" && typeof m.from === "string") {
          out.push(normaliseOne(m as MetaMessage));
        }
      }
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
