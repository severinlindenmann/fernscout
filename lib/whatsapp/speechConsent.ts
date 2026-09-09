import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";

/**
 * Whether a `speech` consent ask is outstanding for this number — B1060.
 *
 * A voice note needs a second consent from the one B1138's acknowledgement
 * already recorded: `speech` names a *second* provider (Deepgram, not
 * Anthropic), and `lib/helper/consent.ts`'s whole design is that a yes to one
 * scope is never read as a yes to another. So the first voice note from a
 * number that has not agreed asks, in chat, and this marker is the only state
 * needed to read the next message as an answer to that ask rather than as an
 * ordinary sentence: set when the ask goes out, cleared the moment anything
 * resolves it — a "yes", or anything else, since a chat that asked once and
 * moved on must not keep intercepting every later message forever.
 */

function markerPath(username: string, tel: string): string {
  return path.join(contentRoot(), username, "whatsapp", ".speech-consent-ask", `${tel}.json`);
}

export function hasPendingSpeechAsk(username: string, tel: string): boolean {
  return fs.existsSync(markerPath(username, tel));
}

export function markPendingSpeechAsk(username: string, tel: string): void {
  const file = markerPath(username, tel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tel, askedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
}

export function clearPendingSpeechAsk(username: string, tel: string): void {
  fs.rmSync(markerPath(username, tel), { force: true });
}
