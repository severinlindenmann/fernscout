"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./LocaleProvider";
import { NEVER_KEY } from "./PushPrompt";

/**
 * "Don't ask me again" — B2464.
 *
 * Used to be a one-way button on `PushPrompt` itself: pressing it wrote
 * `NEVER_KEY` and there was no way back from this page short of clearing
 * browser storage by hand. Now that the card it used to sit on renders only
 * once, at the end of a trip's newest day, that irreversible escape hatch
 * would be easy to press by accident and hard to find again on purpose. A
 * settings page is where a permanent, *reversible* choice belongs, so this is
 * an ordinary switch beside `PushOptIn`'s own — same journal-wide notification
 * section on `/<user>/me`, one door down.
 *
 * Global and instance-wide, same as before: it is read by every journal's
 * `PushPrompt`, not just this one.
 */
export default function NeverAskNextDay() {
  const { t } = useI18n();
  // False on the server and on first paint, same value either way — the
  // read that could disagree with it happens only after mount.
  const [never, setNever] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNever(Boolean(window.localStorage.getItem(NEVER_KEY)));
  }, []);

  const toggle = () => {
    const next = !never;
    if (next) window.localStorage.setItem(NEVER_KEY, "1");
    else window.localStorage.removeItem(NEVER_KEY);
    setNever(next);
  };

  return (
    <label className="mt-3 flex items-center gap-2 text-xs text-ink-secondary">
      <input
        type="checkbox"
        checked={never}
        onChange={toggle}
        className="h-4 w-4 rounded border-line-quiet text-action-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      />
      {t("push.prompt.never")}
    </label>
  );
}
