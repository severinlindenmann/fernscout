import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isValidUsername, userDir } from "../users";

/**
 * Whether the owner wants the studio's assistant offered to them — TIX-2's
 * add-a-day flow asks once, remembers the answer, and does not ask again.
 * `null` means never asked. The same storage shape and reasoning as
 * `readTellBy`/`writeTellBy` (`./tellBy.ts`): a small file beside the
 * journal, the journal's own answer, nothing to migrate — its own file
 * (`studio-assistant.json`) rather than folded into `studio-prefs.json`, so
 * writing one preference can never silently overwrite the other.
 */
export const ASSISTANT_CHOICES = ["on", "off"] as const;
export type AssistantChoice = (typeof ASSISTANT_CHOICES)[number];

export function isAssistantChoice(value: unknown): value is AssistantChoice {
  return (ASSISTANT_CHOICES as readonly unknown[]).includes(value);
}

function prefsFile(username: string): string {
  if (!isValidUsername(username)) throw new Error(`studio: bad username "${username}"`);
  return path.join(userDir(username), "studio-assistant.json");
}

export function readAssistantChoice(username: string): AssistantChoice | null {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsFile(username), "utf8")) as { assistant?: unknown };
    return isAssistantChoice(raw.assistant) ? raw.assistant : null;
  } catch {
    return null;
  }
}

export function writeAssistantChoice(username: string, assistant: AssistantChoice): void {
  fs.writeFileSync(prefsFile(username), `${JSON.stringify({ assistant }, null, 2)}\n`);
}
