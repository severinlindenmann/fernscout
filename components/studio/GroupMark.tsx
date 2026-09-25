"use client";

import { useI18n } from "@/components/LocaleProvider";
import { GROUP_HUE, type StudioGroup } from "@/lib/studio/groups";

/**
 * Which hub group a studio page belongs to — B2060. The hue is only the
 * square's fill; the group's name beside it is the words, in ink, so the
 * colour is never the only carrier.
 */
export default function GroupMark({ group, size = "sm" }: { group: StudioGroup; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const { hue, icon: Icon, labelKey } = GROUP_HUE[group];
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`grid flex-none place-items-center border border-line-faint text-ink-strong ${
          size === "md" ? "size-10 rounded-[11px]" : "size-8 rounded-[9px]"
        }`}
        style={{ background: `color-mix(in srgb, ${hue} 22%, var(--surface-raised))` }}
      >
        <Icon size={size === "md" ? 20 : 18} />
      </span>
      <span className="font-mono text-[11px] font-medium uppercase tracking-[.06em] text-ink-secondary">
        {t(labelKey)}
      </span>
    </div>
  );
}
