import type { Metadata } from "next";
import AgentPageContent, { type PermissionRow } from "./AgentPageContent";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { isEnabled } from "@/lib/capabilities";
import { currentHelperProvider, helperConsent, type HelperScope } from "@/lib/helper/consent";
import { operatorMayRead } from "@/lib/helper/sessions";
import { requestLocale, translateIn } from "@/lib/locales";

/**
 * Permissions & keys — B2142 (was "Agent"; the route stays). The agent card — B2017, moved whole from the owner block on `/[user]/me`
 * (`MePageContent.tsx`, B283/B301/B1390) so all journal administration lives
 * in the studio. Same read `/[user]/me` used to build these props, owner
 * only, moved here by this ticket.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[user]/studio/agent">): Promise<Metadata> {
  const { user } = await params;
  return {
    title: translateIn(await requestLocale(), "studio.hub.item.agent.title"),
    robots: { index: false, follow: false },
  };
}

export default async function StudioAgentPage({ params }: PageProps<"/[user]/studio/agent">) {
  const { user } = await params;
  await requireStudioOwner(user);

  /**
   * The four rows of "What leaves this server" — B2142. `statement` folds into
   * the words row: both go to `currentHelperProvider`'s model, so one switch
   * says it truthfully. Each row names today's recipient.
   */
  const consent = helperConsent(user);
  const has = (scope: HelperScope) => consent?.scopes.includes(scope) ?? false;
  const helperOn = isEnabled("helper", user);
  const permissions: PermissionRow[] = [
    { id: "words", granted: (["words", "statement"] as const).filter(has), provider: currentHelperProvider("words") },
    { id: "speech", granted: has("speech") ? ["speech"] : [], provider: currentHelperProvider("speech") },
    { id: "photos", granted: has("photos") ? ["photos"] : [], provider: currentHelperProvider("photos") },
    // Absent where there is no helper on this journal to have conversations — B976.
    ...(helperOn
      ? [{ id: "sessions" as const, granted: operatorMayRead(user) ? ["sessions" as const] : [], provider: currentHelperProvider("sessions") }]
      : []),
  ];

  const locale = await requestLocale();
  return (
    <StudioPage
      username={user}
      group="journal"
      title={translateIn(locale, "studio.hub.item.agent.title")}
      lede={translateIn(locale, "studio.permissions.lede")}
    >
      <AgentPageContent username={user} permissions={permissions} />
    </StudioPage>
  );
}
