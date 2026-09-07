"use client";

import { useI18n } from "@/components/LocaleProvider";

/**
 * One line, then "why?" — B781.
 *
 * The consent panels were right and unread: 116 words of policy prose on a
 * phone, at the moment somebody wants to press a button. A 19-year-old tester
 * pressed "yes" after five words; a 71-year-old read the same paragraph three
 * times and telephoned her son. Both are the same failure.
 *
 * So the promise is kept in two parts, never one: the sentence at the point of
 * decision, and **everything the long version said** in here, one tap away —
 * including the provider's name, which is the part it is most tempting to drop
 * and the part an unfamiliar reader most needs. An unnamed company is not
 * reassuring, it is a phishing warning; the answer to that is order, not
 * deletion.
 *
 * `<details>` rather than a state and a button: it opens with no JavaScript, it
 * is in the accessibility tree as a disclosure, and it is findable by the
 * browser's own in-page search even while closed in most engines. `list-none`
 * takes the marker off; the summary is padded to 44px because it is a tap
 * target like any other.
 */
export default function Why({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <details className="mt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold text-navy-700 underline underline-offset-4">
        {t("agent.why")}
      </summary>
      <div className="text-sm leading-6 text-navy-700">{children}</div>
    </details>
  );
}
