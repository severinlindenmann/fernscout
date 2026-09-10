import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import type { Proposal } from "../helper/blocks";

/**
 * The one proposal a WhatsApp accept/decline tap can still be about — B1230.
 *
 * Held on disk, not in memory, for the same reason `held.ts` is: a tap can
 * arrive minutes or hours after the buttons went out, quite possibly on a
 * different warm process than the one that sent them.
 *
 * **At most one, and a later proposal overwrites an earlier, unpressed
 * one** — the same rule `held.ts` states for itself. A person is only ever
 * shown one waiting write at a time on this channel, so there is nothing to
 * queue.
 *
 * **Take-once.** `takePendingProposal` deletes the file it reads, which is
 * the whole of the idempotency guarantee: a stale button — already pressed,
 * or superseded by a newer proposal, or Meta redelivering a tap under a
 * fresh wamid the webhook's own dedupe never saw before — finds nothing
 * waiting and is told so rather than being run again.
 */

function pendingPath(username: string, tel: string): string {
  return path.join(contentRoot(), username, "whatsapp", ".pending-proposal", `${tel}.json`);
}

export function holdProposal(username: string, tel: string, proposal: Proposal): void {
  const file = pendingPath(username, tel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
}

/** Read and clear whatever proposal is waiting for this number, or `null` if
 *  none is — a take, not a peek, so the same proposal can never be pressed
 *  twice from two taps that both found the file still there. */
export function takePendingProposal(username: string, tel: string): Proposal | null {
  const file = pendingPath(username, tel);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Proposal;
    fs.rmSync(file, { force: true });
    if (typeof raw.tool !== "string" || typeof raw.endpoint !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}
