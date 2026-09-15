import "server-only";
import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner } from "@/lib/helper/server";

/**
 * The gate every page under `/<user>/extract` shares — B1797.
 *
 * Capability first, owner second, both `notFound()`: an instance with the
 * capability off has no such page at all, rather than a page explaining a
 * button it will not show, and a stranger asking for somebody else's
 * `/extract` learns nothing about whether the capability is even on here.
 * Pulled out once the hub split the single page into five (the hub, the
 * photo flow, and three plain-upload pages) — four copies of the same three
 * lines is the kind of duplication that drifts.
 */
export async function requireExtractOwner(user: string): Promise<void> {
  if (!isEnabled("extract", user)) notFound();
  if (!(await isHelperOwner(user))) notFound();
}
