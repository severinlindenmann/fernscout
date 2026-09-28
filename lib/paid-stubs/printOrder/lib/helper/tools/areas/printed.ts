// Public stub: the helper's postcard/photobook tools are not included in
// this build.
import type { Tool } from "@/lib/helper/tools/types";

export const PRINTED_TOOLS: readonly Tool[] = [];

/**
 * B2554 — the argument names the paid postcard/photobook write tools take.
 * Each is labelled `agent.slot.<name>` in every locale, and a checkout
 * without paid/ cannot see those tools, so this is the public declaration of
 * the slot strings paid reads: test/helper-slot-locales.test.ts holds every
 * locale to it, and the orphan sweep counts them as used. The real module
 * derives the same list from its tools, and a paid test holds the two equal.
 */
export const PRINTED_SLOT_NAMES: readonly string[] = ["trip", "slug", "date", "photo", "message", "from", "recipients", "locale", "size", "cover"];
