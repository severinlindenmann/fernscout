"use client";

import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { Check, HardDrive, Mail, MessageCircle, Undo2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { useNativeShell } from "@/components/nativeShell";
import { useSite } from "@/components/SiteProvider";
import OrderListItem from "@paid/printOrder/components/OrderListItem";
import { formatChf } from "@/lib/creditsFormat";
import { CREDIT_STEP, EXTRA_STORAGE_CREDITS, MAX_CREDITS, MIN_CREDITS, discountFor, discountLabel, priceRappen } from "@paid/credits/lib/credits/pricing";
import type { TranslationKey } from "@/lib/i18n";
import type { OrderRow } from "@paid/printOrder/lib/orders";

/**
 * Credits and storage, on their own page — B821.
 *
 * Moved whole from `/[user]/me`, which held them among the contact form, the
 * journal's own title, the device list and the access panel. They are the
 * two questions an owner asks most often and most urgently — how much can I
 * still spend, how much room is left — and the only two on that page that
 * answer with a number rather than a form. B821 left a card on `/me` pointing
 * here; B876 removed it — the menu entry is the way in, and a card whose only
 * content is "this lives elsewhere" is a whole card to say so. The figures
 * live here and nowhere else, because two live copies of a balance is how
 * they disagree.
 *
 * Owner-only — `app/[user]/studio/account/page.tsx` (`requireStudioOwner`,
 * B2016) 404s for anybody else, the same gate `/me` uses. This file kept its
 * address under `app/[user]/account/` rather than moving with the route: the
 * component is the same one either way, and `app/[user]/account/page.tsx` is
 * now only a redirect to the studio address. `payment` is absent (not zero)
 * when credits are switched off; the page is then storage alone rather than
 * a broken half, exactly the
 * B74 rule the rest of `/me` already followed for these two panels.
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
function ChannelSwitch({
  username,
  channel,
  label,
  enabled,
}: {
  username: string;
  channel: "mail" | "whatsapp";
  label: string;
  enabled: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/web/${username}/channels`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [channel]: !enabled }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      {/* The word beside it is gone — B471. `role="switch"` with `aria-checked`
          announces on or off to a screen reader, and the control says it to
          everybody else; repeating it in text cost the width that made the
          switch wrap under the channel's name on a phone. The failure line
          stays, because that one is not visible in the control. */}
      {failed && (
        <span className="text-sm text-coral-600">
          {t("me.paymentChannelFailed")}
        </span>
      )}
      {/* Not a `BusyButton` — B867 deliberately stops here. This is a 24px
          switch, and there is nowhere in it for a spinner to go that is not on
          top of the thing it is reporting about. `disabled` still stops the
          second press, which is the half that matters. */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={busy}
        onClick={toggle}
        // Off is `navy-500` rather than the `navy-200` the card's rules use:
        // a border at 1.3:1 on white is a rule, not a control, and this one
        // has to look pressable while it is off. `navy-500` is the palette's
        // border-and-label ink (5.51:1 on white) — see apply-the-brand.
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
          enabled ? "border-action-strong bg-action-strong" : "border-line-prominent bg-surface-raised"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] ${
            enabled ? "left-[22px] bg-surface-raised" : "left-0.5 bg-line-prominent"
          }`}
          aria-hidden="true"
        />
      </button>
    </span>
  );
}

/**
 * Five more gigabytes, for fifty credits — B661.
 *
 * A button rather than the tiers dialog above it, because there is one thing
 * to buy and one price. It spends immediately: `PUT
 * /api/web/<user>/storage/purchases/<id>` takes the credits and the
 * extension exists from that moment, so the confirmation is the browser's
 * own — there is no second page to go to and nothing to come back and
 * finish. `router.refresh()` is what redraws the figure above it from the
 * server. The id is generated here, client-side, and only ever used once —
 * it exists so a retried request cannot double-spend, not because the
 * browser needs to remember it afterwards.
 */
function BuyStorageButton({ username }: { username: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function buy() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(
      `/api/web/${username}/storage/purchases/${crypto.randomUUID()}`,
      { method: "PUT" },
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
        label={t("me.storageBuy", { credits: String(EXTRA_STORAGE_CREDITS) })}
        question={t("me.storageBuyConfirm", {
          credits: String(EXTRA_STORAGE_CREDITS),
        })}
        confirmLabel={t("me.storageBuyGo")}
        busyLabel={t("me.storageBuyBusy")}
        busy={busy}
        error={failed ? t("me.storageBuyFailed") : undefined}
        onConfirm={buy}
        onCancel={() => setAsking(false)}
      />
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
        className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-base"
      >
        {t("me.storageBuy", { credits: String(EXTRA_STORAGE_CREDITS) })}
      </button>
      {failed && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("me.storageBuyFailed")}
        </span>
      )}
    </>
  );
}

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
 * Choose an amount and start a purchase — B854.
 *
 * It was two fixed buttons, and every amount that was not one of them was
 * unbuyable. Now it is a slider over `MIN_CREDITS`..`MAX_CREDITS`, and the
 * price under it moves as the thumb does.
 *
 * **`<input type="range">`, not a slider component.** It is keyboard operable
 * (arrows, Home, End), it is what a phone already knows how to drag, and it
 * costs nothing to ship. The only thing worth adding is what the platform
 * cannot know — `aria-valuetext`, so a screen reader hears "120 credits, CHF
 * 22.75" rather than the bare number 120.
 *
 * The price shown is `priceRappen`, the same function the route charges from,
 * so what somebody reads on the slider is what the transaction is filed for.
 */
function BuyCreditsPanel({ username, cardTestMode }: { username: string; cardTestMode?: boolean }) {
  const { t, tn } = useI18n();
  const router = useRouter();
  const [credits, setCredits] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"failed" | null>(null);

  async function buy() {
    setBusy(true);
    setResult(null);
    const response = await fetch(
      `/api/web/${username}/purchases/${crypto.randomUUID()}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // The amount, never the price: the server prices it. See the route.
        body: JSON.stringify({ credits }),
      },
    ).catch(() => null);
    setBusy(false);

    if (response?.ok) {
      // The purchase created a pending transaction; go to its payment page.
      // The same link was emailed too, so this can be finished later — B405.
      const body = (await response.json().catch(() => null)) as {
        paymentUrl?: string;
      } | null;
      if (body?.paymentUrl) {
        router.push(body.paymentUrl);
        return;
      }
      setResult("failed");
    } else {
      setResult("failed");
    }
  }

  return (
    /**
     * Inline, always visible, anchored — B1319. This was a popover behind a
     * "Buy credits" press: the one thing the page exists for, hidden until
     * a second decision. The room's own "Guthaben kaufen" links straight to
     * `#buy`, and the slider, the price and the button are simply there.
     */
    <div id="buy" className="mt-4 scroll-mt-24 rounded-xl border border-line-quiet bg-surface-base px-4 py-3 sm:px-5 sm:py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {t("me.buyDialogTitle")}
      </p>
      <p className="mt-2 flex items-baseline justify-between gap-3">
        <span className="font-display text-2xl font-semibold tabular-nums text-ink-strong">
          {credits} {tn("me.paymentUnit", credits)}
        </span>
        <span className="font-display text-2xl font-semibold tabular-nums text-ink-strong">
          {formatChf(priceRappen(credits))}
        </span>
      </p>
      <label className="mt-1 block">
        <span className="sr-only">{t("me.buyDialogAmount")}</span>
        <input
          type="range"
          min={MIN_CREDITS}
          max={MAX_CREDITS}
          step={CREDIT_STEP}
          value={credits}
          onChange={(event) => setCredits(Number(event.target.value))}
          // What the platform cannot work out: a screen reader would
          // otherwise announce "120" with no unit and no price.
          aria-valuetext={`${credits} ${tn("me.paymentUnit", credits)}, ${formatChf(
            priceRappen(credits),
          )}`}
          className="h-11 w-full accent-yellow-400"
        />
      </label>
      <p className="text-sm text-ink-secondary">
        {discountFor(credits) > 0
          ? t("me.buyDialogDiscount", { discount: discountLabel(credits) })
          : t("me.buyDialogNoDiscount", {
              from: String(MIN_CREDITS),
              to: String(MAX_CREDITS),
            })}
      </p>
      <BusyButton
        type="button"
        busy={busy}
        onClick={() => buy()}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-yellow-400 px-4 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-6"
        busyLabel={t("me.buyDialogBusy")}
      >
        {t("me.buyDialogBuyAmount", {
          price: formatChf(priceRappen(credits)),
        })}
      </BusyButton>
      {cardTestMode && <p className="mt-2 text-sm text-ink-secondary">{t("me.buyTestMode")}</p>}
      {result && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("me.paymentBuyFailed")}
        </span>
      )}
    </div>
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
  rows: { key: string; label: string; human: string; share: number }[];
  reclaimable: { human: string; files: number; hasStagedFiles: boolean };
  canBuy: boolean;
  buyCredits: number;
};

