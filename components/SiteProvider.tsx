"use client";

import { createContext, useContext } from "react";
import type { SiteSummary } from "@/lib/site";

const SiteContext = createContext<SiteSummary | null>(null);

export default function SiteProvider({
  value,
  children,
}: {
  value: SiteSummary;
  children: React.ReactNode;
}) {
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/**
 * Site identity inside a client component.
 *
 * `lib/site.ts` reads the filesystem, so importing it from the client bundle
 * fails the build. The root layout seeds this once instead.
 */
export function useSite(): SiteSummary {
  const value = useContext(SiteContext);
  if (!value) {
    throw new Error("useSite() must be used inside <SiteProvider> (see app/layout.tsx)");
  }
  return value;
}
