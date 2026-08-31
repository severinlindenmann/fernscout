"use client";

import NoticeShell from "./NoticeShell";
import { useI18n } from "./LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

/**
 * `NoticeShell`, translated into the reader's own language.
 *
 * The split exists because the contact pages need the same shell in a language
 * that comes from a database row rather than from the browser — see the
 * comment on `NoticeShell`.
 */
export default function ReaderNotice({
  titleKey,
  bodyKey,
  vars,
  actions = [],
  children,
}: {
  titleKey: TranslationKey;
  bodyKey?: TranslationKey;
  vars?: Record<string, string>;
  actions?: { href: string; labelKey: TranslationKey; vars?: Record<string, string> }[];
  children?: React.ReactNode;
}) {
  const { t } = useI18n();

  return (
    <NoticeShell
      title={t(titleKey, vars)}
      body={bodyKey ? t(bodyKey, vars) : undefined}
      actions={actions.map((a) => ({ href: a.href, label: t(a.labelKey, a.vars) }))}
    >
      {children}
    </NoticeShell>
  );
}