/**
 * Ledger reasons the owner sees, grouped — B1784.
 *
 * `lib/credits.ts` keeps one reason per door because that is what an operator
 * reconciles a supplier bill against; an owner reading her own account wants
 * "where did my credits go", and four AI doors she cannot tell apart is four
 * lines of noise. Anything not listed falls into `other`, so the next reason
 * added to the ledger cannot put a raw translation key on this page again —
 * which is exactly how `ask_thread` got there.
 */
const SPENT_GROUPS: Record<string, string> = {
  helper: "ai",
  transcription: "ai",
  ask_thread: "ai",
  find_in_journal: "ai",
  travellers_from_photo: "ai",
  day_mail: "messages",
  day_whatsapp: "messages",
  day_sms: "messages",
  invite: "messages",
  digest: "messages",
  postcard: "postcard",
  photobook: "photobook",
  photobook_print: "photobook",
  storage: "storage",
  refunded: "refunded",
};

export function groupSpent(
  spent: { reason: string; credits: number }[],
): { group: string; credits: number }[] {
  const totals = new Map<string, number>();
  for (const { reason, credits } of spent) {
    const group = SPENT_GROUPS[reason] ?? "other";
    totals.set(group, (totals.get(group) ?? 0) + credits);
  }
  return [...totals]
    // Credits carry hundredths (B987), so a sum of two of them can land on
    // 0.30000000000000004 in binary floating point.
    .map(([group, credits]) => ({ group, credits: Math.round(credits * 100) / 100 }))
    .sort((a, b) => b.credits - a.credits);
}

