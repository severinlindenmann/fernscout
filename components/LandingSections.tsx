"use client";

import Link from "next/link";
import { posterSrc } from "./mediaLoader";
import AccountChip from "@/components/AccountChip";
import CopyLine from "@/components/CopyLine";
import { flagFor } from "@/lib/flags";
import { useI18n } from "@/components/LocaleProvider";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import ThemeSwitcher from "@/components/ThemeSwitcher";

import { journalPath } from "@/lib/journalPath";
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

/**
 * The mono voice, shared — B733. Uppercase, letter-spaced `IBM Plex Mono`
 * (`--font-mono`, `app/globals.css`) for the machine-ish things: kickers,
 * labels, pills, ids and counts. One place rather than the class typed out
 * per section, which is how it drifted before — `SiteHeader`'s own kicker
 * carried the string by hand.
 */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-secondary">
      {children}
    </p>
  );
}

/**
 * The primary action, shared — B733. `yellow-400` with a `yellow-600` edge
 * and `yellow-950` text: the waymark colour doing the job the waymark does.
 * Text on `yellow-400` is `navy-900` or `yellow-950` and nothing else —
 * `yellow-950` here clears AAA. Callers add their own width/margin.
 */
export const PRIMARY_BUTTON =
  "inline-flex min-h-14 items-center justify-center rounded-xl border border-yellow-600 bg-yellow-400 px-6 " +
  "text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

// B2338 retired the WhatsApp door this file used to draw here (B1314), and
// `OrDivider` along with it — the button, its `wa.me` lookup and its
// `agent.open.whatsappGreeting` / `landing.whatsappCta` copy are gone too.
// See `LandingHero`'s own note.

/**
 * A section title sitting on a rule — B733's "visible structure". Used
 * where a section previously carried its own `border-t` above it; this puts
 * the line directly under the heading instead, which is what makes the page
 * read as an instrument rather than a document.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-line-quiet pb-3 font-display text-xl font-semibold text-ink-strong">
      {children}
    </h2>
  );
}

/** The GitHub mark. Inline because lucide-react carries no brand icons. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
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
export function SiteHeader({
  siteName,
  locales,
  admin,
  helperEnabled = false,
  onSignIn,
  account,
  orgsLinks,
}: {
  siteName: string;
  locales?: string[];
  /** "Schools · Operators", rendered by the page from `paid/orgs` and handed
   * over like `Landing`'s `pricing` — B2450. Absent in a public build. */
  orgsLinks?: React.ReactNode;
  /**
   * The signed-in address, once `/api/v2/me/home` has said there is one —
   * the chip to `/me`. Undefined on the server pass and for a stranger, for
   * the same cacheability reason as `admin` below.
   */
  account?: string;
  /**
   * Whether this reader runs the instance — B746, placed here by B758.
   *
   * A corner word rather than a section, which is the shape this page already
   * settled on for a link only some readers want: B426's note below records
   * the reader's way in being put "next to the language switcher, in the same
   * weight as the language switcher", and this is the same kind of door for a
   * much smaller population.
   *
   * `undefined` on the server pass and for everybody who is not the operator.
   * It arrives from `/api/v2/me/home` rather than the page, because `/` is the
   * same cacheable document for everybody (B412) — and it grants nothing:
   * `/admin` asks `isInstanceAdmin()` for itself on every request.
   */
  admin?: boolean;
  /**
   * Whether the write door can actually be offered here — B825, revised by
   * B1905. Unlike `admin`, this one is for everybody: the hero's own button
   * (`LandingHero`) is already gated on the same flag, so a reader who
   * scrolls past it or who arrives on a page where the hero is not the first
   * thing shown still finds the same door up here.
   *
   * `Landing.tsx` also folds "signed in already" into this flag: once a
   * reader has a session, this chip has nowhere useful of its own to send
   * them (their own journals are the page below it, and `onSignIn` would be
   * a sign-in form shown to somebody already signed in), so the caller stops
   * passing `true` rather than this component guessing a destination.
   */
  helperEnabled?: boolean;
  /**
   * Opens the page's own inline sign-in — B1905. This chip used to be a
   * `Link` to `/agent`, which was "write door" and "sign-in door" at once;
   * splitting the studio out from `/agent` split that too. `/agent` still
   * exists but is on a retirement path (`docs/plans/2026-09-17-the-studio.md`)
   * and this page must not be one more way in. `onSignIn` is only ever
   * called while `helperEnabled` is true, which the caller only passes for a
   * reader with no session yet.
   */
  onSignIn?: () => void;
}) {
  const { t } = useI18n();
  return (
    // Wraps rather than squeezes: operator word, account chip, theme and
    // language do not all fit beside the site name at 360px, and a chip
    // pushed off the edge is a door nobody finds.
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="pt-3">
        <Kicker>{siteName}</Kicker>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        {orgsLinks}
        {admin && (
          // Drawn as LocaleSwitcher's `subtle` chip is, down to the hit area:
          // two controls side by side in the same corner have to read as one
          // pair, and min-h-11 is the tap target the switcher already keeps.
          <Link
            href="/admin"
            className="flex min-h-11 items-center rounded-full border border-transparent bg-transparent px-2.5 text-xs font-bold text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink-strong"
          >
            {t("home.operator")}
          </Link>
        )}
        {helperEnabled && (
          // Filled, unlike the operator chip beside it — B836. It was drawn
          // quiet to stay out of the hero's way and read as a label rather
          // than a control. Navy rather than the hero's yellow: the hero's
          // "start writing" leads to the same place, and two yellow buttons
          // for one destination on one screen is a repetition, not emphasis.
          // Navy is also what the agent control wears inside a journal, so
          // the thing has one look wherever it appears.
          //
          // A `button`, not a `Link` — B1905. It opens the same inline
          // sign-in `ReaderInvite` already uses below, rather than a route:
          // a stranger clicking this has no journal and no session, so there
          // is nothing at the far end of a link yet.
          <button
            type="button"
            onClick={onSignIn}
            className="flex min-h-11 items-center rounded-full bg-action-strong px-3.5 text-xs font-bold text-on-action transition-colors hover:bg-action-strong-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t("home.agentLink")}
          </button>
        )}
        <ThemeSwitcher subtle />
        <LocaleSwitcher locales={locales} subtle />
        {account && <AccountChip email={account} />}
      </div>
    </div>
  );
}

