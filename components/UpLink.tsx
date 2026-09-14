import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * One step up, and the only way this app draws that arrow — B1728.
 *
 * Always a real `<Link>` to a fixed ancestor, always carrying that ancestor's
 * own name. It replaced `BackLink`, which had a second mode: a `<button>`
 * calling `router.back()`, chosen by a `sessionStorage` flag, labelled with
 * the generic word "Back" because the destination was whatever the reader
 * happened to visit before. Three things came back with the link and are the
 * point of the change — the same page always leads to the same place, the
 * browser shows where before you commit, and a middle-click opens it.
 *
 * `label` arrives already translated, or is a proper noun (a journal's title,
 * a trip's, the instance's name), which is what lets this drop into
 * `app/docs/layout.tsx` and `app/agent/[user]/layout.tsx` — server components
 * with no `LocaleProvider` above them. No "use client" for the same reason:
 * there is nothing here but a link.
 *
 * `showLabel={false}` is for chrome with no room for a word — the helper
 * room's toolbar — and it is the caller's job to pass `label` anyway, since
 * that is what becomes the accessible name. The header's phone row does *not*
 * use it: an unlabelled arrow there is exactly what made the old one
 * unreadable.
 */
export default function UpLink({
  href,
  label,
  className,
  iconClassName = "h-4 w-4",
  showLabel = true,
  labelClassName = "truncate",
}: {
  href: string;
  label: string;
  className?: string;
  iconClassName?: string;
  showLabel?: boolean;
  labelClassName?: string;
}) {
  return (
    <Link href={href} className={className} aria-label={showLabel ? undefined : label}>
      <ArrowLeft className={iconClassName} aria-hidden strokeWidth={2.4} />
      {showLabel && <span className={labelClassName}>{label}</span>}
    </Link>
  );
}
