import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AccountPage from "@/app/me/AccountPage";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { installedLocales, requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

/**
 * `/me` — the person, across every journal on this instance.
 *
 * Where somebody is owner, traveller or guest; the devices they are signed in
 * on; signing out here or everywhere. What belongs to one journal (the trips
 * it lets them read, its push and contact settings) stays on that journal's
 * own `/@<user>/me`, and this page links there rather than copying it.
 *
 * Absent — a 404, not an empty page — when `auth` is off: with no sign-in
 * there is no "me" for this page to be about (closed by default).
 *
 * The page itself carries nothing personal. Like the landing page's signed-in
 * half it is filled in the browser from `/api/v2/me/home`, so no reader's
 * list is ever part of a document a cache could hand to the next one (B412).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "meAccount.metaTitle", { name: serverSite().name }) },
    robots: { index: false, follow: false },
  };
}

export default function Me() {
  if (!isEnabled("auth")) notFound();
  return (
    <AccountPage
      siteName={serverSite().name}
      locales={installedLocales()}
      codeMinutes={CODE_TTL_MINUTES}
    />
  );
}
