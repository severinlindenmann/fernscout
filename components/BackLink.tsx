"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useHasInAppHistory } from "./useBackHistory";

/**
 * The one back arrow, used everywhere one is drawn — B822.
 *
 * Retraces through this app's own history when there is one
 * (`useHasInAppHistory`), and falls back to a fixed parent when there is
 * not — most readers here arrive on a link straight into one day, with
 * nothing in-app before it, and `router.back()` for them would leave the
 * site. The label follows the same split: generic (`retraceLabel`, "Back" /
 * "Zurück") while retracing, since the actual destination is then whatever
 * the reader happened to visit before this page and a specific word would be
 * a promise this control cannot keep; the caller's own specific word
 * (`fallbackLabel`, "Your journals", "Back to Fernscout", …) only when the
 * destination really is the fixed parent it names.
 *
 * Both labels arrive pre-translated (`t(...)` from a client caller,
 * `translateIn(...)` from a server one) so this component itself needs no
 * translation context — which is what lets it drop into `app/agent/layout.tsx`
 * and `app/docs/layout.tsx`, both server components with no `LocaleProvider`
 * above them.
 *
 * Retracing renders a `<button>` calling `router.back()` rather than a link —
 * there is no honest `href` for "wherever the browser's own history says",
 * and the fixed-parent case, which does have one, still gets a real `<Link>`
 * so a middle-click keeps working there.
 */
export default function BackLink({
  fallbackHref,
  fallbackLabel,
  retraceLabel,
  className,
  iconClassName = "h-4 w-4",
  showLabel = true,
}: {
  fallbackHref: string;
  fallbackLabel: string;
  retraceLabel: string;
  className?: string;
  iconClassName?: string;
  showLabel?: boolean;
}) {
  const router = useRouter();
  const retrace = useHasInAppHistory();
  const label = retrace ? retraceLabel : fallbackLabel;
  const icon = <ArrowLeft className={iconClassName} aria-hidden strokeWidth={2.4} />;

  if (retrace) {
    return (
      <button
        type="button"
        onClick={() => router.back()}
        className={className}
        aria-label={showLabel ? undefined : label}
      >
        {icon}
        {showLabel && <span className="truncate">{label}</span>}
      </button>
    );
  }

  return (
    <Link href={fallbackHref} className={className} aria-label={showLabel ? undefined : label}>
      {icon}
      {showLabel && <span className="truncate">{label}</span>}
    </Link>
  );
}
