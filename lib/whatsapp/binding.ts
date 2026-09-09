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
