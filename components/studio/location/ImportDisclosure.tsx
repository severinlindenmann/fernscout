"use client";

import { useState, type ReactNode } from "react";

/**
 * "Import existing history", folded away — B2240. The import flow's primary
 * button is mounted into the page's shared `StudioBar` through context, not
 * inside this element, so a closed `<details>` alone would still show it.
 * The children are therefore only mounted once the owner opens the section.
 */
export default function ImportDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="group mt-10 rounded-2xl border border-line-strong p-4"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none font-display text-lg font-semibold text-ink-strong">
        <span aria-hidden="true" className="mr-2 inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      {open && children}
    </details>
  );
}
