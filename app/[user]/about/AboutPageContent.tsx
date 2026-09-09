import EntryContent from "@/components/EntryContent";
import PageHeader from "@/components/PageHeader";

/**
 * The rendering half of `/<user>/about` — split out from `page.tsx` so it can
 * be rendered in a test with plain props, the same shape `MePageContent` and
 * `TripsIndexContent` already use.
 *
 * `ownerName` is a string, never the owner object: the page that builds this
 * prop reads `journal.owner.name` and nothing else, so there is no email
 * sitting beside it here for a later edit to reach for by mistake.
 */
export default function AboutPageContent({
  title,
  ownerName,
  markdown,
}: {
  title: string;
  ownerName: string;
  markdown: string;
}) {
  return (
    <div className="min-h-screen">
      <PageHeader />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      >
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-lg text-navy-700">{ownerName}</p>
        <div className="mt-6 border-t border-navy-200 pt-6">
          <EntryContent markdown={markdown} />
        </div>
      </main>
    </div>
  );
}
