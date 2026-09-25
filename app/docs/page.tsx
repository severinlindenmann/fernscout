import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Code2,
  FileText,
  GitPullRequest,
  ImageIcon,
  MessageCircle,
  PenLine,
  Plus,
  Users,
} from "lucide-react";
import Pricing from "@paid/credits/components/Pricing";
import { isEnabled } from "@/lib/capabilities";
import { DOCS_PAGES, type DocsPageId } from "@/lib/docs";
import type { TranslationKey } from "@/lib/i18n";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

/**
 * The tab title and the description, in the language the page renders in.
 *
 * These were a static `Metadata` object with English literals, which is B225
 * exactly one page over: a German reader got "How to use, host and contribute
 * to this journal" in the browser tab, in the search result and in every link
 * preview, above a page rendered entirely in German. A static `metadata`
 * export cannot see the request, so it cannot see the locale — the fix is the
 * same one `app/page.tsx` uses, and it is `generateMetadata`.
 *
 * `absolute` because the root layout's template appends the site name, and
 * these titles are complete sentences on their own.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "docs.title") },
    description: translateIn(locale, "docs.lede"),
  };
}

/**
 * The documentation hub — B470, redrawn when the reader guides were retired.
 *
 * It answers one question — where are you going — and its cards are its
 * navigation, which is why `DocsNav` is deliberately *not* rendered here.
 *
 * Three doors, each a card that says what is behind it rather than a bare
 * label: start a journal, run your own, build on the API. The first is
 * absent where `auth` is off, because without it nobody can write and a door
 * to a journal that cannot be written is not a door (closed by default). The
 * two technical ones say *in the reader's language* that their pages are in
 * English: those pages are read from `README.md` and `docs/` at request time
 * (B23), and the mix of languages is only confusing when nobody admits to it.
 *
 * "Ways to add a day" lists only the ways this instance actually has — the
 * WhatsApp tile is drawn only where `whatsappInbound` is on, and none of it
 * where `auth` is off. Each ends in a draft, and the page says so, because the
 * one thing a reader of this page should not come away believing is that
 * writing publishes.
 */
const MORE: { id: DocsPageId; icon: typeof Bot }[] = [
  { id: "contributing", icon: GitPullRequest },
  { id: "helper", icon: Bot },
];

function page(id: DocsPageId) {
  const found = DOCS_PAGES.find((p) => p.id === id);
  if (!found) throw new Error(`no docs page "${id}"`);
  return found;
}

const CARD =
  "group flex h-full flex-col overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised " +
  "transition-colors hover:border-line-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

function DoorCard({
  locale,
  href,
  eyebrowKey,
  titleKey,
  bodyKey,
  ctaKey,
  accent,
  children,
}: {
  locale: string;
  href: string;
  eyebrowKey: TranslationKey;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  ctaKey: TranslationKey;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <li>
      <Link href={href} className={CARD}>
        <div aria-hidden className="h-40 shrink-0 overflow-hidden sm:h-44">
          {children}
        </div>
        <div className="flex flex-1 flex-col gap-2 px-5 pb-5 pt-4">
          <span
            className={`font-mono text-xs font-medium uppercase tracking-wide ${
              accent ? "text-coral-600" : "text-ink-secondary"
            }`}
          >
            {translateIn(locale, eyebrowKey)}
          </span>
          <h2 className="font-display text-2xl font-semibold text-ink-strong">
            {translateIn(locale, titleKey)}
          </h2>
          <p className="flex-1 text-base leading-relaxed text-ink-body">{translateIn(locale, bodyKey)}</p>
          <span className="mt-2 inline-flex items-center gap-1.5 text-base font-bold text-ink-strong">
            {translateIn(locale, ctaKey)}
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
              strokeWidth={2.4}
            />
          </span>
        </div>
      </Link>
    </li>
  );
}

/** The studio, drawn small: three of the rows its hub really has, in the
 * reader's language, so the picture is of the thing rather than of an icon. */
function StudioSketch({ locale }: { locale: string }) {
  const rows: { icon: typeof Plus; key: TranslationKey; strong?: boolean }[] = [
    { icon: Plus, key: "studio.hub.addDay.title", strong: true },
    { icon: ImageIcon, key: "studio.day.field.media" },
    { icon: Users, key: "studio.hub.item.readers.title" },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-2 bg-surface-subtle px-5">
      {rows.map(({ icon: Icon, key, strong }) => (
        <div
          key={key}
          className="flex items-center gap-2.5 rounded-xl border border-line-quiet bg-surface-raised px-3 py-2
                     text-sm font-semibold text-ink-strong"
        >
          <Icon
            className={`h-4 w-4 shrink-0 ${strong ? "text-coral-600" : "text-ink-secondary"}`}
            strokeWidth={2.4}
          />
          {translateIn(locale, key)}
        </div>
      ))}
    </div>
  );
}

