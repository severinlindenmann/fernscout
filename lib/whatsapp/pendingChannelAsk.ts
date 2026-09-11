import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";

/**
 * Whether a channel opt-in ask is outstanding for this number — B1404.
 *
 * `journalForNumber()` resolves only the owner's own proven `tel` (see
 * `lib/registry.ts`), so a number ever reaching `handleInboundMessage`'s
 * channel-off branch with a non-null `username` is provably the journal's
 * owner — there is no further identity check for this ask to make. The
 * marker is the same shape as `speechConsent.ts`'s: no TTL, and cleared the
 * moment the next message resolves it, whatever it says, so a chat that
 * asked once does not keep intercepting every later message.
 */

function markerPath(username: string, tel: string): string {
  return path.join(contentRoot(), username, "whatsapp", ".channel-ask", `${tel}.json`);
}

export function hasPendingChannelAsk(username: string, tel: string): boolean {
  return fs.existsSync(markerPath(username, tel));
}

export function markPendingChannelAsk(username: string, tel: string): void {
  const file = markerPath(username, tel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tel, askedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
}

export function clearPendingChannelAsk(username: string, tel: string): void {
  fs.rmSync(markerPath(username, tel), { force: true });
}
