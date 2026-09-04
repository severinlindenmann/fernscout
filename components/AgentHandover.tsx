"use client";

import CopyLine from "./CopyLine";
import { useI18n } from "./LocaleProvider";

/**
 * The two lines an owner hands to an agent.
 *
 * There is no form on this site and there never will be (ROADMAP decision 24),
 * so the address of the guide plus the address the code is sent to *is* the
 * interface for writing. It lived in one place — the owner panel on
 * `/<user>/me` — which is a page a new owner has no reason to have visited;
 * B76 needed the same block on the empty trip list. Extracted rather than
 * copied, because two copies of an instruction is one instruction and one
 * stale instruction.
 *
 * Draws no outer margin: the caller decides where it sits.
 */
export default function AgentHandover({
  docUrl,
  /** The owner's own address — never rendered for anybody else. */
  email,
}: {
  docUrl: string;
  email: string | null;
}) {
  const { t } = useI18n();

  return (
    <div>
      <h3 className="font-display text-base font-semibold text-navy-900">{t("me.agentTitle")}</h3>
      <p className="mt-1 text-base leading-7 text-navy-700">{t("me.agentBody")}</p>
      <p className="mt-3 font-mono text-sm text-navy-900">{docUrl}</p>
      <p className="font-mono text-sm text-navy-600">{email}</p>
      <div className="mt-3">
        {/* One control, two values, and therefore an accessible name that
            says what it copies rather than reciting it. Reciting put the
            guide's address and the owner's own address into one run of text
            separated by a newline, which readers announce inconsistently or
            not at all — one string where there were two, under a name that
            said "Copy link". B199. Both lines are above as page text. */}
        <CopyLine
          value={[docUrl, email].filter(Boolean).join("\n")}
          label={t("landing.copy")}
          copiedLabel={t("landing.copied")}
          name={t("me.agentCopy")}
        />
      </div>
    </div>
  );
}
