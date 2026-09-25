import StudioBarProvider from "@/components/studio/StudioBar";
import { offlineKeepTrips } from "@/lib/studio/day";

/**
 * One `StudioBarProvider` over every studio page — B2001.
 *
 * The provider itself renders the page's children, then one `ActionBar` as
 * the last node — see `StudioBar.tsx`'s own doc comment for why every
 * studio subpage now gets a bottom bar without rendering one itself, and
 * why the four pages that already had one (`useStudioBar`'s callers) still
 * control it fully.
 *
 * B2330, D6 — `offlineKeepTrips` names the current trip and the soonest
 * upcoming one, read here once per navigation into the studio rather than
 * through a new route: the provider is already the one client component
 * every studio page mounts, so it is where "the studio is open" already
 * means something.
 */
export default async function StudioLayout({ children, params }: LayoutProps<"/[user]/studio">) {
  const { user } = await params;
  return (
    <StudioBarProvider username={user} autoKeepTrips={offlineKeepTrips(user)}>
      {children}
    </StudioBarProvider>
  );
}
