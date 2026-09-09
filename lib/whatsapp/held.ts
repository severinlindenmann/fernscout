import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import type { WhatsappOutbound } from "./render";

/**
 * An answer that was ready before the window was — B1061.
 *
 * "Never initiate" (the owner's own decision, confirmed without exception)
 * means an answer that becomes ready after the window closes cannot go out
 * as a template the way a day announcement does. So it waits here instead,
 * and is delivered the next time this number writes — which reopens the
 * window and is the one moment sending it is honest.
 *
 * **At most one, and a later one overwrites an earlier, unsent one** — the
 * owner's own answer to the storage question. Two unrelated things ready at
 * once is rare enough that queueing them is a feature nobody asked for, and
 * an overwritten answer is never a lost one: whatever produced it can be
 * asked again.
 */

function heldPath(username: string, tel: string): string {
  return path.join(contentRoot(), username, "whatsapp", ".held", `${tel}.json`);
}

export type HeldAnswer = { heldAt: string; outbound: WhatsappOutbound };

export function holdAnswer(username: string, tel: string, outbound: WhatsappOutbound): void {
  const file = heldPath(username, tel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ tel, heldAt: new Date().toISOString(), outbound } satisfies { tel: string } & HeldAnswer, null, 2) + "\n",
    "utf8",
  );
}

/** Read and clear whatever is held for this number, or `null` if nothing is
 *  — a take, not a peek: this is called exactly once, when the window has
 *  just reopened, and the same held answer must never be delivered twice. */
export function takeHeldAnswer(username: string, tel: string): HeldAnswer | null {
  const file = heldPath(username, tel);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { heldAt: string; outbound: WhatsappOutbound };
    fs.rmSync(file, { force: true });
    if (typeof raw.heldAt !== "string" || !raw.outbound) return null;
    return { heldAt: raw.heldAt, outbound: raw.outbound };
  } catch {
    return null;
  }
}
