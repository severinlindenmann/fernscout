"use client";

import { useEffect, useState } from "react";
import { CreditCard, HardDrive } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { useNativeShell } from "@/components/nativeShell";
import { useSite } from "@/components/SiteProvider";
import type { PlanSummary } from "@/lib/billingSummary";
import OrderListItem from "@paid/printOrder/components/OrderListItem";
import type { OrderRow } from "@paid/printOrder/lib/orders";

/** `CHF 49`. `PLANS` itself (`@paid/billing/lib/plans`) carries other,
 *  server-only imports behind it (`translateIn` -> `lib/locales.ts` ->
 *  `lib/users.ts` -> `better-sqlite3`) that break this client component's
 *  bundle the moment anything here imports that module — so the page
 *  (`app/at/[user]/studio/account/page.tsx`, a server component) reads
 *  `PLANS` itself and hands down only the plain numbers in `planOptions`.
 *  `chf()` is the one line worth keeping in sync with it rather than
 *  re-triggering that import for a one-liner. */
function chf(amount: number): string {
  return `CHF ${amount}`;
}

/**
 * Storage and plan, on their own page — B821, B2593.
 *
 * Moved whole from `/[user]/me`, which held them among the contact form, the
 * journal's own title, the device list and the access panel. B821 left a
 * card on `/me` pointing here; B876 removed it — the menu entry is the way
 * in, and a card whose only content is "this lives elsewhere" is a whole
 * card to say so. The credit balance this page also once showed was deleted
 * whole in B2592 — plans replaced it, and `plan` is this page's own answer
 * to "what am I paying for" now.
 *
 * Owner-only — `app/at/[user]/studio/account/page.tsx` (`requireStudioOwner`,
 * B2016) 404s for anybody else, the same gate `/me` uses. This file kept its
 * address under `app/at/[user]/account/` rather than moving with the route: the
 * component is the same one either way, and `app/at/[user]/account/page.tsx` is
 * now only a redirect to the studio address.
 */

/**
 * One channel's mute switch — B463.
 *
 * The two capabilities that spend the balance this card is about, next to the
 * balance, for the person already signed in as the owner of it. Not a settings
 * page and deliberately not the shape of one: two named channels, and the
 * route behind it (`PATCH /api/web/<user>/channels`, the cookie proxy in
 * front of `PATCH /api/v2/<user>/channels`) accepts no other key.
 *
 * `router.refresh()` rather than local state, because the numbers beside it —
 * what a day costs now — are the server's and are exactly what changed.
 * Optimism here would show a total that the next navigation contradicts.
 */
/**
 * Give the space back — B664, asked in the page since B668.
 *
 * The confirmation **names what goes and what stays** before anything is
 * deleted, because the person pressing this has usually just been told their
 * journal is full and is in no mood to read carefully.
 *
 * The staged documents used to be a second `confirm()` stacked on the first,
 * which read as a stutter rather than as two questions. They are a checkbox
 * inside the one panel now, unticked: they are somebody's uploads rather than
 * generated output, so they are never swept along with the PDFs unless
 * somebody says so — see `lib/storageCleanup.ts`.
 */
function CleanupButton({
  username,
  reclaimable,
}: {
  username: string;
  reclaimable: StoragePanel["reclaimable"];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function clean() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(
      `/api/web/${username}/storage/cleanup${staged ? "?staged=1" : ""}`,
      { method: "POST" },
    ).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      setAsking(false);
      router.refresh();
    } else setFailed(true);
  }

  if (asking) {
    return (
      <ConfirmPanel
        label={t("me.storageCleanup", { size: reclaimable.human })}
        question={t("me.storageCleanupConfirm", { size: reclaimable.human })}
        confirmLabel={t("me.storageCleanupGo")}
        tone="destructive"
        busyLabel={t("me.storageCleanupBusy")}
        busy={busy}
        error={failed ? t("me.storageCleanupFailed") : undefined}
        onConfirm={clean}
        onCancel={() => setAsking(false)}
      >
        {reclaimable.hasStagedFiles && (
          <label className="mt-3 flex items-start gap-2 text-sm leading-6 text-ink-body">
            <input
              type="checkbox"
              checked={staged}
              onChange={(event) => setStaged(event.target.checked)}
              className="mt-1.5 h-4 w-4 shrink-0 accent-navy-900"
            />
            <span>{t("me.storageCleanupStaged")}</span>
          </label>
        )}
      </ConfirmPanel>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setAsking(true);
        }}
        className="inline-flex min-h-11 items-center rounded-full border border-line-prominent px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-base"
      >
        {t("me.storageCleanup", { size: reclaimable.human })}
      </button>
      {failed && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("me.storageCleanupFailed")}
        </span>
      )}
    </>
  );
}

