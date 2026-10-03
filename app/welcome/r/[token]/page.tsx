import type { Metadata } from "next";
import PageShell from "@/components/landing/PageShell";
import { Band } from "@/components/landing/kit";
import SignupResume from "@/components/SignupResume";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { whatsappCountryCode } from "@/lib/contactNumber";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

// The token is in the path; keep it out of search engines and referrers.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The button in the signup code mail — B2781. Like `/at/<user>/s/<token>`
 * (B142) this page spends nothing: a mail scanner that fetches it costs the
 * person nothing, and the press (a POST) is what resumes the signup. The
 * token is not checked before rendering, so an anonymous fetch learns
 * nothing about whether a link is live.
 */
export default async function ResumePage({ params }: PageProps<"/welcome/r/[token]">) {
  const { token } = await params;
  return (
    <PageShell slim>
      <Band width="reading">
        <SignupResume
          token={token}
          signupEnabled={isEnabled("signup")}
          codeMinutes={CODE_TTL_MINUTES}
          phoneCountryCode={whatsappCountryCode() ?? null}
          contactEmail={serverSite().operatorEmail ?? null}
        />
      </Band>
    </PageShell>
  );
}