/**
 * What you actually hand over.
 *
 * Used to be set like an address on an airmail envelope — a 5px striped
 * border in coral and sky, the one piece of postal vernacular everybody
 * recognises on sight. B751 dropped it: the owner called it "flashing", and
 * once the helper (B694/B732) made this page's first screen about signing in
 * rather than about handing a string to an agent, the stripes were the
 * loudest thing beside panels that are all deliberately quieter — including
 * `AgentHandover`, the signed-in sibling of this block. This is now built to
 * match it: `cream-50`, a `navy-200` hairline, `rounded-2xl`, a real
 * `font-display` heading rather than an all-caps mono kicker (the mono voice
 * stays on the instruction itself, where it means "this is machine text").
 * `docs/branding/BRAND.md` keeps the airmail direction on record even though
 * it is no longer drawn here.
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
      className="mt-8 rounded-2xl border border-line-quiet bg-surface-base px-5 py-5 sm:px-6"
    >
      <h2
        id="handover"
        className="font-display text-xl font-semibold text-ink-strong"
      >
        {heading ?? t("landing.handTitle")}
      </h2>
      <p className="mt-1 text-base leading-7 text-ink-body">
        {t("landing.handBody")}
      </p>
      {/* The instruction itself, visible — the same string, from the same
          key, that the button below copies. B255: a postal-style address
          and a sentence fragment used to sit here, showing a different
          thing than the clipboard carried. Set quietly, inset, rather than
          as the centrepiece — the heading and the button are what a reader's
          eye should land on first.

          `overflow-wrap: anywhere` rather than Tailwind's `break-words`
          (`break-word`) — B431. The two wrap a rendered line identically;
          they differ in the one place that mattered here, which is that
          `anywhere` also lets the **min-content** width of this paragraph
          fall below the length of the URL. `break-word` does not, so the
          block reported a min-content width of the whole URL, the flex item
          above refused to shrink under it, and the entire page laid out
          wider than the phone. */}
      <p className="mt-3 rounded-xl bg-surface-subtle p-3 font-mono text-sm leading-6 text-ink-strong [overflow-wrap:anywhere]">
        {t("landing.instruction", { docUrl, agentUrl })}
      </p>
      <div className="mt-4">
        {/* With visible and copied text identical, `name` is no longer
            covering a mismatch — it stays anyway, because an accessible
            name that recites a whole sentence is worse than one that says
            what the button does (B199). B254. The yellow pill matches the
            page's other primary actions — B751: this is the block's only
            action, so it earns the weight. */}
        <CopyLine
          value={t("landing.instruction", { docUrl, agentUrl })}
          label={t("landing.copyInstruction")}
          copiedLabel={t("landing.copied")}
          name={t("landing.copyInstruction")}
          variant="primary"
        />
      </div>
    </section>
  );
}

/**
 * The three steps for bring-your-own-agent, and the promise that there is no
 * CMS.
 *
 * `helperEnabled` picks which close the last line gets — "whether it's this
 * instance's or your own" is only true where `/agent` can actually write
 * (B726). Off, the sentence stops one clause earlier rather than claiming an
 * agent this instance does not host.
 */
