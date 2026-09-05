import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import SignInButton from "@/components/SignInButton";
import { isEnabled } from "@/lib/capabilities";
import { requestLocale, translateIn } from "@/lib/locales";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The button in an identity sign-in email — B430.
 *
 * `/<user>/s/<token>` one level down is the same page for one journal; this is
 * the instance-wide one, and it lives at the root because an identity belongs
 * to no journal. No collision is possible: `USERNAME_RE` needs at least two
 * characters, so nothing can ever be called `s`.
 *
 * A page with a press rather than a redirect, for B142's reason in full: three
 * welcome links on the live instance were spent at 17:59 by something at the
 * receiving mail host, twelve seconds apart, before any human had opened
 * anything — a 100% failure rate for the first thing this software says to a
 * new owner. Scanners follow links; they do not submit forms.
 *
 * The token is not checked before rendering. Telling an anonymous fetch
 * whether a link is live is a question worth not answering, and the reader
 * finds out by pressing — which is one press either way.
 */
export default async function IdentitySignInPage({
  params,
}: PageProps<"/s/[token]">) {
  const { token } = await params;
  if (!isEnabled("auth")) notFound();

  const locale = await requestLocale();

  return (
    <NoticeShell
      title={translateIn(locale, "signin.identityTitle")}
      body={translateIn(locale, "signin.identityBody")}
    >
      <SignInButton
        token={token}
        label={translateIn(locale, "signin.identityAction")}
        working={translateIn(locale, "signin.identityWorking")}
        failed={translateIn(locale, "signin.identityFailed")}
      />
    </NoticeShell>
  );
}
