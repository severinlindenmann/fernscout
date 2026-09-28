"use client";

import Link from "next/link";
import { posterSrc } from "./mediaLoader";
import CopyLine from "@/components/CopyLine";
import { useI18n } from "@/components/LocaleProvider";

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
