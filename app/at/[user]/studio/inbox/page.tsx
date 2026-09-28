import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import InboxHub from "@/components/studio/inbox/InboxHub";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { buildInboxHubModel } from "@/lib/studio/inbox";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * "What is waiting" — B1990. The studio's own view over `content/<user>/inbox/`,
 * previously reachable only from the helper room (`/agent/<user>/inbox`,
 * `AgentInbox.tsx`). `buildInboxHubModel` (`lib/studio/inbox.ts`) does every
 * `node:fs` read server-side; this page's only job is the owner gate.
 */
export default async function StudioInboxPage({ params }: PageProps<"/at/[user]/studio/inbox">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const model = buildInboxHubModel(user);
  const locale = await requestLocale();
  return (
    <StudioPage
      username={user}
      group="bringIn"
      title={translateIn(locale, "studio.inbox.title")}
      lede={translateIn(locale, "studio.inbox.intro")}
      width="board"
    >
      <InboxHub username={user} model={model} />
    </StudioPage>
  );
}