function Way({
  locale,
  icon: Icon,
  titleKey,
  bodyKey,
  accent,
}: {
  locale: string;
  icon: typeof Bot;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  accent?: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-line-quiet bg-surface-raised p-5">
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${
          accent ? "bg-coral-50 text-coral-600" : "bg-surface-neutral-strong text-ink-body"
        }`}
      >
        <Icon className="h-5 w-5" aria-hidden strokeWidth={2.2} />
      </span>
      <h3 className="text-base font-bold text-ink-strong">{translateIn(locale, titleKey)}</h3>
      <p className="text-sm leading-relaxed text-ink-body">{translateIn(locale, bodyKey)}</p>
    </li>
  );
}

function RowLink({
  href,
  icon: Icon,
  label,
  blurb,
  mono,
}: {
  href: string;
  icon: typeof Bot;
  label: string;
  blurb: string;
  mono?: boolean;
}) {
  return (
    <li>
      <a
        href={href}
        className="flex min-h-11 items-start gap-3 rounded-xl py-2 transition-colors hover:text-ink-strong
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden strokeWidth={2.2} />
        <span className="flex flex-col gap-0.5">
          <span className={mono ? "font-mono text-sm font-medium text-ink-strong" : "font-bold text-ink-strong"}>
            {label}
          </span>
          <span className="text-sm text-ink-secondary">{blurb}</span>
        </span>
      </a>
    </li>
  );
}

export default async function DocsPage() {
  const locale = await requestLocale();
  const site = serverSite();
  const writing = isEnabled("auth");
  const hosting = page("hosting");
  const api = page("api");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-5xl">
        {translateIn(locale, "docs.title")}
      </h1>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-body sm:text-xl">
        {translateIn(locale, "docs.lede")}
      </p>

      <ul className={`mt-10 grid gap-5 ${writing ? "md:grid-cols-3" : "sm:grid-cols-2"}`}>
        {writing && (
          <DoorCard
            locale={locale}
            href="/welcome"
            eyebrowKey="docs.start.eyebrow"
            titleKey="docs.start.title"
            bodyKey="docs.start.body"
            ctaKey="docs.start.cta"
            accent
          >
            <StudioSketch locale={locale} />
          </DoorCard>
        )}
        <DoorCard
          locale={locale}
          href={hosting.href}
          eyebrowKey="docs.hosting.eyebrow"
          titleKey="docs.hosting.card"
          bodyKey={hosting.blurbKey}
          ctaKey="docs.hosting.cta"
        >
          {/* Served by `app/docs/screenshots/[file]/route.ts`, the same file
              the README and `/docs/hosting` show. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/docs/screenshots/trip-map.jpg" alt="" className="h-full w-full object-cover" />
        </DoorCard>
        <DoorCard
          locale={locale}
          href={api.href}
          eyebrowKey="docs.api.eyebrow"
          titleKey="docs.api.card"
          bodyKey={api.blurbKey}
          ctaKey="docs.api.cta"
        >
          <pre className="flex h-full flex-col justify-center bg-overlay-strong px-5 font-mono text-xs leading-relaxed text-overlay-ink">
            <span className="font-semibold">GET /openapi.json</span>
            {"{\n  \"openapi\": \"3.1.0\",\n  \"paths\": { … }\n}"}
          </pre>
        </DoorCard>
      </ul>

      {writing && (
        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold text-ink-strong">
            {translateIn(locale, "docs.ways.title")}
          </h2>
          <p className="mt-1 text-ink-secondary">{translateIn(locale, "docs.ways.lede")}</p>
          <ul
            className={`mt-5 grid gap-4 sm:grid-cols-2 ${
              isEnabled("whatsappInbound") ? "lg:grid-cols-3" : ""
            }`}
          >
            <Way
              locale={locale}
              icon={PenLine}
              titleKey="docs.ways.studio.title"
              bodyKey="docs.ways.studio.body"
              accent
            />
            <Way locale={locale} icon={Bot} titleKey="docs.ways.agent.title" bodyKey="docs.ways.agent.body" />
            {isEnabled("whatsappInbound") && (
              <Way
                locale={locale}
                icon={MessageCircle}
                titleKey="docs.ways.whatsapp.title"
                bodyKey="docs.ways.whatsapp.body"
              />
            )}
          </ul>
        </section>
      )}

      <div className="mt-14 grid gap-10 border-t border-line-quiet pt-8 sm:grid-cols-2">
        <section>
          <h2 className="font-display text-xl font-semibold text-ink-strong">
            {translateIn(locale, "docs.moreGroup")}
          </h2>
          <ul className="mt-3 flex flex-col gap-1">
            {MORE.map(({ id, icon }) => {
              const p = page(id);
              return (
                <RowLink
                  key={id}
                  href={p.href}
                  icon={icon}
                  label={translateIn(locale, p.labelKey)}
                  blurb={translateIn(locale, p.blurbKey)}
                />
              );
            })}
          </ul>
        </section>
        {/*
          The two agent-facing documents. Not cards: they are not pages a
          person reads, and putting them in the row of doors is how the old
          page came to address two audiences with one control.
        */}
        <section>
          <h2 className="font-display text-xl font-semibold text-ink-strong">
            {translateIn(locale, "docs.agentsGroup")}
          </h2>
          <ul className="mt-3 flex flex-col gap-1">
            <RowLink
              href="/documentation.txt"
              icon={FileText}
              label="/documentation.txt"
              blurb={translateIn(locale, "docs.documentationTxt")}
              mono
            />
            <RowLink
              href="/openapi.json"
              icon={Code2}
              label="/openapi.json"
              blurb={translateIn(locale, "docs.openapi")}
              mono
            />
          </ul>
        </section>
      </div>

      {/*
        The same table the landing page carries, and deliberately the same
        component rather than a second page under `DOCS_PAGES` — one price
        list, two places it is asked for. Absent where credits are off. B840.
      */}
      {isEnabled("credits") && <Pricing locale={locale} />}

      <p className="mt-12 border-t border-line-quiet pt-6 font-mono text-xs text-ink-secondary">{site.url}</p>
    </main>
  );
}
