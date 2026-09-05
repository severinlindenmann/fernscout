"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import CopyLine from "@/components/CopyLine";
import { flagFor } from "@/lib/flags";
import { useI18n } from "@/components/LocaleProvider";
import LocaleSwitcher from "@/components/LocaleSwitcher";

/**
 * The root page's parts, as separate pieces — B411.
 *
 * They were one component in one order, because there was one page. There are
 * now two: a stranger gets the pitch, and somebody signed in gets their own
 * journals first with the pitch below. The sections themselves are identical
 * in both, so they live here and each order composes them — rather than the
 * markup existing twice and drifting apart the first time one is edited.
 */

export type PublicJournal = {
  username: string;
  title: string;
  tagline: string;
  trips: number;
  cover?: string;
};

/** The GitHub mark. Inline because lucide-react carries no brand icons. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * The name on the left, the language on the right.
 *
 * The switcher is the first thing on the page for a reason: somebody who
 * cannot read the hero has no way to guess that the rest of the site is
 * translated.
 */
export function SiteHeader({ siteName, locales }: { siteName: string; locales?: string[] }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="pt-3 font-mono text-xs uppercase tracking-[0.2em] text-navy-600">{siteName}</p>
      <LocaleSwitcher locales={locales} subtle />
    </div>
  );
}

/**
 * The other reader — B427.
 *
 * This page was written for one person: whoever is deciding whether to run
 * Fernscout. But two people arrive at the bare domain, and the second is the
 * one this project is actually *for* — somebody whose daughter shared a
 * journal, who has lost the email, and who typed the address into a browser
 * because that is what you do when a link is gone. Until B426 there was
 * nothing here for them at all; after it there was a small word in the corner,
 * next to the language switcher, in the same weight as the language switcher.
 *
 * So the page forks at the top and lets each of them self-select. This is
 * first because for the reader it is the whole page, and a person who has to
 * hunt for the way in has already been told this software is not for them.
 *
 * **Deliberately not another airmail border.** That frame is the agent block's
 * signature and it is the one thing this page is remembered by; a second one
 * would make it wallpaper. What this gets instead is the waymark's yellow down
 * its edge — a Swiss trail marker means *you are on the right path, keep
 * going*, which is exactly what is being said. `navy-900` on `cream-100`
 * throughout: `yellow-600` is 2.36:1 on cream and is not a text colour.
 */
