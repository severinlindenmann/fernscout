import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isValidUsername, userDir } from "../users";
import { isTellBy, type TellBy } from "./speak";

/**
 * The owner's answer to "How do you like to tell it?" — B2194. A file beside
 * the journal (`studio-prefs.json`), the same reasoning `helper-consent.json`
 * gives: it is the journal's own answer, it travels with the folder, and there
 * is nothing to migrate. `null` means never asked.
 */
function prefsFile(username: string): string {
  if (!isValidUsername(username)) throw new Error(`studio: bad username "${username}"`);
  return path.join(userDir(username), "studio-prefs.json");
}

export function readTellBy(username: string): TellBy | null {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsFile(username), "utf8")) as { tellBy?: unknown };
    return isTellBy(raw.tellBy) ? raw.tellBy : null;
  } catch {
    return null;
  }
}

export function writeTellBy(username: string, tellBy: TellBy): void {
  fs.writeFileSync(prefsFile(username), `${JSON.stringify({ tellBy }, null, 2)}\n`);
}
