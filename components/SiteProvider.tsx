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
  const value = useOptionalSite();
  if (!value) {
    throw new Error("useSite() must be used inside <SiteProvider> (see app/layout.tsx)");
  }
  return value;
}

/**
 * Site identity where there might legitimately be none.
 *
 * `SiteProvider` is seeded by `app/[user]/layout.tsx`, because the trip list
 * and the currencies belong to a journal. The landing page, the notices and a
 * 404 for an address that names nobody sit *above* that, so a component shared
 * with them — the language switcher — has to be able to ask and be told no,
 * rather than throwing on the one page a new visitor sees first.
 */
export function useOptionalSite(): SiteSummary | null {
  return useContext(SiteContext);
}