export function ReaderInvite({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useI18n();
  return (
    <section
      aria-labelledby="reader-invite"
      className="mt-6 overflow-hidden rounded-2xl border border-navy-200 border-l-8 border-l-yellow-400 bg-cream-100 p-5 sm:p-6"
    >
      <h2
        id="reader-invite"
        className="font-display text-xl font-semibold leading-tight text-navy-900 sm:text-2xl"
      >
        {t("home.inviteTitle")}
      </h2>
      <p className="mt-2 max-w-prose text-base leading-7 text-navy-800 sm:text-lg">
        {t("home.inviteBody")}
      </p>
      {/* Full width on a phone and min-h-14 rather than the 11 used elsewhere:
          this one control is the entire page for the person it is aimed at,
          and it is aimed at people who miss small targets. */}
      <button
        type="button"
        onClick={onSignIn}
        className="mt-4 inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-navy-900 px-6
                   text-lg font-semibold text-cream-50 transition-colors hover:bg-navy-700
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500
                   sm:w-auto"
      >
        {t("home.inviteAction")}
      </button>
    </section>
  );
}

export function LandingHero() {
  const { t } = useI18n();
  return (
    <>
      <h1 className="mt-4 font-display text-[clamp(1.75rem,6vw,2.75rem)] font-semibold leading-[1.12] text-navy-900">
        {t("landing.hero")}
      </h1>
      <p className="mt-4 text-lg leading-7 text-navy-700">{t("landing.lede")}</p>
    </>
  );
}

/**
 * What you actually hand over, set like an address on an airmail envelope.
 *
 * The signature: an airmail border, the one piece of postal vernacular
 * everybody recognises on sight, drawn in the site's own coral and sky rather
 * than the literal red and blue. Everything else stays quiet so this is what
 * is remembered.
 *
 * `heading` lets the signed-in page title this "your agent" rather than "hand
 * this to your agent" — the same block one step further along, for somebody
 * who already has a journal and is not being sold anything.
 */
export function AgentBlock({
  docUrl,
  agentUrl,
  heading,
}: {
  docUrl: string;
  agentUrl: string;
  heading?: string;
}) {
  const { t } = useI18n();
  return (
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
          {heading ?? t("landing.handTitle")}
        </h2>
        {/* The instruction itself, visible — the same string, from the same
            key, that the button below copies. B255: a postal-style address
            and a sentence fragment used to sit here, showing a different
            thing than the clipboard carried.

            `overflow-wrap: anywhere` rather than Tailwind's `break-words`
            (`break-word`) — B431. The two wrap a rendered line identically;
            they differ in the one place that mattered here, which is that
            `anywhere` also lets the **min-content** width of this paragraph
            fall below the length of the URL. `break-word` does not, so the
            block reported a min-content width of the whole URL, the flex item
            above refused to shrink under it, and the entire page laid out
            wider than the phone. */}
        <p className="mt-3 font-mono text-base leading-7 text-navy-900 [overflow-wrap:anywhere] sm:text-lg">
          {t("landing.instruction", { docUrl, agentUrl })}
        </p>
        <div className="mt-4">
          {/* With visible and copied text identical, `name` is no longer
              covering a mismatch — it stays anyway, because an accessible
              name that recites a whole sentence is worse than one that says
              what the button does (B199). B254. */}
          <CopyLine
            value={t("landing.instruction", { docUrl, agentUrl })}
            label={t("landing.copyInstruction")}
            copiedLabel={t("landing.copied")}
            name={t("landing.copyInstruction")}
          />
        </div>
      </div>
    </section>
  );
}

/** The three steps, and the promise that there is no editor. */
export function LandingSteps() {
  const { t } = useI18n();
  const steps = [
    { title: t("landing.step1"), body: t("landing.step1Body") },
    { title: t("landing.step2"), body: t("landing.step2Body") },
    { title: t("landing.step3"), body: t("landing.step3Body") },
  ];
  return (
    <>
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
    </>
  );
}

/**
 * Right after the instruction, not tucked into the self-host column below: the
 * guide is for anyone deciding whether to use this, not only for somebody
 * about to run their own instance.
 */
export function DocsLink() {
  const { t } = useI18n();
  return (
    <Link
      href="/docs"
      className="mt-6 inline-flex min-h-11 items-center gap-2 text-base font-semibold text-navy-900
                 underline decoration-blue-500 decoration-2 underline-offset-4
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      <BookOpen className="h-4 w-4" aria-hidden />
      {t("landing.docs")}
    </Link>
  );
}

/** The reason to stay on the page: somebody else's trip, one click away. */
export function PublicJournals({ journals }: { journals: PublicJournal[] }) {
  const { t, tn } = useI18n();
  return (
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
                    /{journal.username} ·{" "}
                    {tn("landing.trips", journal.trips, { count: String(journal.trips) })}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Colophon({
  repository,
  credit,
}: {
  repository?: string;
  credit?: { name: string; url?: string; countryCode?: string };
}) {
  const { t } = useI18n();
  return (
    <>
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
          <div className="mt-3 flex flex-col gap-2">
            {repository && (
              <a
                href={repository}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-navy-900
                           underline decoration-blue-500 decoration-2 underline-offset-4
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                <GithubMark className="h-4 w-4" />
                {t("landing.source")}
              </a>
            )}
            <Link
              href="/docs/api"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-navy-900
                         underline decoration-blue-500 decoration-2 underline-offset-4
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <BookOpen className="h-4 w-4" />
              {t("landing.apiDocs")}
            </Link>
          </div>
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
    </>
  );
}