/**
 * Which of these is the big one — B664.
 *
 * One stacked bar and a legend, rather than a table: the question an owner
 * actually has is comparative, and a column of numbers answers it slowest.
 * Colours are the brand's, in a fixed order so the same trip keeps the same
 * colour between renders; the legend carries the size in words, so the chart
 * is decoration and nothing is only available by looking at a colour.
 */
const BAR_COLOURS = [
  "bg-action-strong",
  "bg-yellow-400",
  "bg-sky-400",
  "bg-coral-400",
  "bg-green-500",
  "bg-ink-muted",
  "bg-yellow-600",
  "bg-sky-500",
];

/**
 * How many legend rows a journal with a lot of trips gets before it has to ask
 * — B1766. The bar keeps every segment whatever this is: the shares are what
 * make it a whole, and a bar that only adds up to 70% is a lie.
 */
const STORAGE_ROWS_SHOWN = 10;

function StorageBar({ rows }: { rows: StoragePanel["rows"] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, STORAGE_ROWS_SHOWN);
  return (
    <>
      <div
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-selected"
        aria-hidden="true"
      >
        {rows.map((row, at) => (
          <span
            key={row.key}
            className={BAR_COLOURS[at % BAR_COLOURS.length]}
            style={{ width: `${row.share}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {shown.map((row, at) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-3 text-base"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${BAR_COLOURS[at % BAR_COLOURS.length]}`}
                aria-hidden="true"
              />
              <span className="truncate text-ink-body">{row.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink-strong">
              {row.human}
            </span>
          </li>
        ))}
      </ul>
      {!expanded && rows.length > STORAGE_ROWS_SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 min-h-11 px-2 text-sm text-ink-secondary underline underline-offset-4 transition-colors hover:text-ink-strong"
        >
          {t("common.showMore")}
        </button>
      )}
    </>
  );
}

/**
 * How full this journal is, and what is filling it — B661, B664.
 *
 * `limit` is null where the instance sets no ceiling, and then there is
 * nothing to be near the end of — the whole page section is absent then,
 * same as before B821.
 */
export type StoragePanel = {
  used: string;
  limit: string | null;
  percent: number | null;
  /** How far over the limit, formatted from bytes — set only once `percent`
   *  has actually passed 100, never guessed from the rounded percent.
   *  B2636. */
  excess: string | null;
  rows: { key: string; label: string; human: string; share: number }[];
  reclaimable: { human: string; files: number; hasStagedFiles: boolean };
};

/**
 * "Your plan" — B2593, reworked to the approved board (`Account.dc.html`)
 * by B2622: plan name and status, the renew/end sentence, meters for AI
 * days, storage and included postcards, the photobook discount, the
 * storage add-on, the portal (payment method and receipts), and — only for
 * a live Stripe subscription — a cancel link with what it means. Absent
 * (like `storage`) rather than shown empty when `billing` is off — an
 * "unlimited, forever" card on every instance that has not turned plans on
 * would be noise, not news. The shape is `PlanSummary`'s own
 * (`lib/billingSummary.ts`), which `/me`'s compact plan card (B2622) reads
 * the same way.
 */
export type PlanPanel = PlanSummary;

/**
 * Apple's own localized price for one plan, plus the period/renewal note
 * App Store guideline 3.1.2 requires before a subscription purchase —
 * B2658. `displayPrice` comes from StoreKit (`loadProducts`), already
 * localized to the storefront; the period and renewal/non-renewal wording
 * is this app's own plan rule (`docs/billing.md`), not something StoreKit
 * reports, so it is translated copy rather than derived from the product.
 * Renders nothing until the product has loaded — the Buy button still
 * works without it, same "absent, not broken" shape as everything else
 * here.
 */
function ApplePlanPrice({ plan }: { plan: "pass" | "plus" }) {
  const { t } = useI18n();
  const [price, setPrice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { loadAppleProducts, APPLE_PRODUCT_IDS } = await import("@/components/nativeShell");
        const products = await loadAppleProducts([APPLE_PRODUCT_IDS[plan]]);
        if (live) setPrice(products[0]?.displayPrice ?? null);
      } catch {
        // No price to show yet; the button still works without it.
      }
    })();
    return () => {
      live = false;
    };
  }, [plan]);

  if (!price) return null;
  return (
    <p className="mt-1 max-w-xs text-sm text-ink-secondary">
      {t(plan === "plus" ? "billing.applePriceYearly" : "billing.applePriceOnce", { price })}
      {" — "}
      {t(plan === "plus" ? "billing.appleRenewsNote" : "billing.applePassNote")}
    </p>
  );
}

