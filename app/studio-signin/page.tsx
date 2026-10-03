import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageShell from "@/components/landing/PageShell";
import { Band, TITLE_H1 } from "@/components/landing/kit";
import StudioSignIn from "@/components/studio/StudioSignIn";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { requestLocale, translateIn } from "@/lib/locales";

/**
 * B-2779 — what `proxy.ts` rewrites a signed-out `/@<user>/studio/**` request
 * to. It takes no parameters and names no journal, so the response is the
 * same bytes for a journal that exists and one that does not (B1829's
 * no-oracle rule). The address in the browser is untouched: signing in
 * reloads it, now with a cookie, and the proxy lets it through.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "err.notSignedInTitle") },
    robots: { index: false, follow: false },
  };
}

export default async function StudioSignInPage() {
  if (!isEnabled("auth")) notFound();
  const locale = await requestLocale();
  return (
    <PageShell slim>
      <Band width="reading">
        <h1 className={TITLE_H1}>{translateIn(locale, "err.notSignedInTitle")}</h1>
        <StudioSignIn codeMinutes={CODE_TTL_MINUTES} />
      </Band>
    </PageShell>
  );
}
