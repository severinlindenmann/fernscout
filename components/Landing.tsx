"use client";

import Link from "next/link";
import CopyLine from "@/components/CopyLine";
import { flagFor } from "@/lib/flags";
import { useI18n } from "@/components/LocaleProvider";
import LocaleSwitcher from "@/components/LocaleSwitcher";

/**
 * The landing page, at the root.
 *
 * Written for the person who is *not* the audience of the rest of the site.
 * Readers arrive at `/alex/day/hoi-an` from a link in an email and never see
 * this; whoever lands on the bare domain is deciding whether to use the thing.
 * So it opens with what you actually hand over — the documentation URL, set
 * like an address on an airmail envelope — rather than a sales line.
 *
 * Client-side because the copy control needs it, and because the strings come
 * from the provider, which is how it follows the reader's language.
 */

/** The GitHub mark. Inline because lucide-react carries no brand icons. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export type PublicJournal = {
  username: string;
  title: string;
  tagline: string;
  trips: number;
  cover?: string;
};

export default function Landing({
  siteName,
  docUrl,
  journals,
  locales,
  repository,
  credit,
}: {
  siteName: string;
  docUrl: string;
  journals: PublicJournal[];
  /** The interface languages this instance offers. Outside a journal there is
   * nobody whose list to use, so it is the maintained set — see
   * `installedLocales()`. */
  locales?: string[];
  /** Where the source lives, if this instance says. */
  repository?: string;
  /** Who runs it, if this instance says. */
  credit?: { name: string; url?: string; countryCode?: string };
}) {
  const { t, tn } = useI18n();

  const steps = [
    { title: t("landing.step1"), body: t("landing.step1Body") },
    { title: t("landing.step2"), body: t("landing.step2Body") },
    { title: t("landing.step3"), body: t("landing.step3Body") },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      {/* The name on the left, the language on the right. The switcher is the
          first thing on the page for a reason: somebody who cannot read the
          hero has no way to guess that the rest of the site is translated. */}
      <div className="flex items-start justify-between gap-4">
        <p className="pt-3 font-mono text-xs uppercase tracking-[0.2em] text-navy-600">
          {siteName}
        </p>
        <LocaleSwitcher locales={locales} subtle />
      </div>

      <h1 className="mt-4 font-display text-[clamp(1.75rem,6vw,2.75rem)] font-semibold leading-[1.12] text-navy-900">
        {t("landing.hero")}
      </h1>
      <p className="mt-4 text-lg leading-7 text-navy-700">{t("landing.lede")}</p>

      {/*
        The signature: an airmail border, the one piece of postal vernacular
        everybody recognises on sight, drawn in the site's own coral and sky
        rather than the literal red and blue. Everything else stays quiet so
        this is what is remembered.
      */}
      <section
        aria-labelledby="handover"
        className="mt-8 rounded-2xl p-[5px]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #f06a8a 0 10px, transparent 10px 20px, #3fa9c4 20px 30px, transparent 30px 40px)",
        }}
      >
        <div className="rounded-xl bg-cream-50 px-5 py-5 sm:px-6">
          <h2
            id="handover"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-navy-600"
          >
            {t("landing.handTitle")}
          </h2>
          {/* Two lines, the way an address is: postal, and it stops a long
              host wrapping mid-word on a phone. */}
          <p className="mt-3 font-mono text-base leading-7 text-navy-900 sm:text-lg">
            <span className="block text-navy-600">{new URL(docUrl).host}</span>
            <span className="block">{new URL(docUrl).pathname}</span>
          </p>
          <p className="mt-1 font-mono text-sm text-navy-600">{t("landing.handEmail")}</p>
          <div className="mt-4">
            <CopyLine value={docUrl} label={t("landing.copy")} copiedLabel={t("landing.copied")} />
          </div>
        </div>
      </section>

      <ol className="mt-8 space-y-4">
        {steps.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[1.75rem_1fr] gap-x-3">
            {/* Numbered because it genuinely is a sequence — the code cannot
                be exchanged before it is requested. */}
            <span aria-hidden="true" className="font-mono text-sm leading-6 text-coral-600">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="text-base font-semibold leading-6 text-navy-900">{step.title}</h3>
              <p className="text-base leading-6 text-navy-700">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-6 border-l-2 border-yellow-400 pl-4 text-base leading-6 text-navy-900">
        {t("landing.noEditor")}
      </p>

      {/* The reason to stay on the page: somebody else's trip, one click away. */}
      <section className="mt-12 border-t border-navy-200 pt-8">
        <h2 className="font-display text-xl font-semibold text-navy-900">
          {t("landing.publicTitle")}
        </h2>

        {journals.length === 0 ? (
          <p className="mt-3 text-base leading-6 text-navy-700">{t("landing.publicNone")}</p>
        ) : (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {journals.map((journal) => (
              <li key={journal.username}>
                <Link
                  href={`/${journal.username}`}
                  className="group block h-full overflow-hidden rounded-xl border border-navy-200 bg-white
                             transition-colors hover:border-navy-700
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  {journal.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={journal.cover}
                      alt=""
                      loading="lazy"
                      className="h-28 w-full object-cover"
                    />
                  ) : (
                    <div className="h-28 w-full bg-cream-100" />
                  )}
                  <div className="p-4">
                    <p className="font-display text-base font-semibold text-navy-900">
                      {journal.title}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-navy-600">
                      {journal.tagline}
                    </p>
                    <p className="mt-2 font-mono text-xs text-navy-600">
                      /{journal.username} · {tn("landing.trips", journal.trips, { count: String(journal.trips) })}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 grid gap-6 border-t border-navy-200 pt-8 sm:grid-cols-2">
        <div>
          <h2 className="font-display text-base font-semibold text-navy-900">
            {t("landing.readers")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-navy-700">{t("landing.readersBody")}</p>
        </div>
        <div>
          <h2 className="font-display text-base font-semibold text-navy-900">
            {t("landing.selfHost")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-navy-700">{t("landing.selfHostBody")}</p>
          {repository && (
            <a
              href={repository}
              className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-navy-900
                         underline decoration-blue-500 decoration-2 underline-offset-4
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <GithubMark className="h-4 w-4" />
              {t("landing.source")}
            </a>
          )}
        </div>
      </section>

      {/*
        Who made it, if this instance says so.
        
        Read from `site.credit` rather than written here: the content folder's
        whole promise is that somebody deletes it, drops in their own and has
        their own site, and a name compiled into a component would greet every
        one of their visitors with mine. Absent by default, and absent stays
        absent — there is no fallback that quietly credits the wrong person.
      */}
      {credit && (
        <footer className="mt-12 border-t border-navy-200 pt-6 text-sm text-navy-600">
          {/* Split on the {name} token rather than appending the link after
              the sentence: German ends "von {name}" and Hungarian puts it
              after a dash, and a name glued to the end would be wrong in both
              the moment a translator moves it. */}
          {(() => {
            const flag = flagFor("", credit.countryCode);
            const [before, after = ""] = t("landing.madeBy", {
              flag: flag || "",
              name: "\u0000",
            }).split("\u0000");
            const name = credit.url ? (
              <a
                href={credit.url}
                className="font-semibold text-navy-900 underline decoration-blue-500 decoration-2 underline-offset-4"
              >
                {credit.name}
              </a>
            ) : (
              <span className="font-semibold text-navy-900">{credit.name}</span>
            );
            return (
              <>
                {before}
                {name}
                {after}
              </>
            );
          })()}
        </footer>
      )}
    </main>
  );
}
