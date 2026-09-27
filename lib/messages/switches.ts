import "server-only";
import { getDatabase, getDatabaseOrNull, nowIso } from "../db";
import { FAMILIES, TEMPLATES, type Flow, type TemplateId } from "./registry";

/**
 * The operator's per-message-kind kill switches — B2446
 * (docs/plans/W44-messages.md, "Switches"). A row in `message_switches`
 * means "off"; no row means "on" — the send helpers below are the only
 * callers that decide anything from it, and the admin API
 * (`app/api/admin/messages/switches/route.ts`) is the only writer.
 *
 * **Required families are never switchable.** `code`, `receipt`, `notice`
 * and `chat` (`FAMILIES[...].class === "required"`) answer `false` here
 * regardless of what the table says, and `setSwitch` refuses to write one
 * for a required template — a code mail nobody can turn off is the whole
 * point of "required" (AGENTS.md, W44 D…). A flow id is never fully
 * required-only in the registry today, so a flow-level switch is honoured
 * unless the specific template being sent is itself required.
 */

/** A key this table accepts: a bare template id, `"<flowId>/<templateId>"`,
 * or a bare flow id (switches every template in that flow at once — the
 * check below tries the most specific key first). */
export type SwitchKey = string;

function isRequired(template: TemplateId): boolean {
  return FAMILIES[TEMPLATES[template].family].class === "required";
}

/**
 * Whether a send for `template` (optionally inside `flow`) must be skipped.
 * Checked in order from most to least specific: `flow/template`, `template`,
 * `flow`. **Never throws, never true with no database** — the same absent-
 * capability contract every other optional switch in this codebase keeps.
 */
export async function isSwitchedOff(template: TemplateId, flow?: Flow["id"]): Promise<boolean> {
  if (isRequired(template)) return false;
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const keys = flow ? [`${flow}/${template}`, template, flow] : [template];
  try {
    const rows = await handle.db.selectFrom("message_switches").select("key").where("key", "in", keys).execute();
    return rows.length > 0;
  } catch (err) {
    console.warn("[messages] could not read switches:", err);
    return false;
  }
}

export type SwitchRow = { key: SwitchKey; updatedBy: string; updatedAt: string };

/** Every switch currently off — the bar at the top of admin's Messages
 * panel, and the list `POST .../switches` reads before writing. Empty with
 * no database. */
export async function listSwitches(): Promise<SwitchRow[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db.selectFrom("message_switches").selectAll().orderBy("updated_at", "desc").execute();
  return rows.map((r) => ({ key: r.key, updatedBy: r.updated_by, updatedAt: r.updated_at }));
}

export class SwitchRefused extends Error {}

/**
 * Turn a switch on or off. Refuses a key that names (or is scoped to) a
 * required template — the same rule `isSwitchedOff` enforces on the read
 * side, checked here too so the API route cannot be fooled by a client that
 * skips the confirmation.
 */
export async function setSwitch(key: SwitchKey, off: boolean, updatedBy: string): Promise<void> {
  const templatePart = (key.includes("/") ? key.split("/")[1] : key) as TemplateId;
  if (templatePart in TEMPLATES && isRequired(templatePart)) {
    throw new SwitchRefused(`${templatePart} is a required message and cannot be switched off.`);
  }
  const { db } = await getDatabase();
  // Delete then (maybe) insert rather than an upsert: simpler than reasoning
  // about `onConflict` across the SQLite/Postgres split for a table this
  // rarely written to, and either order leaves the same row behind.
  await db.deleteFrom("message_switches").where("key", "=", key).execute();
  if (off) {
    await db.insertInto("message_switches").values({ key, updated_by: updatedBy, updated_at: nowIso() }).execute();
  }
}
