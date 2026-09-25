import { ContactRound, Library, Milestone, NotebookPen, PackageOpen, Printer, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The studio's six groups — B2060. One place for each group's hue, icon and
 * label, so the hub and every subpage's `GroupMark` agree.
 *
 * A hue is a palette colour (test/studio-groups.test.ts reads app/globals.css)
 * and is only ever a fill beside the group's name, never text: yellow-600 and
 * sky-500 fail contrast as text on cream.
 */
export const STUDIO_GROUPS = ["write", "plan", "people", "bringIn", "print", "journal"] as const;
export type StudioGroup = (typeof STUDIO_GROUPS)[number];

export const GROUP_HUE: Record<StudioGroup, { hue: string; labelKey: TranslationKey; icon: LucideIcon }> = {
  write: { hue: "#d69b0a", labelKey: "studio.hub.group.write", icon: NotebookPen }, // yellow-600
  plan: { hue: "#3fa9c4", labelKey: "studio.hub.group.plan", icon: Milestone }, // sky-500
  people: { hue: "#22c55e", labelKey: "studio.hub.group.people", icon: ContactRound }, // green-500
  bringIn: { hue: "#5a6a80", labelKey: "studio.hub.group.bringIn", icon: PackageOpen }, // navy-500
  print: { hue: "#713f12", labelKey: "studio.hub.group.print", icon: Printer }, // yellow-900
  journal: { hue: "#aeb7c5", labelKey: "studio.hub.group.journal", icon: Library }, // navy-300
};
