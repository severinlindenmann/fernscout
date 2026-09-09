import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";

/**
 * Meta's 24-hour customer service window — B1061.
 *
 * A message from a person opens it; inside it a business may reply freely
 * and at no charge; outside it, only an approved template may be sent, and
 * each one is billed. **This channel never initiates**, so the only question
 * this module answers is whether *this* number's window is still open — the
 * timestamp of the last inbound message is the whole of it.
 *
 * A marker file, the same shape `./binding.ts`'s `.greeted`/`.acknowledged`
 * markers use, updated on **every** inbound message rather than only the
 * first — that is the one thing that makes it different from those two.
 */

function markerPath(username: string, tel: string): string {
  return path.join(contentRoot(), username, "whatsapp", ".window", `${tel}.json`);
}

/** Record that a message just arrived from this number — opens (or extends)
 *  the window. Called once, at the top of `handleInboundMessage`, before
 *  anything is sent — so the reply this same message provokes always finds
 *  the window it just opened. */
export function markInbound(username: string, tel: string, at: number = Date.now()): void {
  const file = markerPath(username, tel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tel, lastInboundAt: new Date(at).toISOString() }, null, 2) + "\n", "utf8");
}

function lastInboundAt(username: string, tel: string): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(markerPath(username, tel), "utf8")) as { lastInboundAt?: unknown };
    const at = typeof raw.lastInboundAt === "string" ? new Date(raw.lastInboundAt).getTime() : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    // No marker yet, or an unreadable one: the safe reading is "closed" —
    // nobody has proven this window open.
    return null;
  }
}

/** Whether a reply to this number may go out right now. Exported so a
 *  caller (`lib/whatsapp/dispatch.ts`) can decide to hold an answer *before*
 *  spending anything on producing one, not only after — B1061's own answer
 *  to "where does the check live". */
export function isWindowOpen(username: string, tel: string, now: number = Date.now()): boolean {
  const last = lastInboundAt(username, tel);
  return last !== null && now - last < 24 * 60 * 60 * 1000;
}