/** "Terms" and "Privacy", App Store guideline 3.1.2's other requirement
 *  before a subscription purchase — both point at the one legal page this
 *  instance has (`/legal`, `lib/legal.ts`); there is no separate terms
 *  document to link instead. Shown only in the shell, next to Restore —
 *  B2658. */
function AppleLegalLinks() {
  const { t } = useI18n();
  return (
    <p className="mt-3 flex gap-4 text-sm">
      <Link href="/legal" className="font-semibold text-ink-body underline decoration-line-strong underline-offset-2 hover:text-ink-strong">
        {t("billing.terms")}
      </Link>
      <Link href="/legal#privacy" className="font-semibold text-ink-body underline decoration-line-strong underline-offset-2 hover:text-ink-strong">
        {t("billing.privacy")}
      </Link>
    </p>
  );
}

/**
 * The plain numbers behind the two buy tiles — B2638. Read from `PLANS`
 * (`@paid/billing/lib/plans`) by the page (a server component), never by
 * this file: see `chf()`'s own comment for why that import cannot cross
 * into a client bundle. Present exactly when `plan` is, same as `plan`
 * itself.
 */
export type PlanOptionFacts = {
  plus: { priceChf: number; aiDays: number; storageGb: number; includedPostcards: number };
  pass: { priceChf: number; days: number; aiDays: number; storageGb: number; includedPostcards: number };
};

/** Buy a plan, or ask the operator to grant it when no Stripe key is
 *  configured (`dryRun`) — the same "ask, don't act" shape every panel on
 *  this page takes.
 *
 *  Inside the iPhone shell this buys through StoreKit instead — Apple
 *  3.1.3(b) forbids pointing an in-app button at a web checkout — B2598. */
