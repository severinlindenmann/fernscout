"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import IdentitySignIn from "@/components/IdentitySignIn";
import SignOut from "@/components/SignOut";
import { TITLE_H1 } from "@/components/landing/kit";
import {
  RoleBadge,
  YourDevices,
  isMine,
  type MineJournal,
} from "@/components/HomeJournals";
import { useI18n } from "@/components/LocaleProvider";
import { SEEN_KEY, probeHome, type HomePayload } from "@/lib/homeProbe";
import { stopRouteRecording, useRecordingRoute } from "@/components/nativeShell";
import { tellWorkerSignedOut } from "@/lib/signedOut";

import { journalPath } from "@/lib/journalPath";
type Phase = "loading" | "out" | "in" | "offline";

const LINK =
  "underline decoration-line-quiet underline-offset-4 hover:decoration-blue-500 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

/**
 * One journal this address holds a real role in. The row says which role in
 * the colour the home page already taught (`RoleBadge`), and offers the one
 * next door that role has: the studio for an owner, and that journal's own
 * "what can I see here" page for everybody else.
 */
function RoleRow({ journal }: { journal: MineJournal }) {
  const { t, tn } = useI18n();
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={journal.href}
            className={`font-display text-lg font-semibold break-words text-ink-strong ${LINK}`}
          >
            {journal.title}
          </Link>
          <p className="mt-0.5 font-mono text-xs text-ink-secondary">
            {journalPath(journal.username)} ·{" "}
            {tn("landing.trips", journal.trips.length, { count: String(journal.trips.length) })}
          </p>
        </div>
        <RoleBadge role={journal.role} />
      </div>
      <p className="mt-2 text-sm">
        {journal.role === "owner" ? (
          <Link href={`${journalPath(journal.username)}/studio`} className={`text-ink-body ${LINK}`}>
            {t("meAccount.openStudio")}
          </Link>
        ) : (
          <Link href={`${journalPath(journal.username)}/me`} className={`text-ink-body ${LINK}`}>
            {t("meAccount.inThisJournal")}
          </Link>
        )}
      </p>
    </li>
  );
}

/**
 * A compact plan status card for the journal this address owns — B2622.
 *
 * `/me` is about the person across every journal, not one journal's own
 * detail — the full "Your plan" panel (meters, the portal, cancelling) lives
 * on the studio account page, and this is deliberately smaller than that:
 * plan, renews/ends, AI days left, and a button that leads there. Absent
 * when there is nothing to own, or when `billing` is off (`journal.plan` is
 * then absent too, the same "absent, not shown empty" rule the studio page
 * follows).
 */
