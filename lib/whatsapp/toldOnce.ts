import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";

/**
 * Something said once per number, never again — B1059.
 *
 * The documents-versus-photos tip and the "video isn't supported yet"
 * sentence are both this shape: true every time, worth saying the first time
 * it matters, and a nuisance repeated on every photograph somebody sends
 * after that. `topic` keeps the two (and whatever comes next) from sharing
 * one marker — telling somebody about documents once must not also suppress
 * telling them about video once.
 *
 * Per number, sibling of `./binding.ts`'s `.greeted`/`.acknowledged`
 * markers — the owner's own answer to where this state lives.
 */

function markerPath(username: string, tel: string, topic: string): string {
  return path.join(contentRoot(), username, "whatsapp", `.told-${topic}`, `${tel}.json`);
}

export function hasBeenTold(username: string, tel: string, topic: string): boolean {
  return fs.existsSync(markerPath(username, tel, topic));
}

export function markTold(username: string, tel: string, topic: string): void {
  const file = markerPath(username, tel, topic);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tel, toldAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
}
