"use client";

import { useI18n } from "@/components/LocaleProvider";

/** B-3001: the "Email | Mobile" switch at the top of a sign-in form. Rendered
 * only where the instance texts codes. Arrow keys move between the tabs. */
export default function SignInTabs({
  value,
  onChange,
}: {
  value: "email" | "phone";
  onChange: (next: "email" | "phone") => void;
}) {
  const { t } = useI18n();
  const tabs = [
    { id: "email", label: t("signIn.tabEmail") },
    { id: "phone", label: t("signIn.tabMobile") },
  ] as const;
  return (
    <div
      role="tablist"
      className="mt-4 flex gap-1 rounded-xl bg-surface-subtle p-1"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = value === "email" ? "phone" : "email";
        onChange(next);
        e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-tab={tab.id}
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          className={`min-h-11 flex-1 rounded-lg px-3 text-base font-medium ${
            value === tab.id ? "bg-surface-raised text-ink-strong shadow-sm" : "text-ink-secondary"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