function BuyPlanButton({
  username,
  plan,
  label,
}: {
  username: string;
  plan: "pass" | "plus";
  label: string;
}) {
  const { t } = useI18n();
  const native = useNativeShell();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "failed" | "unavailable" | "unconfirmed" | "pending" | "sent">("idle");

  async function buy() {
    setBusy(true);
    setState("idle");

    if (native) {
      const { buyApplePlan } = await import("@/components/nativeShell");
      const result = await buyApplePlan(username, plan).catch(() => ({ ok: false as const, reason: "failed" as const }));
      setBusy(false);
      if (!result.ok) {
        // "unavailable" (the product never resolved from the store) gets its
        // own plain message rather than the generic retry one — B2670.
        if (result.reason === "unavailable") setState("unavailable");
        else if (result.reason === "unconfirmed") setState("unconfirmed");
        else if (result.reason === "pending") setState("pending");
        else if (result.reason !== "cancelled") setState("failed");
        return;
      }
      window.location.reload();
      return;
    }

    const response = await fetch(`/api/web/${username}/billing/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setState("failed");
      return;
    }
    if (body?.url) {
      window.location.href = body.url as string;
      return;
    }
    // Dry run: no Stripe key, the operator was mailed — B2593.
    setState("sent");
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={buy}
        className="inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action transition-colors hover:bg-action-strong-hover disabled:opacity-50"
      >
        {label}
      </button>
      {native && <ApplePlanPrice plan={plan} />}
      {state === "failed" && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("billing.checkoutFailed")}
        </span>
      )}
      {state === "unavailable" && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("billing.purchaseUnavailable")}
        </span>
      )}
      {state === "unconfirmed" && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("billing.purchaseUnconfirmed")}
        </span>
      )}
      {state === "pending" && (
        <span role="status" className="mt-1 block text-sm text-ink-secondary">
          {t("billing.purchasePending")}
        </span>
      )}
      {state === "sent" && (
        <span role="status" className="mt-1 block text-sm text-ink-secondary">
          {t("billing.dryRunSent")}
        </span>
      )}
    </div>
  );
}

/**
 * One plan to buy, as a tile rather than a bare button — B2638's board. Price
 * and facts are the caller's own (read straight from `PLANS`, real or its
 * public stub), so this draws nothing and decides nothing about what a plan
 * costs; it only lays it out, with the buy button inside rather than below
 * the pair.
 */
function PlanOptionTile({
  username,
  plan,
  name,
  tag,
  price,
  cadence,
  facts,
  buyLabel,
}: {
  username: string;
  plan: "pass" | "plus";
  name: string;
  tag?: string;
  price: string;
  cadence: string;
  facts: string[];
  buyLabel: string;
}) {
  // The shell sells through Apple, so the tile shows only Apple's own
  // localized price (App Store guideline 3.1.1/3.1.2) — never this web
  // price/cadence header, which would otherwise sit above Apple's own price
  // inside `BuyPlanButton` and read as two different charges — B2670. The
  // Apple price itself is `ApplePlanPrice`, rendered below the Buy button
  // only once it has actually loaded; there is deliberately no price here
  // while it is still loading rather than showing this web one.
  const native = useNativeShell();
  return (
    <div className="flex-1 rounded-xl border border-line-quiet bg-surface-base p-4">
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-lg font-semibold text-ink-strong">{name}</span>
        {tag && (
          <span className="inline-flex rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-bold text-ink-strong">
            {tag}
          </span>
        )}
      </p>
      {!native && (
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="font-display text-xl font-semibold text-ink-strong">{price}</span>
          <span className="text-sm text-ink-secondary">{cadence}</span>
        </p>
      )}
      <ul className="mt-2 space-y-1 text-sm text-ink-body">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <div className="mt-3">
        <BuyPlanButton username={username} plan={plan} label={buyLabel} />
      </div>
    </div>
  );
}

/** An Apple-sourced plan is managed in the App Store, not here — B2598.
 *  `itms-apps://apps.apple.com/account/subscriptions` opens Apple's own
 *  subscription settings; outside the shell it still works (Safari hands it
 *  to the App Store app), so no `useNativeShell` gate is needed here. */
function ManagedByApple() {
  const { t } = useI18n();
  return (
    <a
      href="itms-apps://apps.apple.com/account/subscriptions"
      className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-base"
    >
      {t("billing.managedByApple")}
    </a>
  );
}

/** The Customer Portal — payment method and receipts (B2622's board gives
 *  this its own button; cancelling is `CancelPlanButton`'s, a portal
 *  session of its own below). */
function ManageSubscriptionButton({ username }: { username: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/web/${username}/billing/portal`, { method: "POST" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok || !body?.url) {
      setFailed(true);
      return;
    }
    window.location.href = body.url as string;
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={open}
        className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-base disabled:opacity-50"
      >
        {t("billing.manage")}
      </button>
      {failed && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("billing.checkoutFailed")}
        </span>
      )}
    </div>
  );
}

/** "Cancel Plus" — B2622. A second portal session, this one opened straight
 *  into Stripe's own cancel flow (`cancel: true` on the same route, which
 *  asks the portal for `flow_data.type: "subscription_cancel"`) rather than
 *  the general dashboard `ManageSubscriptionButton` opens: a link that says
 *  "cancel" takes the owner directly to cancelling, not to a menu they have
 *  to find it in. Only ever shown for a live Stripe subscription — an Apple
 *  plan cancels in the App Store (`ManagedByApple`), and a pass or an admin
 *  grant has no subscription to cancel at all. */
function CancelPlanButton({ username, label }: { username: string; label: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/web/${username}/billing/portal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cancel: true }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok || !body?.url) {
      setFailed(true);
      return;
    }
    window.location.href = body.url as string;
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={open}
        className="min-h-11 text-base font-semibold text-ink-body underline decoration-line-strong underline-offset-2 hover:text-ink-strong disabled:opacity-50"
      >
        {label}
      </button>
      {failed && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("billing.checkoutFailed")}
        </span>
      )}
    </div>
  );
}

/** "Add 10 GB" — Plus only, B2622's board; a real Stripe checkout since
 *  B2629 (`docs/billing.md`'s +10 GB/year). Same shape as `BuyPlanButton`
 *  above: a URL back redirects to Stripe, no URL (no Stripe key configured)
 *  means the operator was mailed instead, exactly as every other checkout
 *  button here falls back. */
function StorageAddonButton({ username, label }: { username: string; label: string }) {
  const { t } = useI18n();
  const native = useNativeShell();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "failed" | "sent">("idle");

  async function ask() {
    setBusy(true);
    setState("idle");
    const response = await fetch(`/api/web/${username}/billing/storage-addon`, { method: "POST" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setState("failed");
      return;
    }
    if (body?.url) {
      window.location.href = body.url as string;
      return;
    }
    // Dry run: no Stripe key, the operator was mailed — same as BuyPlanButton.
    setState("sent");
  }

  // B2682: inside the iPhone shell a priced digital extra may only be sold
  // through Apple (App Store guideline 3.1.1); there is no Apple product for
  // storage, so the offer is absent there, the same as the web plan prices.
  if (native) return null;

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={ask}
        className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-base disabled:opacity-50"
      >
        {label}
      </button>
      {state === "sent" && (
        <span role="status" className="mt-1 block text-sm text-ink-secondary">
          {t("billing.dryRunSent")}
        </span>
      )}
      {state === "failed" && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("billing.checkoutFailed")}
        </span>
      )}
    </div>
  );
}

/** One meter row — a label, a figure, and a bar when there is a share to
 *  draw. Used for AI days and for storage, the same shape `StorageBar`
 *  already draws for the breakdown below, kept small here since this is a
 *  summary, not the breakdown itself. */
function MeterRow({ label, value, percent }: { label: string; value: string; percent?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold text-ink-strong">{label}</span>
        <span className="text-ink-body">{value}</span>
      </div>
      {percent !== undefined && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-selected">
          <div
            className="h-2 rounded-full bg-ink-strong"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function YourPlanPanel({
  username,
  plan,
  storage,
  planOptions,
}: {
  username: string;
  plan: PlanPanel;
  /** Shares the one ceiling `storage` already reads below, for the meter —
   *  absent where the instance sets no ceiling, same as `storage` itself. */
  storage?: StoragePanel;
  planOptions: PlanOptionFacts;
}) {
  const { t, tn } = useI18n();
  const native = useNativeShell();
  const planTag = t(`plans.${plan.plan}` as "plans.free");
  const dateStr = plan.periodEnd ? plan.periodEnd.slice(0, 10) : null;

  return (
    <div className="rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/50 text-ink-strong">
          <CreditCard className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <h3 className="font-display text-lg font-semibold text-ink-strong">{t("billing.title")}</h3>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-display text-2xl font-semibold text-ink-strong">{planTag}</span>
        {dateStr && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
              plan.renews ? "bg-green-100 text-green-700" : "bg-surface-selected text-ink-body"
            }`}
          >
            {t(plan.renews ? "billing.statusActive" : "billing.statusEnding")}
          </span>
        )}
      </div>
      {dateStr && (
        <p className="mt-1 text-sm text-ink-secondary">
          {t(plan.renews ? "billing.renews" : "billing.ends", { date: dateStr })}
        </p>
      )}

      <div className="mt-4 space-y-4">
        <MeterRow
          label={t("billing.aiDaysMeterLabel")}
          value={
            plan.aiDays.unlimited
              ? t("billing.aiDaysUnlimited")
              : t("billing.aiDaysUsedOf", { used: String(plan.aiDays.used), allowed: String(plan.aiDays.allowed) })
          }
          percent={plan.aiDays.unlimited ? undefined : (plan.aiDays.used / Math.max(1, plan.aiDays.allowed)) * 100}
        />
        {storage && (
          <MeterRow
            label={t("me.storageTitle")}
            value={t("billing.storageMeterValue", { used: storage.used, limit: storage.limit ?? "" })}
            percent={storage.percent ?? undefined}
          />
        )}
        {plan.postcards && (
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold text-ink-strong">{t("billing.postcardsLabel")}</span>
            <span className="text-ink-body">
              {t("billing.postcardsLeft", {
                left: String(Math.max(0, plan.postcards.allowed - plan.postcards.used)),
                allowed: String(plan.postcards.allowed),
              })}
            </span>
          </div>
        )}
        {plan.bookDiscountRappen > 0 && (
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold text-ink-strong">{t("billing.photobooksLabel")}</span>
            <span className="text-ink-body">
              {t("billing.photobookDiscount", { amount: `CHF ${(plan.bookDiscountRappen / 100).toFixed(2)}` })}
            </span>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {plan.plan === "plus" && <StorageAddonButton username={username} label={t("billing.addStorage")} />}
        {plan.hasStripeSubscription && <ManageSubscriptionButton username={username} />}
        {plan.source === "apple" && <ManagedByApple />}
      </div>

      {/* The two plans still open to buy, as tiles rather than bare buttons
          — B2638's board: name, price, cadence, three facts and the buy
          button inside each, Plus first. */}
      {plan.plan !== "plus" && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <PlanOptionTile
            username={username}
            plan="plus"
            name={t("plans.plus")}
            tag={t("billing.tilePlusTag")}
            price={chf(planOptions.plus.priceChf)}
            cadence={t("billing.tilePlusCadence")}
            facts={[
              t("billing.tileAiDaysYear", { days: String(planOptions.plus.aiDays) }),
              `${planOptions.plus.storageGb} GB`,
              tn("billing.tilePostcards", planOptions.plus.includedPostcards, {
                count: String(planOptions.plus.includedPostcards),
              }),
            ]}
            buyLabel={t("billing.buyPlus")}
          />
          {plan.plan === "free" && (
            <PlanOptionTile
              username={username}
              plan="pass"
              name={t("plans.pass")}
              price={chf(planOptions.pass.priceChf)}
              cadence={t("billing.tilePassCadence", { days: String(planOptions.pass.days) })}
              facts={[
                t("billing.tileAiDaysWindow", {
                  days: String(planOptions.pass.aiDays),
                  window: String(planOptions.pass.days),
                }),
                `${planOptions.pass.storageGb} GB`,
                tn("billing.tilePostcards", planOptions.pass.includedPostcards, {
                  count: String(planOptions.pass.includedPostcards),
                }),
              ]}
              buyLabel={t("billing.buyPass")}
            />
          )}
        </div>
      )}

      {plan.hasStripeSubscription && plan.renews && (
        <div className="mt-4">
          <CancelPlanButton username={username} label={t("billing.cancel", { plan: planTag })} />
        </div>
      )}

      {dateStr && (
        <p className="mt-3 text-sm leading-6 text-ink-secondary">
          {t(plan.renews ? "billing.cancelExplain" : "billing.endsExplain", { plan: planTag, date: dateStr })}
        </p>
      )}

      {native && (
        <>
          <RestoreApplePurchasesButton username={username} />
          <AppleLegalLinks />
        </>
      )}
    </div>
  );
}

/** "Restore purchases" — App Store guideline 3.1.2: a purchase made on
 *  another device (or after a reinstall) must be recoverable without a new
 *  charge. Shown only in the shell, since it is meaningless on the web —
 *  B2598. Says how many purchases it actually found (B2658 — it used to say
 *  "Done." even for zero) and refreshes the panel's own server data so a
 *  restored plan shows up without a full reload. */
function RestoreApplePurchasesButton({ username }: { username: string }) {
  const { t, tn } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const [restored, setRestored] = useState(0);

  async function restore() {
    setBusy(true);
    setState("idle");
    try {
      const { restoreApplePurchases } = await import("@/components/nativeShell");
      const granted = await restoreApplePurchases(username);
      setRestored(granted);
      setState("done");
      router.refresh();
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="mt-3 text-sm">
      <button type="button" disabled={busy} onClick={restore} className="font-semibold text-ink-body underline decoration-line-strong underline-offset-2 hover:text-ink-strong disabled:opacity-50">
        {t("billing.restorePurchases")}
      </button>
      {state === "done" && (
        <span className="ml-2 text-ink-secondary">
          {restored > 0 ? tn("billing.restoreCount", restored, { count: String(restored) }) : t("billing.restoreNone")}
        </span>
      )}
      {state === "failed" && <span className="ml-2 text-coral-600">{t("billing.checkoutFailed")}</span>}
    </p>
  );
}

export default function AccountPageContent({
  username,
  storage,
  orders,
  plan,
  planOptions,
}: {
  username: string;
  /** Absent only where the instance sets no ceiling. */
  storage?: StoragePanel;
  /** The 3 most recent orders and the total count — B1452. */
  orders: { recent: OrderRow[]; total: number };
  /** Absent when `billing` is off. */
  plan?: PlanPanel;
  /** Present exactly when `plan` is — B2638's tiles. */
  planOptions?: PlanOptionFacts;
}) {
  const { t } = useI18n();
  const site = useSite();

  return (
    <>

        <div className="mt-6 space-y-4">
          {/* Your plan, first — B2622's board. What an owner pays for and
              what it buys them, ahead of everything else on this page. */}
          {plan && planOptions && (
            <YourPlanPanel username={username} plan={plan} storage={storage} planOptions={planOptions} />
          )}

          {orders.recent.length > 0 && (
            // B1452. Next — what an owner asks most often right after a
            // purchase is "did it go through".
            <div className="rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-semibold text-ink-strong">
                  {t("orders.title")}
                </h3>
                {/* B2135 — every order, on its own studio page. */}
                {orders.total > 0 && (
                  <Link
                    href={`${site.base}/studio/orders`}
                    className="text-sm font-semibold text-ink-body transition-colors hover:text-ink-strong"
                  >
                    {t("orders.viewAll")}
                  </Link>
                )}
              </div>
              <ul className="mt-2 -mx-5 divide-y divide-line-quiet border-t border-line-quiet sm:-mx-6">
                {orders.recent.map((order) => (
                  <OrderListItem key={`${order.kind}-${order.id}`} order={order} />
                ))}
              </ul>
            </div>
          )}

          {storage && (
            <div className="rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/50 text-ink-strong">
                  <HardDrive className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <h3 className="font-display text-lg font-semibold text-ink-strong">
                  {t("me.storageTitle")}
                </h3>
              </div>

              <p className="mt-4 text-base text-ink-strong">
                {t("me.storageUsed", {
                  used: storage.used,
                  limit: storage.limit ?? "",
                })}
              </p>
              {/* Three states — B2636: a journal at 4.0 of 2.0 GB used to
                  read "nearly full" like one at 1.9 of 2.0, though uploads
                  are already refused (`withStorageQuota`/`storageRefusal` in
                  `lib/storageQuota.ts` refuse any write that would take
                  `usedBytes` past `limitBytes`). "Voll" only fires once that
                  is actually true, with the real excess from bytes; "Fast
                  voll" stays a forward-looking warning for 90–99%, where
                  nothing is refused yet. */}
              {storage.percent !== null && storage.percent >= 100 && (
                <>
                  <p className="mt-1 text-sm leading-6 text-coral-600">
                    {t("me.storageFull", { excess: storage.excess ?? "" })}
                  </p>
                  {plan && plan.plan !== "plus" && (
                    <div className="mt-2">
                      <BuyPlanButton username={username} plan="plus" label={t("billing.buyPlus")} />
                    </div>
                  )}
                </>
              )}
              {storage.percent !== null && storage.percent >= 90 && storage.percent < 100 && (
                <p className="mt-1 text-sm leading-6 text-amber-700">
                  {t("me.storageNearlyFull")}
                </p>
              )}

              {storage.rows.length > 0 && <StorageBar rows={storage.rows} />}

              {storage.reclaimable.files > 0 && (
                <div className="mt-5 border-t border-line-quiet pt-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <CleanupButton
                      username={username}
                      reclaimable={storage.reclaimable}
                    />
                  </div>
                  {storage.reclaimable.files > 0 && (
                    <p className="mt-2 text-sm leading-6 text-ink-secondary">
                      {t("me.storageCleanupBody")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!storage && !plan && (
            // Neither figure has anything behind it — no ceiling configured
            // and billing switched off. Rare (an instance normally sets one
            // or the other), but a page with two absent cards and no
            // explanation reads as broken rather than as "nothing to show".
            <p className="rounded-2xl border border-line-quiet bg-surface-raised p-5 text-base leading-7 text-ink-body sm:p-6">
              {t("me.accountCardBody")}
            </p>
          )}
        </div>
    </>
  );
}
