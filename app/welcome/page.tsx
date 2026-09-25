import type { Metadata } from "next";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";
import WelcomeDoor from "@/components/WelcomeDoor";

// Reads the identity cookie to prefill the address; nothing to prerender.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "signupPage.metaTitle", { name: serverSite().name }) },
    robots: { index: false, follow: false },
  };
}

/**
 * Making a journal from nothing — B2170. It used to live on `/agent`
 * (`AgentDoor`), which is being retired; this was a `redirect("/")`.
 */
export default async function Welcome() {
  const identity = isEnabled("auth") ? await resolveIdentity() : null;
  return (
    <WelcomeDoor
      codeMinutes={CODE_TTL_MINUTES}
      identityEmail={identity?.email ?? null}
      signupEnabled={isEnabled("signup")}
      siteName={serverSite().name}
    />
  );
}
