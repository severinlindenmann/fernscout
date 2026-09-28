"use client";

import { useMemo } from "react";
import LocaleProvider, { useAncestorDictionary } from "./LocaleProvider";

/**
 * `JournalLocaleProvider`'s client half — B2551.
 *
 * The server only sends `delta`: the keys the nested scope adds beyond its
 * parent's (see `dictionaryDeltaFor` in lib/locales.ts). This merges that
 * onto the nearest ancestor `LocaleProvider`'s own dictionary, read from
 * context rather than resent, so `useI18n()` inside the nested scope still
 * resolves every key either provider's files can ask for.
 *
 * Only correct when this provider renders the same locale as its ancestor —
 * true for every caller today, since `JournalLocaleProvider` computes its
 * locale the same way its parent did. A future caller rendering a different
 * locale (a day previewed in its own written language, say) must send the
 * whole scope as `delta` instead of relying on this merge.
 */
export default function NestedLocaleProvider({
  locale,
  writtenLocale,
  delta,
  children,
}: {
  locale: string;
  writtenLocale: string;
  delta: Record<string, string>;
  children: React.ReactNode;
}) {
  const parentDictionary = useAncestorDictionary();
  const dictionary = useMemo(() => ({ ...parentDictionary, ...delta }), [parentDictionary, delta]);

  return (
    <LocaleProvider locale={locale} dictionary={dictionary} writtenLocale={writtenLocale}>
      {children}
    </LocaleProvider>
  );
}
