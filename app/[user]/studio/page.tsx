import StudioHub from "@/components/studio/StudioHub";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { buildStudioHubModel } from "@/lib/studio/hub";
import { isEnabled } from "@/lib/capabilities";
import { readTellBy } from "@/lib/studio/tellBy";

export const dynamic = "force-dynamic";

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
export default async function StudioHubPage({ params }: PageProps<"/[user]/studio">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const model = await buildStudioHubModel(user);
  return (
    <StudioHub
      username={user}
      model={model}
      speak={isEnabled("transcription", user) && readTellBy(user) === "speak"}
    />
  );
}
