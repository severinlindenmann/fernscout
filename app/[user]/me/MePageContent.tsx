"use client";

import Link from "next/link";
import CopyLine from "@/components/CopyLine";
import GuestSignIn from "@/components/GuestSignIn";
import SignOut from "@/components/SignOut";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import { useSite } from "@/components/SiteProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { Viewer } from "@/lib/viewer";

/**
 * "What can I see?"
 *
 * Written for the reader least comfortable with software on the site — the
 * grandmother who opens it once a month from a link in an email and, when she
 * loses the email, has no way back in. So: large type, few controls, no
 * jargon, and every line answers a question she would actually ask.
 *
 * It is deliberately not an account page. There is no trip creation form and
 * no entry editing, because writing happens through an agent (ROADMAP decision
 * 24) — the panel's job is to tell you what to hand one, and to let you change
 * the one thing that is genuinely yours: your own name and address.
 */
export default function MePageContent({
  viewer,
  username,
  docUrl,
  manageHref,
  canJoin,
  canSignIn,
}: {
  viewer: Viewer;
  username: string;
  docUrl: string;
  /** Present only when this reader has a contact record to edit. */
  manageHref?: string;
  /** Whether this journal keeps a guestbook — `/{user}/join` 404s if not. */
  canJoin: boolean;
  /** Whether codes can be issued at all, which is what signing in needs. */
  canSignIn: boolean;
}) {
  const { t } = useI18n();
  const site = useSite();

  const reason: Record<Viewer["trips"][number]["through"], TranslationKey> = {
    public: "me.viaPublic",
    traveller: "me.viaTraveller",
    guest: "me.viaGuest",
  };

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("me.title")}
        </h1>

        {!viewer.email ? (
          <>
            <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
              <h2 className="font-display text-xl font-semibold text-navy-900">
                {t("me.strangerTitle")}
              </h2>
              <p className="mt-2 text-lg leading-8 text-navy-700">{t("me.strangerBody")}</p>

              {/*
                What is on offer depends on what this journal actually runs,
                and the guestbook is named once rather than twice.

                Signing in comes first when it is available: somebody reading
                this has almost certainly been here before and lost the email,
                and offering them the sign-up form first asks them to become a
                second person. The guestbook is then a quiet line underneath,
                for whoever really is new. With no sign-in it is the only door,
                so it takes the button.
                The guestbook link used to be unconditional, and on a journal
                that keeps no guestbook it led to a 404 — the reader pressed
                the only button on the page and was told the page does not
                exist. When neither door is open, say so in a sentence instead
                of showing a control that cannot work.
              */}
              {canJoin && !canSignIn && (
                <Link
                  href={`${site.base}/join`}
                  className="mt-4 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                >
                  {t("contact.submit")}
                </Link>
              )}
              {!canJoin && !canSignIn && (
                <p className="mt-4 border-l-2 border-yellow-400 pl-4 text-base leading-7 text-navy-900">
                  {t("me.askOwner")}
                </p>
              )}
            </section>

            {/* The way back for somebody who has been here before and lost the
                email they were let in with. */}
            {canSignIn && <GuestSignIn username={username} />}

            {canSignIn && canJoin && (
              <p className="mt-4 text-base text-navy-700">
                {t("me.newHere")}{" "}
                <Link
                  href={`${site.base}/join`}
                  className="font-semibold text-navy-900 underline decoration-blue-500 decoration-2 underline-offset-4"
                >
                  {t("contact.submit")}
                </Link>
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-lg text-navy-700">
            {t("me.signedInAs")}{" "}
            <strong className="font-semibold text-navy-900">{viewer.name ?? viewer.email}</strong>
          </p>
        )}

        {viewer.email && (
          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-navy-900">{t("me.canRead")}</h2>
            {viewer.trips.length === 0 ? (
              <p className="mt-2 text-lg leading-8 text-navy-700">{t("me.nothing")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-navy-200 overflow-hidden rounded-2xl border border-navy-200 bg-white">
                {viewer.trips.map((trip) => (
                  <li key={trip.id}>
                    <Link
                      href={trip.href}
                      className="flex min-h-14 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-cream-50"
                    >
                      <span className="font-display text-lg font-semibold text-navy-900">
                        {trip.title}
                      </span>
                      <span className="text-sm text-navy-600">{t(reason[trip.through])}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {manageHref && (
          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold text-navy-900">{t("me.details")}</h2>
            <p className="mt-2 text-lg leading-8 text-navy-700">{t("me.detailsBody")}</p>
            <Link
              href={manageHref}
              className="mt-3 inline-flex min-h-11 items-center rounded-full border border-navy-700 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-100"
            >
              {t("me.editDetails")}
            </Link>
          </section>
        )}

        {viewer.owner && (
          <section className="mt-8 rounded-2xl border border-navy-200 bg-cream-100 p-5 sm:p-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("me.ownerTitle")}
            </h2>
            <h3 className="mt-4 font-display text-base font-semibold text-navy-900">
              {t("me.agentTitle")}
            </h3>
            <p className="mt-1 text-base leading-7 text-navy-700">{t("me.agentBody")}</p>
            <p className="mt-3 font-mono text-sm text-navy-900">{docUrl}</p>
            <p className="font-mono text-sm text-navy-600">{viewer.email}</p>
            <div className="mt-3">
              <CopyLine
                value={`${docUrl}\n${viewer.email}`}
                label={t("landing.copy")}
                copiedLabel={t("landing.copied")}
              />
            </div>
            {/*
              What the code actually becomes.
              
              The panel handed over an address and an email and stopped there,
              so the one thing a person needs to judge before reading a code
              aloud — what the other end can then do, and for how long — was
              written down nowhere they would look. The last line is decision
              24 in a sentence: reading the site on your phone must not put a
              credential that can rewrite it in your pocket, and the two are
              not interchangeable.
            */}
            <h3 className="mt-6 font-display text-base font-semibold text-navy-900">
              {t("me.tokenTitle")}
            </h3>
            <p className="mt-1 text-base leading-7 text-navy-700">{t("me.tokenBody")}</p>
            <p className="mt-2 border-l-2 border-coral-600 pl-3 text-base leading-7 text-navy-900">
              {t("me.tokenWarning")}
            </p>

            <Link
              href={`${site.base}/contacts`}
              className="mt-5 inline-flex min-h-11 items-center text-base font-semibold text-navy-900 underline decoration-blue-500 decoration-2 underline-offset-4"
            >
              {t("me.contacts")}
            </Link>
          </section>
        )}

        {/*
          Last on the page, and only when there is a session to end.

          `viewer.email` is set from the guest cookie and from nothing else, so
          it is exactly the right condition: an owner reading their own journal
          without a session, or a guest following a link token, has nothing to
          sign out of and is not offered a control that would do nothing.
        */}
        {viewer.email && <SignOut />}
      </main>
    </div>
  );
}
