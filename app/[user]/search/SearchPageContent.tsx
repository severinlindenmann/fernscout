"use client";

import PageHeader from "@/components/PageHeader";
import SearchBox from "@/components/SearchBox";
import { useI18n } from "@/components/LocaleProvider";

export default function SearchPageContent({
  username,
  speech,
}: {
  username: string;
  /** Present only for the owner of a journal that can transcribe — B981. */
  speech?: { consented: boolean; provider: string; balance: number | null };
}) {
  const { t } = useI18n();
  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("search.title")}
        </h1>
        <p className="mt-1 text-sm text-navy-600">{t("search.subtitle")}</p>
        <div className="mt-6">
          <SearchBox username={username} speech={speech} />
        </div>
      </main>
    </div>
  );
}
