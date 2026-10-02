import StudioHub from "@/components/studio/StudioHub";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { buildStudioHubModel } from "@/lib/studio/hub";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * The studio's front door — `/[user]/studio`, B1829.
 *
 * "Fernscout has three front doors: the studio for anybody, a person's own
 * agent against the v2 API for those who have one, and WhatsApp for the
 * daily entry" (this ticket's brief). Before this page, the honest answer to
 * "how do I do X" was usually "ask the agent" — editing a day only findable
 * from that day, making a trip only possible through `/agent`, photographs
 * at a URL named after what the software does to the file rather than what
 * a person is trying to do. This page is the list.
 *
 * `buildStudioHubModel` does every read server-side (`lib/studio/hub.ts`);
 * this page's only job is the owner gate and handing the model to the
 * client component that renders it.
 */
export default async function StudioHubPage({ params }: PageProps<"/at/[user]/studio">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const model = await buildStudioHubModel(user);
  return <StudioHub username={user} model={model} />;
}
