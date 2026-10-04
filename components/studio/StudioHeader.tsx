"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import PageHeader from "@/components/PageHeader";
import { useStudioFlowState } from "@/components/studio/StudioBar";
import { studioUp, type StudioUp } from "@/lib/studio/studioUp";

/**
 * The studio's one reading of "where is up" — B2853. Pathname and query come
 * from the address, so the header and the bottom bar (which calls this too)
 * can never name different places. `tripId` is only for a page whose address
 * lacks it and whose server render already knows it (`day/edit?slug=`).
 */
export function useStudioUp(username: string, tripId?: string): StudioUp {
  const pathname = usePathname() ?? "";
  const query = useSearchParams();
  return studioUp(username, pathname, query ?? new URLSearchParams(), { tripId });
}

/**
 * `PageHeader` with its back set to the studio page's real parent; none on
 * the hub. In a flow (`useStudioFlow`, B2854) the back is "Cancel".
 */
export default function StudioHeader({ username, back, tripId }: { username: string; back: boolean; tripId?: string }) {
  const up = useStudioUp(username, tripId);
  const flow = useStudioFlowState();
  if (flow) return <FlowHeader up={up} flow={flow} />;
  return <PageHeader backTo={back ? up : undefined} />;
}

/** Cancel leaves for the page's parent at once, or asks first when something was entered. */
function FlowHeader({ up, flow }: { up: StudioUp; flow: NonNullable<ReturnType<typeof useStudioFlowState>> }) {
  const router = useRouter();
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const cancel = { label: t("studio.flow.cancel"), onClick: () => (flow.dirty ? setAsking(true) : router.push(up.href)) };
  return (
    <>
      <PageHeader backTo={up} cancel={cancel} />
      {asking && (
        <div className="mx-auto w-full max-w-xl px-4 pt-4">
          <ConfirmPanel
            label={t("studio.flow.cancel")}
            question={flow.question}
            confirmLabel={flow.leaveLabel}
            cancelLabel={t("studio.flow.stay")}
            onConfirm={() => router.push(up.href)}
            onCancel={() => setAsking(false)}
          />
        </div>
      )}
    </>
  );
}
