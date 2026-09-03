import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import SignInButton from "@/components/SignInButton";
import { isEnabled } from "@/lib/capabilities";
import { requestLocale, translateIn } from "@/lib/locales";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The button in a sign-in email: one press, and you are reading the journal.
 *
 * Typing a six-digit code from a phone into a laptop is where a reader who is
 * not comfortable with computers gives up, and the people this is built for
 * open the site once a month from a link somebody sent them. The code is still
 * in the mail, underneath, for anyone whose client mangles links.
 *
 * ## Why this is a page and not a redirect (B142)
 *
 * It used to be a `GET` that signed you in. On 2026-09-03 three journals were
 * created on the live instance, and all three welcome links were spent at
 * 17:59 by something at the receiving mail host — twelve seconds apart, in
 * descending order of creation, before any human had opened anything. The
 * owners then followed their own links and got `?signin=expired`. A 100%
 * failure rate for the first thing this software ever says to a new owner.
 *
 * So the fetch and the sign-in are now two different things, and the second
 * one needs a press. **Scanners follow links; they do not submit forms** —
 * the same reasoning the unsubscribe route at `/{user}/u/{token}` has always
 * used, applied to the link where being spent is terminal rather than
 * recoverable.
 *
 * The standing link is permanent by design (`lib/auth/index.ts` skips the
 * expiry check for it), which is exactly what made the old failure absolute:
 * it cannot outlive a scanner by not expiring, because being *spent* is the
 * end state. Nothing here changes that. What changed is who can spend it.
 *
 * The token is not checked before rendering. Telling an anonymous fetch
 * whether a link is live is a question worth not answering, and the reader
 * finds out by pressing — which is one press either way.
 */
export default async function SignInPage({ params }: PageProps<"/[user]/s/[token]">) {
  const { user: username, token } = await params;
  const user = getUser(username);
  if (!user || !isEnabled("auth", username)) notFound();

  const locale = await requestLocale();

  return (
    <NoticeShell title={translateIn(locale, "signin.title")} body={translateIn(locale, "signin.body")}>
      <SignInButton
        username={username}
        token={token}
        label={translateIn(locale, "signin.action")}
        working={translateIn(locale, "signin.working")}
        failed={translateIn(locale, "signin.failed")}
      />
    </NoticeShell>
  );
}
