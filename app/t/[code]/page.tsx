import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import PageShell from "@/components/landing/PageShell";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { ownerShortName } from "@/lib/contacts/welcome";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip } from "@/lib/tripGate";
import { openToken } from "@/lib/tripLink";
import { lookup } from "./lookup";

export const dynamic = "force-dynamic";

/** The journal's name and nothing else: no trip title, no cover, no card. A
 * preview bot gets the same thing as a person, and a dead link looks the same. */
export async function generateMetadata({ params }: PageProps<"/t/[code]">): Promise<Metadata> {
  const { code } = await params;
  const { user } = await lookup(code);
  return {
    title: user?.title ?? "Fernscout",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * `/t/<code>` — a trip link (B2961). **A GET never acts**: it writes no row,
 * no count and no cookie, because previews, prefetchers and virus scanners
 * all GET (the same reason `/s/<token>` shows a button, B142). Reading starts
 * with the press, which posts to `/t/<code>/open`. Every refusal — unknown,
 * stopped, expired, rate-limited, trip gone, trip not guest, contacts off —
 * is this one page, so it does not say which links exist.
 */
export default async function TripLinkPage({ params }: PageProps<"/t/[code]">) {
  const { code } = await params;
  const { link, user } = await lookup(code);

  if (!link || !user) {
    const locale = await requestLocale();
    return (
      <PageShell slim>
        <NoticeShell
          inFrame
          lang={locale}
          title={translateIn(locale, "err.linkExpiredTitle")}
          body={translateIn(locale, "err.linkExpiredBodyShared")}
          actions={[{ href: "/", label: translateIn(locale, "err.goToStart") }]}
        />
      </PageShell>
    );
  }

  const { owner, trip } = link;
  const tripPath = `${journalPath(owner)}/trips/${trip.id}`;
  // Already allowed in (owner, traveller, guest, keeper, or this link's own
  // cookie): nothing to press, nothing to store, nothing to count.
  if (await mayReadTrip(trip)) redirect(tripPath);

  const locale = pickLocale(fromAcceptLanguage((await headers()).get("accept-language")), null, user.defaultLocale);
  const ownerName = ownerShortName(user);
  return (
    <PageShell slim>
      <NoticeShell
        inFrame
        lang={locale}
        title={translateIn(locale, "tripLink.title", { owner: ownerName })}
        body={translateIn(locale, "tripLink.body", { owner: ownerName })}
      >
        <form method="post" action={`/t/${encodeURIComponent(code)}/open`} className="mt-9">
          <input type="hidden" name="token" value={openToken(code)} />
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
          >
            {translateIn(locale, "tripLink.open")}
          </button>
        </form>
        <p className="mt-6 text-lg text-ink-body">
          <Link href={`${journalPath(owner)}/me`} className="underline">
            {translateIn(locale, "tripLink.signIn")}
          </Link>
        </p>
      </NoticeShell>
    </PageShell>
  );
}
