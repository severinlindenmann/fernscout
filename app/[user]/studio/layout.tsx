import StudioBarProvider from "@/components/studio/StudioBar";

/**
 * One `StudioBarProvider` over every studio page — B2001.
 *
 * The provider itself renders the page's children, then one `ActionBar` as
 * the last node — see `StudioBar.tsx`'s own doc comment for why every
 * studio subpage now gets a bottom bar without rendering one itself, and
 * why the four pages that already had one (`useStudioBar`'s callers) still
 * control it fully.
 */
export default async function StudioLayout({ children, params }: LayoutProps<"/[user]/studio">) {
  const { user } = await params;
  return <StudioBarProvider username={user}>{children}</StudioBarProvider>;
}