export function PlanStatusCard({ journal }: { journal: MineJournal & { plan: NonNullable<MineJournal["plan"]> } }) {
  const { t } = useI18n();
  const plan = journal.plan;
  const planTag = t(`plans.${plan.plan}` as "plans.free");
  const dateStr = plan.periodEnd ? plan.periodEnd.slice(0, 10) : null;

  return (
    <section aria-labelledby="account-plan" className="mt-10 rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
      <h2 id="account-plan" className="font-display text-xl font-semibold text-ink-strong">
        {t("meAccount.planTitle")}
      </h2>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-lg font-semibold text-ink-strong">{planTag}</span>
        {dateStr && (
          <span className="text-sm text-ink-secondary">
            {t(plan.renews ? "billing.renews" : "billing.ends", { date: dateStr })}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-body">
        {plan.aiDays.unlimited
          ? t("billing.aiDaysUnlimited")
          : t("billing.aiDaysLeft", { used: String(plan.aiDays.used), allowed: String(plan.aiDays.allowed) })}
      </p>
      <Link
        href={`${journal.href}/studio/account`}
        className={`mt-3 inline-block text-sm font-semibold text-ink-strong ${LINK}`}
      >
        {t("meAccount.planCta")}
      </Link>
    </section>
  );
}

/**
 * Sign out everywhere — `DELETE /api/v2/me/devices`.
 *
 * Asks first, in a panel rather than a browser dialog, because on the phone
 * pressing it this is the moment every other device, including one in a
 * relative's hands, loses its sign-in. The question says what stays: agent
 * keys are not browser sign-ins and keep working.
 *
 * No optimistic state: the server clears this browser's cookies too, and the
 * reloaded page saying "not signed in" is the confirmation (`SignOut` does the
 * same, for the same reason).
 */
function SignOutEverywhere({ devices }: { devices: number }) {
  const { t, tn } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const recording = useRecordingRoute();

  async function signOutEverywhere() {
    setBusy(true);
    setFailed(false);
    const response = await fetch("/api/v2/me/devices", { method: "DELETE" }).catch(() => null);
    if (response?.ok) {
      tellWorkerSignedOut();
      await stopRouteRecording(); // B-2841 — this phone is one of "everywhere"
      window.location.reload();
      return;
    }
    setBusy(false);
    setFailed(true);
  }

  if (confirming) {
    return (
      <div className="mt-6">
        <ConfirmPanel
          label={t("meAccount.everywhere")}
          question={tn("meAccount.everywhereQuestion", devices, { count: String(devices) })}
          details={
            recording
              ? `${t("meAccount.everywhereDetails")} ${t("me.signOutStopsRecording")}`
              : t("meAccount.everywhereDetails")
          }
          confirmLabel={t("meAccount.everywhereConfirm")}
          busyLabel={t("me.signingOut")}
          tone="destructive"
          busy={busy}
          error={failed ? t("me.signOutFailed") : undefined}
          onConfirm={() => void signOutEverywhere()}
          onCancel={() => {
            setConfirming(false);
            setFailed(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mt-6">
      <p className="text-sm leading-6 text-ink-body">{t("meAccount.everywhereBody")}</p>
      <BusyButton
        busy={busy}
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line-quiet px-5 text-base
                   font-semibold text-ink-strong transition-colors hover:border-line-ink hover:bg-surface-subtle
                   disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        {t("meAccount.everywhere")}
      </BusyButton>
    </div>
  );
}

export default function AccountPage({
  codeMinutes,
}: {
  codeMinutes: string;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [home, setHome] = useState<HomePayload | null>(null);

  useEffect(() => {
    let live = true;
    probeHome(() => live)
      .then((data) => {
        if (!live) return;
        if (!data?.id) {
          window.localStorage.removeItem(SEEN_KEY);
          setPhase("out");
          return;
        }
        window.localStorage.setItem(SEEN_KEY, "1");
        setHome(data);
        setPhase("in");
      })
      .catch(() => {
        // Offline with nothing cached. Not "you are signed out" — that would
        // be a claim about the server this page could not ask.
        if (live) setPhase("offline");
      });
    return () => {
      live = false;
    };
  }, []);

  const mine = home ? home.journals.filter(isMine) : [];
  const owned = mine.find((journal) => journal.role === "owner");

  return (
    // B2531: header B, the footer and the reading width are the page's
    // (`PageShell` and `Band` in app/me/page.tsx).
    <>
        <h1 className={TITLE_H1}>{t("meAccount.title")}</h1>

        {phase === "loading" && (
          <div aria-hidden className="mt-6 animate-pulse space-y-4">
            <div className="h-4 w-1/2 rounded bg-surface-muted" />
            <div className="h-32 rounded-2xl bg-surface-muted" />
            <div className="h-24 rounded-2xl bg-surface-muted" />
          </div>
        )}

        {phase === "offline" && (
          <p role="status" className="mt-4 text-base leading-7 text-ink-body">
            {t("meAccount.offline")}
          </p>
        )}

        {phase === "out" && (
          // The sign-in card says what signing in shows; a sentence above it
          // saying the same thing again was the first thing a check at phone
          // width caught.
          <div className="mt-6">
            <IdentitySignIn codeMinutes={codeMinutes} onDone={() => window.location.reload()} />
          </div>
        )}

        {phase === "in" && home && (
          <>
            <p className="mt-2 font-mono text-xs text-ink-secondary">
              {t("home.signedInAs", { email: home.email })}
            </p>

            <section aria-labelledby="account-roles" className="mt-10">
              <h2 id="account-roles" className="font-display text-xl font-semibold text-ink-strong">
                {t("meAccount.roles")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-body">{t("meAccount.rolesBody")}</p>
              {mine.length === 0 ? (
                <p className="mt-4 text-base leading-6 text-ink-body">{t("home.none")}</p>
              ) : (
                <ul className="mt-4 divide-y divide-line-quiet overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
                  {mine.map((journal) => (
                    <RoleRow key={journal.username} journal={journal} />
                  ))}
                </ul>
              )}
              {home.admin && (
                <p className="mt-4 text-sm leading-6 text-ink-body">
                  {t("meAccount.operatorBody")}{" "}
                  <Link href="/admin" className={`font-semibold text-ink-strong ${LINK}`}>
                    {t("home.operator")}
                  </Link>
                </p>
              )}
            </section>

            {owned?.plan && <PlanStatusCard journal={{ ...owned, plan: owned.plan }} />}

            <YourDevices
              devices={home.devices}
              onRevoke={(id) =>
                setHome((prev) =>
                  prev ? { ...prev, devices: prev.devices.filter((d) => d.id !== id) } : prev,
                )
              }
            />

            <SignOut owner={owned?.username} />
            <SignOutEverywhere devices={home.devices.length} />
          </>
        )}
    </>
  );
}