/** What the Payment section needs — B367. `undefined` is credits switched
 * off; the page shows storage alone then, per B821's own acceptance line. */
export type PaymentPanel = {
  balance: number;
  emailRecipients: number;
  whatsappRecipients: number;
  channels: { mail: boolean | null; whatsapp: boolean | null };
  postcardCredits: number | null;
  transactions: PaymentRow[];
  /** What credits have gone on, biggest first — B860. Empty when the journal
   *  has never spent one. */
  spent: { reason: string; credits: number }[];
  /** B2090: card payments go to Stripe's test mode (a `sk_test_` key), so
   *  no real money moves — said once under the buy button. */
  cardTestMode?: boolean;
};

/** One row of the transaction history. `amount` is a preformatted CHF string
 * (server-side, from the pricing table) so the component never does money
 * arithmetic. */
type PaymentRow = {
  id: string;
  credits: number;
  amount: string;
  status: "pending" | "requested" | "paid" | "refunded";
  createdAt: string;
};

export default function AccountPageContent({
  username,
  storage,
  payment,
  orders,
}: {
  username: string;
  /** Absent only where the instance sets no ceiling. */
  storage?: StoragePanel;
  /** Absent when credits are switched off. */
  payment?: PaymentPanel;
  /** The 3 most recent orders and the total count — B1452. */
  orders: { recent: OrderRow[]; total: number };
}) {
  const { t, tn } = useI18n();
  const site = useSite();

  /**
   * Inside the iPhone shell nothing is bought — B2126, decided as D5.
   * Credits are a digital good, and App Store guideline 3.1.1 makes an
   * in-app purchase of them Apple's In-App Purchase or nothing; 3.1.3
   * forbids pointing at the website's checkout from inside the app. So the
   * balance shows, the slider and the storage purchase do not, and one
   * sentence says where credits come from — with no link and no price.
   * Prints are physical goods and keep their checkout (D10).
   *
   */
  const native = useNativeShell();

  const CHANNELS = payment
    ? ([
        {
          key: "mail",
          icon: Mail,
          labelKey: "me.paymentChannelEmail",
          recipients: payment.emailRecipients,
          // B840 — email to a reader the owner approved by hand costs a
          // hundredth of a Rappen to deliver, and is no longer charged for.
          // The row still says how many people it reaches, because that is
          // the number the owner is actually asking about.
          costs: false,
        },
        {
          key: "whatsapp",
          icon: MessageCircle,
          labelKey: "me.paymentChannelWhatsapp",
          recipients: payment.whatsappRecipients,
          // Meta invoices per message, so this one does.
          costs: true,
        },
      ] as const)
    : [];

  const dayCost = CHANNELS.reduce(
    (total, { key, recipients, costs }) =>
      total + (costs && payment?.channels[key] ? recipients : 0),
    0,
  );

  return (
    <>

        <div className="mt-6 space-y-4">
          {orders.recent.length > 0 && (
            // B1452. At the top — what an owner asks most right after a
            // purchase is "did it go through", not their balance.
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

          {payment && (
            <div className="rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/50 text-ink-strong">
                  <Wallet className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <h3 className="font-display text-lg font-semibold text-ink-strong">
                  {t("me.paymentTitle")}
                </h3>
              </div>

              <div className="mt-4 sm:flex sm:items-stretch sm:gap-4">
                <div className="flex flex-col justify-center rounded-xl border border-line-quiet bg-surface-base px-5 py-4 sm:w-44 sm:shrink-0">
                  <span className="font-display text-4xl font-semibold tabular-nums tracking-tight text-ink-strong">
                    {payment.balance.toLocaleString("de-CH")}
                  </span>
                  <span className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                    {tn("me.paymentUnit", payment.balance)}
                  </span>
                  {payment.balance === 0 && (
                    <span className="mt-2 text-sm leading-6 text-coral-600">
                      {t("me.paymentBalanceEmpty")}
                    </span>
                  )}
                </div>

                {CHANNELS.some(({ recipients }) => recipients > 0) ? (
                <div className="mt-4 sm:mt-0 sm:flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                    {t("me.paymentEstimateTitle")}
                  </p>
                  <ul className="mt-2 border-t border-line-quiet">
                    {CHANNELS.map(
                      ({ key, icon: Icon, labelKey, recipients, costs }) => {
                        const on = payment.channels[key];
                        if (on === null) return null;
                        return (
                          <li
                            className="border-b border-line-quiet py-2.5"
                            key={key}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <span className="flex items-center gap-2 text-base text-ink-strong">
                                  <Icon
                                    className="h-4 w-4 shrink-0 text-ink-secondary"
                                    aria-hidden="true"
                                  />
                                  {t(labelKey)}
                                </span>
                                <span className="mt-0.5 block text-sm text-ink-muted">
                                  {tn("me.paymentUpTo", recipients, {
                                    count: String(recipients),
                                  })}
                                  {" · "}
                                  <span
                                    className={
                                      on
                                        ? "font-semibold text-ink-strong"
                                        : undefined
                                    }
                                  >
                                    {costs ? (
                                      <>
                                        {on ? recipients : 0}{" "}
                                        {tn(
                                          "me.paymentUnit",
                                          on ? recipients : 0,
                                        )}
                                      </>
                                    ) : (
                                      t("me.paymentFree")
                                    )}
                                  </span>
                                </span>
                              </div>
                              <ChannelSwitch
                                username={username}
                                channel={key}
                                label={t(labelKey)}
                                enabled={on}
                              />
                            </div>
                            {/* B1434: the photograph-reaches-Meta-first fact B372 put on
                                the reader's own tick box, before B1396 removed it from
                                there — read once here, by the owner switching the
                                channel on, rather than per reader. */}
                            {key === "whatsapp" && on && (
                              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                                {t("me.whatsappPhotoDisclosure")}
                              </p>
                            )}
                          </li>
                        );
                      },
                    )}
                  </ul>
                  <p className="flex items-baseline justify-between gap-3 py-2.5 text-base font-semibold text-ink-strong">
                    <span>{t("me.paymentDayTotal")}</span>
                    <span className="tabular-nums">{dayCost}</span>
                  </p>
                  <p className="mt-2.5 text-sm leading-6 text-ink-secondary">
                    {t("me.paymentPrices")}
                    {payment.postcardCredits !== null && (
                      <>
                        {" "}
                        {t("me.paymentPostcardPrice", {
                          credits: String(payment.postcardCredits),
                        })}
                      </>
                    )}
                  </p>
                </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-ink-secondary sm:mt-0 sm:flex-1 sm:self-center">
                    {t("me.paymentPrices")}
                  </p>
                )}
              </div>

              {native ? (
                <p className="mt-4 text-sm leading-6 text-ink-secondary">{t("me.buyOnTheWebsite")}</p>
              ) : (
                <BuyCreditsPanel username={username} cardTestMode={payment.cardTestMode} />
              )}

              {payment.spent.length > 0 && (
                <div className="mt-5 border-t border-line-quiet pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                    {t("me.spentTitle")}
                  </p>
                  <ul className="mt-2 divide-y divide-line-quiet">
                    {groupSpent(payment.spent).map(({ group, credits }) => (
                      <li
                        key={group}
                        className="flex items-baseline justify-between gap-3 py-2"
                      >
                        <span className="min-w-0 text-base text-ink-strong">
                          {t(`me.spentReason.${group}` as TranslationKey)}
                        </span>
                        <span className="shrink-0 tabular-nums text-ink-body">
                          {credits} {tn("me.paymentUnit", credits)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* B2090: its own row, and only when an AI row is there
                      to explain — it read as a footnote to whatever row
                      happened to be last. */}
                  {groupSpent(payment.spent).some(({ group }) => group === "ai") && (
                    <p className="border-t border-line-quiet pt-2.5 text-sm leading-6 text-ink-secondary">
                      {t("me.spentAiNote")}
                    </p>
                  )}
                </div>
              )}

              {payment.transactions.length > 0 && (
                <div className="mt-5 border-t border-line-quiet pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                    {t("me.txHistoryTitle")}
                  </p>
                  <ul className="mt-2 divide-y divide-line-quiet">
                    {payment.transactions.map((tx) => (
                      <li
                        key={tx.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-base text-ink-strong">
                            {tx.credits} {tn("me.paymentUnit", tx.credits)} ·{" "}
                            {tx.amount}
                          </p>
                          <p className="text-sm tabular-nums text-ink-secondary">
                            {tx.createdAt.slice(0, 10)}
                          </p>
                        </div>
                        {tx.status === "refunded" ? (
                          // No link: there is nothing left to pay, and the
                          // money is on its way back. B878.
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-neutral-strong px-3 py-1 text-sm font-semibold text-ink-body">
                            <Undo2 className="h-4 w-4" aria-hidden="true" />
                            {t("me.txRefunded")}
                          </span>
                        ) : tx.status === "paid" ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
                            <Check className="h-4 w-4" aria-hidden="true" />
                            {t("me.txPaid")}
                          </span>
                        ) : tx.status === "requested" ? (
                          <Link
                            href={`${site.base}/payment/${tx.id}`}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line-quiet bg-surface-base px-3 py-1 text-sm font-semibold text-ink-body transition-colors hover:border-line-prominent"
                          >
                            {t("me.txAwaiting")}
                          </Link>
                        ) : (
                          <Link
                            href={`${site.base}/payment/${tx.id}`}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-coral-300 bg-coral-300/15 px-3 py-1 text-sm font-semibold text-coral-600 transition-colors hover:bg-coral-300/30"
                          >
                            {t("me.txPay")}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
              {storage.percent !== null && storage.percent >= 90 && (
                <p className="mt-1 text-sm leading-6 text-coral-600">
                  {t("me.storageNearlyFull")}
                </p>
              )}

              {storage.rows.length > 0 && <StorageBar rows={storage.rows} />}

              {(storage.reclaimable.files > 0 || storage.canBuy) && (
                <div className="mt-5 border-t border-line-quiet pt-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {storage.reclaimable.files > 0 && (
                      <CleanupButton
                        username={username}
                        reclaimable={storage.reclaimable}
                      />
                    )}
                    {storage.canBuy && !native && <BuyStorageButton username={username} />}
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

          {!storage && !payment && (
            // Neither figure has anything behind it — no ceiling configured
            // and credits switched off. Rare (an instance normally sets one
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
