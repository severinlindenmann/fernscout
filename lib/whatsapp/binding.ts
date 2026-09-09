import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";

/**
 * Whether this is the first message from a bound number — B1058.
 *
 * The three disclosures (it's an AI, which journal, the consent notice) go
 * out **once**, on the first message of a binding, never on every
 * conversation. A marker file rather than a database row: it belongs beside
 * the journal it is about, the way `content/<user>/whatsapp/` already holds
 * the dry-run announcement payloads, and — like the registry lock in
 * `lib/registry.ts` — it is a fact about *this* number having been greeted,
 * not content, so it lives under a dotted folder a backup can still pick up
 * without anybody mistaking it for a day.
 */

function markerPath(username: string, tel: string): string {
  return path.join(contentRoot(), username, "whatsapp", ".greeted", `${tel}.json`);
}

export function hasBeenGreeted(username: string, tel: string): boolean {
  return fs.existsSync(markerPath(username, tel));
}

export function markGreeted(username: string, tel: string): void {
  const file = markerPath(username, tel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tel, greetedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
}

/**
 * Whether the disclosure sent with the first reply has been acknowledged —
 * B1138. The mockup B1058 was built against ends the first message with
 * "Reply 'yes' to continue", and this is the marker that fact needed and did
 * not yet have: `hasBeenGreeted` above only says the disclosure went *out*,
 * never whether anybody agreed to it. `lib/whatsapp/acknowledge.ts` is what
 * decides whether a given message counts as a "yes"; this only remembers the
 * answer, the same shape as its neighbour above.
 */
function ackMarkerPath(username: string, tel: string): string {
  return path.join(contentRoot(), username, "whatsapp", ".acknowledged", `${tel}.json`);
}

export function hasAcknowledged(username: string, tel: string): boolean {
  return fs.existsSync(ackMarkerPath(username, tel));
}

export function markAcknowledged(username: string, tel: string): void {
  const file = ackMarkerPath(username, tel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tel, acknowledgedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
}