export function LandingSteps({
  helperEnabled = false,
}: {
  helperEnabled?: boolean;
}) {
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
            <span
              aria-hidden="true"
              className="font-mono text-sm leading-6 text-coral-600"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="text-base font-semibold leading-6 text-ink-strong">
                {step.title}
              </h3>
              <p className="text-base leading-6 text-ink-body">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-6 border-l-2 border-yellow-400 pl-4 text-base leading-6 text-ink-strong">
        {t(helperEnabled ? "landing.noEditor" : "landing.noEditorNoHelper")}
      </p>
    </>
  );
}

/** The reason to stay on the page: somebody else's trip, one click away. */
export function PublicJournals({ journals }: { journals: PublicJournal[] }) {
  const { t, tn } = useI18n();
  return (
    // `id` is a target: /tour-operators links "Read a real trip" here (B2450).
    <section id="journals" className="mt-12 scroll-mt-4">
      <SectionHeading>{t("landing.publicTitle")}</SectionHeading>

      {journals.length === 0 ? (
        <p className="mt-3 text-base leading-6 text-ink-body">
          {t("landing.publicNone")}
        </p>
      ) : (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {journals.map((journal) => (
            <li key={journal.username}>
              <Link
                href={journalPath(journal.username)}
                className="group block h-full overflow-hidden rounded-xl border border-line-quiet bg-surface-base
                           transition-colors hover:border-line-ink
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                {journal.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    // The sized variant, not the stored photograph — B2480:
                    // a 112px-tall card was downloading a 172 KB original.
                    // 480 (one of WARM_WIDTHS, so already made) is ~22 KB and
                    // still denser than a phone-wide card at 1x.
                    src={posterSrc(journal.cover, 480)}
                    alt=""
                    loading="lazy"
                    className="h-28 w-full object-cover"
                  />
                ) : null}
                {/* No band when there is no cover — B1291. 112px of flat
                    `cream-100` said nothing and read as a photograph that had
                    failed to load; a coverless journal is title-and-line, and
                    nothing here has to earn a phone screen's worth of colour
                    it cannot fill. */}
                <div className="p-4">
                  <p className="font-display text-base font-semibold text-ink-strong">
                    {journal.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-ink-secondary">
                    {journal.tagline}
                  </p>
                  <p className="mt-2 font-mono text-xs text-ink-secondary">
                    {journalPath(journal.username)} ·{" "}
                    {tn("landing.trips", journal.trips, {
                      count: String(journal.trips),
                    })}
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
  legal,
}: {
  repository?: string;
  credit?: { name: string; url?: string; countryCode?: string };
  /** Whether this instance has written a `site/legal/` page. Absent
   * instances draw no link rather than one that 404s — the same bargain every
   * optional capability makes. */
  legal?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      {/*
        Who made it, if this instance says so.

        Read from `site.credit` rather than written here: the content folder's
        whole promise is that somebody deletes it, drops in their own and has
        their own site, and a name compiled into a component would greet every
        one of their visitors with mine. Absent by default, and absent stays
        absent — there is no fallback that quietly credits the wrong person.
      */}
      {(credit || legal || repository) && (
        <footer className="mt-12 border-t border-line-quiet pt-6 text-sm text-ink-secondary">
          {credit && (
            <p>
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
                    className="font-semibold text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-4"
                  >
                    {credit.name}
                  </a>
                ) : (
                  <span className="font-semibold text-ink-strong">
                    {credit.name}
                  </span>
                );
                return (
                  <>
                    {before}
                    {name}
                    {after}
                  </>
                );
              })()}
            </p>
          )}
          {/*
            What this instance can honestly say about itself, in the place a
            reader goes looking for it — B487 put it in a card above the
            colophon, which gave a privacy claim more of the page than the
            journals underneath it. A footer line is the honest weight: it is
            reassurance for somebody who thought to ask, not a selling point.
          */}
          {/* B2520: the source link is a footer word beside Legal, not a
              "Self-host" section of its own — the reading/self-host block it
              used to sit in was clutter above the one line a reader looks for. */}
          <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs leading-5 text-ink-secondary">
            {t("landing.noTracking")}
            {legal && (
              <>
                {" · "}
                <Link
                  href="/legal"
                  className="underline decoration-blue-500 decoration-2 underline-offset-4
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  {t("landing.legal")}
                </Link>
              </>
            )}
            {repository && (
              <>
                {" · "}
                <a
                  href={repository}
                  className="inline-flex items-center gap-1 underline decoration-blue-500 decoration-2 underline-offset-4
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  <GithubMark className="h-3.5 w-3.5" />
                  GitHub
                </a>
              </>
            )}
          </p>
        </footer>
      )}
    </>
  );
}
