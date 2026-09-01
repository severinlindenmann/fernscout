import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DeleteConfirm from "@/components/DeleteConfirm";
import NoticeShell from "@/components/NoticeShell";
import { isEnabled } from "@/lib/capabilities";
import {
  DELETION_TTL_MINUTES,
  deletionExportUrl,
  humanBytes,
  resolveDeletionToken,
} from "@/lib/deletions";
import { translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Never indexed, never followed. The URL is a credential. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * "You asked to delete this" — the page the mailed link lands on.
 *
 * **Opening it deletes nothing**, and that is the single most important fact
 * about this file. Mail scanners, link previewers and corporate security
 * appliances follow links in mail; a GET that destroyed a journal would
 * eventually be followed by a robot, and there is no undo. The repository has
 * already argued both sides of this: `/[user]/s/[token]` accepts a sign-in on
 * GET because the worst outcome is a read session nobody uses, and
 * `/[user]/u/[token]` refuses to unsubscribe on GET because the loss is
 * invisible and irreversible. Deleting a journal is far past the second case.
 *
 * So this renders, and the deletion happens on a POST from the button — see
 * `components/DeleteConfirm.tsx` and `app/api/v1/[user]/deletions/[token]`.
 *
 * The export comes **above** the button, in the journal's own language and
 * with private trips and drafts in it. Somebody about to remove five years of
 * writing should be handed a copy without having to think of it.
 */
export default async function DeletePage({ params }: PageProps<"/[user]/delete/[token]">) {
  const { user: username, token } = await params;
  const user = getUser(username);
  if (!user || !isEnabled("auth", username)) notFound();

  const locale = user.defaultLocale;
  const site = serverSite();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  const resolved = await resolveDeletionToken(username, token);
  if (!resolved.ok) {
    // Not a 404. An expired link, a spent one and a target that has already
    // gone send a person to three different next steps, and a page that says
    // "not found" to all three leaves them thinking they broke something.
    const body =
      resolved.reason === "used"
        ? t("del.usedBody")
        : resolved.reason === "gone"
          ? t("del.goneNothingBody")
          : t("del.expiredBody", { minutes: DELETION_TTL_MINUTES });
    return (
      <NoticeShell
        lang={locale}
        title={t("del.expiredTitle")}
        body={body}
        actions={[{ href: `/${username}`, label: t("err.goToJournal", { title: user.title }) }]}
      />
    );
  }

  const { pending } = resolved;
  const summary = pending.summary!;
  const isJournal = pending.kind === "journal";
  const vars = {
    title: summary.title,
    journal: summary.journalTitle,
    site: site.name,
    url: `${site.url}/${username}`,
    trips: String(summary.trips),
    days: String(summary.days),
    files: String(summary.files),
    size: humanBytes(summary.bytes),
    minutes: DELETION_TTL_MINUTES,
  };

  return (
    <main id="main" tabIndex={-1} lang={locale} className="mx-auto w-full max-w-xl px-6 py-16 sm:py-24">
      <h1 className="font-display text-3xl font-semibold leading-tight text-navy-900 sm:text-4xl">
        {t(isJournal ? "del.journalTitle" : "del.tripTitle")}
      </h1>
      <p className="mt-5 text-xl leading-8 text-navy-700">{t("del.pageLead", vars)}</p>

      <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
        {t("del.whatGoesHeading")}
      </h2>
      <p className="mt-3 text-lg leading-8 text-navy-700">
        {t(isJournal ? "del.journalWhatGoes" : "del.tripWhatGoes", vars)}
      </p>

      <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
        {t("del.exportHeading")}
      </h2>
      <p className="mt-3 text-lg leading-8 text-navy-700">{t("del.export")}</p>
      <p className="mt-4">
        <a
          href={deletionExportUrl(site.url, username, token)}
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-navy-200 bg-white px-6 text-lg font-semibold text-navy-700 transition-colors hover:border-navy-500"
        >
          {t("del.exportButton")}
        </a>
      </p>

      <p className="mt-10 text-lg leading-8 text-navy-700">{t("del.backups")}</p>

      <DeleteConfirm
        endpoint={`/api/v1/${username}/deletions/${token}`}
        keepHref={`/${username}`}
        labels={{
          remove: t("del.deleteButton"),
          working: t("del.working"),
          keep: t("del.keep"),
          failed: t("del.failed"),
          doneTitle: t(isJournal ? "del.doneJournalTitle" : "del.doneTripTitle"),
          doneBody: t(isJournal ? "del.doneJournalBody" : "del.doneTripBody", vars),
        }}
      />
    </main>
  );
}
