"use client";

import { useSearchParams } from "next/navigation";

/**
 * Arrived from the hub, at the flow's bare address — B2141.
 *
 * The hub's row already said what a flow does, so its link carries
 * `?from=hub` and the flow opens on its first real step instead of repeating
 * that in an intro whose only button starts the flow. A direct link (no
 * `from`) still shows the intro. Once the flow has moved on (`?step=` is
 * set), this is false again: Back to the bare address lands on that first
 * real step, and Back once more leaves for the hub.
 */
export function useSkipIntro(): boolean {
  const params = useSearchParams();
  return params?.get("from") === "hub" && !params.has("step");
}
