import JournalLocaleProvider from "@/components/JournalLocaleProvider";
import StudioBarProvider from "@/components/studio/StudioBar";

/**
 * One `StudioBarProvider` over every studio page — B2001.
 *
 * The provider itself renders the page's children, then one `ActionBar` as
 * the last node — see `StudioBar.tsx`'s own doc comment for why every
 * studio subpage now gets a bottom bar without rendering one itself, and
 * why the four pages that already had one (`useStudioBar`'s callers) still
 * control it fully.
 *
 * Under the studio's own strings: the journal layout ships a reader's, and
 * the studio's flows are most of the dictionary (`lib/localeScopes.json`).
 */
export default async function StudioLayout({ children, params }: LayoutProps<"/[user]/studio">) {
  const { user } = await params;
  return (
    <JournalLocaleProvider username={user} scope="studio">
      <StudioBarProvider username={user}>{children}</StudioBarProvider>
    </JournalLocaleProvider>
  );
}
