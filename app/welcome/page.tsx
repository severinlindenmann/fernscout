import type { Metadata } from "next";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { getPendingSignup } from "@/lib/signup/pending";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";
import { whatsappCountryCode } from "@/lib/contactNumber";
import WelcomeDoor from "@/components/WelcomeDoor";
import PageShell from "@/components/landing/PageShell";
import { Band } from "@/components/landing/kit";

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
  // B2804. A cookie-proven address with a signup left open: the wizard
  // picks it up where it stopped. A lookup failure is "nothing to resume".
  const resume = identity?.email
    ? Boolean(await getPendingSignup(identity.email).catch(() => null))
    : false;
  return (
    // B2531: the slim header — somebody here is mid-task, not browsing.
    <PageShell slim>
      <Band width="reading">
    <WelcomeDoor
      codeMinutes={CODE_TTL_MINUTES}
      identityEmail={identity?.email ?? null}
      resume={resume}
      signupEnabled={isEnabled("signup")}
      phoneCountryCode={whatsappCountryCode() ?? null}
      contactEmail={serverSite().operatorEmail ?? null}
    />
      </Band>
    </PageShell>
  );
}
