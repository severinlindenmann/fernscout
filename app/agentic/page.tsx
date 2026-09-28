import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  FileJson,
  FolderTree,
  Mic,
  Printer,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import CopyLine from "@/components/CopyLine";
import { PRIMARY_BUTTON } from "@/components/LandingSections";
import { LandingFrame } from "@/components/landing/SignedOut";
import { orgsNav } from "@paid/orgs/lib/nav";
import { isEnabled } from "@/lib/capabilities";
import { landingFlags } from "@/lib/landingMarkdown";
import { hasLegal } from "@/lib/legal";
import { installedLocales, requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";

const HELPER_REPO = "https://github.com/severinlindenmann/fernscout-helper";

export function generateMetadata(): Metadata {
  return {
    title: "Agentic",
    description:
      "An open-source travel journal your agent can work with: import years of trips from " +
      "your photo library, write new days by voice or with Claude Code, and keep every word " +
      "your own. JSON and photographs in a folder you own, a documented API, self-hostable.",
    alternates: { canonical: "/agentic" },
  };
}

/**
 * The page for somebody who would rather type `claude` than click — the
 * self-hoster, the open-source person, the one who already has an agent open
 * in a terminal and wants to know what it can do here.
 *
 * English, deliberately, like `/docs/helper` and the other technical pages:
 * the reader is about to run `git clone`, and every document this page points
 * at (`/documentation.txt`, `/skill/*.md`, the helper's `SKILL.md`s, the
 * OpenAPI file) is English too. The landing page's teaser and the header link
 * that lead here are translated.
 *
 * **Nothing here is claimed that this instance cannot do.** Voice is drawn
 * only where `transcription` is on, the printed things only where `photobook`
 * or `postcards` are — the same rule `LandingPitch` follows — and the parts
 * that live in the separate, MIT-licensed Fernscout Helper say so, including
 * that its photo half wants a Mac.
 *
 * The header and footer are the homepage's own (`LandingFrame`, B2529) —
 * in the reader's language, like every page's chrome — so this page has the
 * same way home and the same doors as `/`.
 */
export default async function AgenticPage() {
  const site = serverSite();
  const locale = await requestLocale();
  const flags = landingFlags(locale);
  const base = site.url.replace(/\/$/, "");
  const docUrl = `${base}/documentation.txt`;
  const agentUrl = `${base}/skill/add-a-day.md`;
  const instruction =
    `Guide me through creating my own travel journal, following the overview at ${docUrl} ` +
    `and the day-writing guide at ${agentUrl}. You will need an email address I control.`;

  const voice = isEnabled("transcription");
  const { photobook, postcards } = flags;

  return (
    <LandingFrame
      siteName={site.name}
      locales={installedLocales()}
      inviteCta={flags.inviteCta}
      helperEnabled={flags.helperEnabled}
      prints={flags.postcards || flags.photobook}
      pricing={flags.credits}
      orgs={orgsNav(locale)}
      repository={site.repository}
      credit={site.credit}
      legal={hasLegal()}
    >
      <main lang="en" className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pb-24 sm:pt-10">
        {/* ——— Hero ——— */}
        <header>
          <Kicker>For self-hosters, tinkerers and people with a terminal open</Kicker>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-tight text-ink-strong sm:text-5xl">
            Your travel journal is a folder.
            <br />
            <span className="text-coral-600">Point an agent at it.</span>
          </h1>
          <p className="mt-5 text-lg leading-8 text-ink-body">
            {site.name} is an open-source travel journal: JSON documents and photographs in a
            folder you own, a website on top, and a documented API underneath. Bring Claude Code,
            or any agent that can read a Markdown guide and make an HTTP call, and let it do the
            plumbing — exports, sorting, resizing, uploading. <strong className="text-ink-strong">
            The words stay yours.</strong> A new day lands as a draft, and nothing is
            published until you say so.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="At a glance">
            {["Apache-2.0", "JSON + photos", "OpenAPI", "SQLite · Postgres"].map(
              (fact) => (
                <li key={fact}>
                  <Pill>{fact}</Pill>
                </li>
              ),
            )}
          </ul>
        </header>

        {/* ——— The instruction, in a terminal ——— */}
        <section aria-labelledby="try" className="mt-10">
          <h2 id="try" className="sr-only">
            Try it with your agent
          </h2>
          <TerminalCard title="any agent · paste this">
            <Line prompt=">">{instruction}</Line>
          </TerminalCard>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <CopyLine
              value={instruction}
              label="Copy the prompt"
              copiedLabel="Copied"
              name="Copy the prompt for your agent"
              variant="primary"
            />
            <a
              href={HELPER_REPO}
              className="inline-flex min-h-11 items-center gap-2 text-base font-semibold text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-4"
            >
              Fernscout Helper on GitHub
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </section>

        {/* ——— Three altitudes ——— */}
        <section aria-labelledby="altitudes" className="mt-16">
          <SectionHeading id="altitudes">Pick your altitude</SectionHeading>
          <ul className="mt-5 grid gap-4 sm:grid-cols-3">
            <Card
              icon={<FolderTree className="h-4 w-4 text-coral-600" aria-hidden />}
              title="Only a folder"
              body="Clone Fernscout Helper, open it with your agent, end up with trip.json and one JSON file per day on your own disk. No server, no account."
              code={`git clone ${HELPER_REPO}\ncd fernscout-helper && claude`}
            />
            <Card
              icon={<BookOpen className="h-4 w-4 text-coral-600" aria-hidden />}
              title={`Hosted on ${site.name}`}
              body="Hand your agent the prompt above. With an invitation, it walks you through signing up and gets a key that writes to your journal for seven days."
              code={"GET /api/v2/status\nGET /api/v2/{user}/status"}
            />
            <Card
              icon={<Server className="h-4 w-4 text-coral-600" aria-hidden />}
              title="Your own server"
              body="A VPS, Node and Caddy, one deploy script. SQLite on your laptop, Postgres in production. A public journal needs no database at all."
              code={`git clone ${site.repository ?? "…"}\ncd fernscout && npm ci\nnpm run build && npm start`}
            />
          </ul>
        </section>

        {/* ——— The backlog ——— */}
        <section aria-labelledby="backlog" className="mt-16">
          <SectionHeading id="backlog">Ten years of trips, out of your photo library</SectionHeading>
          <p className="mt-4 text-base leading-7 text-ink-body">
            Most people do not have a travel blog. They have a photo library full of trips and no
            clear idea when any of them were. Fernscout Helper is a set of agent skills that
            reads that library — <em>metadata only</em> at first — finds the weeks you were away,
            and turns the ones you pick into draft days you can review in a browser page.
          </p>
          <TerminalCard title="~/fernscout-helper · claude">
            <Line prompt=">">find the trips in my photos from the last ten years</Line>
            <Out>Reading the Photos library… (metadata only, nothing is downloaded)</Out>
            <Out>{"  2017-04-12 → 2017-04-19   8d   412p  1840 km  Lisbon · Sintra"}</Out>
            <Out>{"  2019-08-02 → 2019-08-16  15d  1233p   960 km  Split · Hvar · Kotor"}</Out>
            <Out>{"  2023-02-18 → 2023-02-25   8d   287p  9310 km  Tokyo · Kyoto"}</Out>
            <Out muted>These are candidates, not facts — check them against what you remember.</Out>
            <Line prompt=">">export the Croatia one, up to fifteen a day, favourites first</Line>
            <Out>1233 photographs · 6.1 GB · opening the review page…</Out>
          </TerminalCard>
          <p className="mt-2 font-mono text-[11px] text-ink-secondary">
            Example session. Your places come from your own photographs.
          </p>

          <ol className="mt-8 space-y-4">
            {[
              ["find-trips", "Finds the weeks you were away, from photo metadata. Asks where home is instead of guessing."],
              ["icloud-export", "Exports one trip and opens a review page: Keep, a note per photo, a box for what happened each day. Location and camera data are stripped from the photos that go into the journal."],
              ["statement-costs · trip-budget", "Reads a bank CSV, filters it to the trip, shows you the merchants first. Asks about the flights instead of estimating them."],
              ["gps-history", "Google Timeline, Takeout or a GPX from your watch → the route you actually travelled, simplified, on the trip map. The raw history never becomes public."],
              ["validate-content → publish · sync", "Checks for gaps, prints a dry run, then uploads. Sync goes both ways and, by default, stops when both sides changed the same day."],
            ].map(([skill, body], i) => (
              <li key={skill} className="grid grid-cols-[1.75rem_1fr] gap-x-3">
                <span aria-hidden className="font-mono text-sm leading-6 text-coral-600">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-mono text-sm font-semibold leading-6 text-ink-strong">{skill}</h3>
                  <p className="text-base leading-6 text-ink-body">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Note>
            Built and tested with Claude Code on a Mac — that is where the Photos library is. The
            cost, GPS and publishing skills run anywhere. On Linux or Windows, a self-hosted
            instance&apos;s <code className="font-mono text-sm">npm run ingest</code> turns a
            folder of camera files into dated draft days, geotagged where the photos carry a
            location, offline.
          </Note>
        </section>

        {/* ——— A new trip ——— */}
        <section aria-labelledby="new-trip" className="mt-16">
          <SectionHeading id="new-trip">A new trip, while you are still on it</SectionHeading>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            <Card
              icon={<Terminal className="h-4 w-4 text-coral-600" aria-hidden />}
              title="Your agent, over the API"
              body="A trip and a day are PUT at ids you choose. Every field is in the OpenAPI file; a section left empty is declined with a reason, never guessed."
              code={
                "PUT  /api/v2/{user}/trips/{trip}\n" +
                "PUT  /api/v2/{user}/trips/{trip}/days/{slug}\n" +
                "POST /api/v2/{user}/trips/{trip}/days/{slug}/media"
              }
            />
            {voice ? (
              <Card
                icon={<Mic className="h-4 w-4 text-coral-600" aria-hidden />}
                title="Or just say it"
                body="In the studio, a day can be spoken: five short questions, one per screen, answered out loud. You see the transcript and correct it; the day is only your own answers."
              />
            ) : (
              <Card
                icon={<Mic className="h-4 w-4 text-coral-600" aria-hidden />}
                title="Or write it in the studio"
                body="No agent needed: the studio composes a day on one page from your words, facts measured from your photographs and real lookups."
              />
            )}
          </ul>
        </section>

        {/* ——— What comes out ——— */}
        <section aria-labelledby="out" className="mt-16">
          <SectionHeading id="out">What comes out</SectionHeading>
          <div className="grid gap-4">
            <TerminalCard title="content/<you>/trips/<trip>/">
              <Out>{"trip.json            dates, people, budget, costs"}</Out>
              <Out>{"track.json           the clipped route for the map"}</Out>
              <Out>{"entries/"}</Out>
              <Out>{"  2019-08-03-hvar.json   one day, status: draft"}</Out>
              <Out>{"media/               resized, EXIF and GPS stripped"}</Out>
              <Out>{"originals/           the print masters"}</Out>
            </TerminalCard>
            <ul className="space-y-3 text-base leading-6 text-ink-body">
              <Bullet icon={<FileJson className="h-4 w-4" aria-hidden />}>
                A website: map, gallery and an RSS feed, public or only for the people you
                choose.
              </Bullet>
              <Bullet icon={<FolderTree className="h-4 w-4" aria-hidden />}>
                One command hands the whole thing back as a zip. No lock-in: the folder is the
                journal.
              </Bullet>
              {(photobook || postcards) && (
                <Bullet icon={<Printer className="h-4 w-4" aria-hidden />}>
                  {photobook && postcards
                    ? "A printed photobook and real postcards. "
                    : photobook
                      ? "A printed photobook. "
                      : "Real postcards. "}
                  An agent can arrange a draft; ordering and paying stay on your own page.
                </Bullet>
              )}
            </ul>
          </div>
        </section>

        {/* ——— The rule ——— */}
        <section
          aria-labelledby="rule"
          className="mt-16 rounded-2xl border border-line-quiet border-l-8 border-l-yellow-400 bg-surface-base p-5 sm:p-6"
        >
          <h2 id="rule" className="flex items-center gap-2 font-display text-xl font-semibold text-ink-strong">
            <ShieldCheck className="h-5 w-5 text-coral-600" aria-hidden />
            The one rule agents follow here
          </h2>
          <ul className="mt-3 space-y-2 text-base leading-7 text-ink-body">
            <li>
              <strong className="text-ink-strong">No invented memories.</strong> No weather, meals,
              feelings or people that you or a real source did not supply. An empty field beats
              plausible fiction.
            </li>
            <li>
              <strong className="text-ink-strong">Drafts first.</strong> A new day starts as a
              draft. Publishing is a separate call, made only when you say so in words.
            </li>
            <li>
              <strong className="text-ink-strong">Tokens stay in the API.</strong> An agent&apos;s
              key never opens your owner pages, and your raw GPS history is never exposed.
            </li>
          </ul>
        </section>

        {/* ——— Read further ——— */}
        <section aria-labelledby="further" className="mt-16">
          <SectionHeading id="further">Read the source of truth</SectionHeading>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ["/documentation.txt", "The overview your agent reads first"],
              ["/skill/add-a-day.md", "How a day is written, field by field"],
              ["/api/v2/openapi.json", "The v2 API, generated from its Zod schemas"],
              ["/docs/helper", "Fernscout Helper, in full"],
              ["/docs/hosting", "Running your own instance"],
            ].map(([href, label]) => (
              <li key={href}>
                <a
                  href={href}
                  className="flex min-h-11 flex-col justify-center rounded-xl border border-line-quiet bg-surface-base px-4 py-2 hover:border-line-prominent"
                >
                  <span className="font-mono text-sm text-ink-strong">{href}</span>
                  <span className="text-sm text-ink-secondary">{label}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <Link href="/welcome" className={PRIMARY_BUTTON}>
              Or just start writing in the studio
            </Link>
          </div>
        </section>
      </main>
    </LandingFrame>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-secondary">{children}</p>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line-quiet bg-surface-base px-2.5 py-1 font-mono text-[11px] text-ink-secondary">
      {children}
    </span>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="border-b border-line-quiet pb-3 font-display text-2xl font-semibold text-ink-strong"
    >
      {children}
    </h2>
  );
}

/**
 * A terminal, always dark — in both themes, the way a terminal is. `navy-950`
 * and `cream-50` are palette tokens with the same value in both themes
 * (`app/globals.css`), so this reads the same under either.
 */
function TerminalCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 min-w-0 overflow-hidden rounded-2xl border border-navy-800 bg-navy-950 shadow-sm">
      <div className="flex items-center gap-2 border-b border-navy-800 px-4 py-2">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-coral-400" />
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-green-500" />
        <span className="ml-2 truncate font-mono text-[11px] text-navy-300">{title}</span>
      </div>
      <div className="space-y-1 overflow-x-auto px-4 py-4 font-mono text-[13px] leading-6">
        {children}
      </div>
    </div>
  );
}

function Line({ prompt, children }: { prompt: string; children: React.ReactNode }) {
  return (
    <p className="text-cream-50 [overflow-wrap:anywhere]">
      <span aria-hidden className="mr-2 font-bold text-cream-50">
        {prompt}
      </span>
      {children}
    </p>
  );
}

function Out({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <p className={"whitespace-pre " + (muted ? "text-navy-300 italic" : "text-cream-200")}>
      {children}
    </p>
  );
}

function Card({
  icon,
  title,
  body,
  code,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  code?: string;
}) {
  return (
    <li className="flex min-w-0 list-none flex-col rounded-2xl border border-line-quiet bg-surface-base px-5 py-5">
      <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-strong">
        {icon}
        {title}
      </h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-ink-body">{body}</p>
      {code && (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-subtle p-3 font-mono text-[11px] leading-5 text-ink-strong">
          {code}
        </pre>
      )}
    </li>
  );
}

function Bullet({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1 text-coral-600">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 border-l-2 border-yellow-400 pl-4 text-sm leading-6 text-ink-body">
      {children}
    </p>
  );
}
