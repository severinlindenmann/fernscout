"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookMarked,
  Check,
  ChevronRight,
  Pencil,
  KeyRound,
  Wallet,
  UserRound,
  Mail,
  MessageCircle,
  TriangleAlert,
  ChartNoAxesColumn,
  HardDrive,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AgentHandover from "@/components/AgentHandover";
import AgentKeys from "@/components/AgentKeys";
import BuddyHandover from "@/components/BuddyHandover";
import ContactManage, { type ManageContact } from "@/components/ContactManage";
import GuestSignIn from "@/components/GuestSignIn";
import PushOptIn from "@/components/PushOptIn";
import SignOut from "@/components/SignOut";
import PageHeader from "@/components/PageHeader";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { useSite } from "@/components/SiteProvider";
import { EXTRA_STORAGE_CREDITS, formatChf, TIERS } from "@/lib/credits/pricing";
import type { TranslationKey } from "@/lib/i18n";
import type { Viewer } from "@/lib/viewer";

/**
 * The tiers picker behind the Payment card's "Buy credits" button — B368/B405,
 * and a dropdown rather than a modal since B413.
 *
 * It opens as a small popover anchored under its own button, not a centred
 * `<dialog>`: `showModal()` centres against the viewport, which an ancestor's
 * transform/containment can throw off (the owner saw it land top-left), and a
 * three-item picker reads better dropping out of the button that summoned it
 * anyway. Escape and a click outside close it; focus returns to the button.
 *
 * Pressing Buy on a tier posts to the purchase route, which records a pending
 * transaction, mails the journal's own owner the payment link, and grants
 * nothing — see that route's doc comment. On success this sends the owner to
 * that payment page (B405); the email carries the same link for later.
 */
/**
 * One channel's mute switch — B463.
 *
 * The two capabilities that spend the balance this card is about, next to the
 * balance, for the person already signed in as the owner of it. Not a settings
 * page and deliberately not the shape of one: two named channels, and the
 * route behind it (`POST /api/v1/<user>/channels`) accepts no other key.
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
    const response = await fetch(`/api/v1/${username}/channels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, enabled: !enabled }),
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
      {failed && <span className="text-sm text-coral-600">{t("me.paymentChannelFailed")}</span>}
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
          enabled ? "border-navy-900 bg-navy-900" : "border-navy-500 bg-white"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] ${
            enabled ? "left-[22px] bg-white" : "left-0.5 bg-navy-500"
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
 * to buy and one price. It spends immediately: `POST /api/v1/<user>/storage`
 * takes the credits and the extension exists from that moment, so the
 * confirmation is the browser's own — there is no second page to go to and
 * nothing to come back and finish. `router.refresh()` is what redraws the
 * figure above it from the server.
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
    const response = await fetch(`/api/v1/${username}/storage`, { method: "POST" }).catch(
      () => null,
    );
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
        question={t("me.storageBuyConfirm", { credits: String(EXTRA_STORAGE_CREDITS) })}
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
        className="inline-flex min-h-11 items-center rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-50"
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
      `/api/v1/${username}/storage/cleanup${staged ? "?staged=1" : ""}`,
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
        busyLabel={t("me.storageCleanupBusy")}
        busy={busy}
        error={failed ? t("me.storageCleanupFailed") : undefined}
        onConfirm={clean}
        onCancel={() => setAsking(false)}
      >
        {reclaimable.hasStagedFiles && (
          <label className="mt-3 flex items-start gap-2 text-sm leading-6 text-navy-700">
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
        className="inline-flex min-h-11 items-center rounded-full border border-navy-500 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-50"
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
  "bg-navy-900",
  "bg-yellow-400",
  "bg-sky-400",
  "bg-coral-400",
  "bg-green-500",
  "bg-navy-500",
  "bg-yellow-600",
  "bg-sky-500",
];

function StorageBar({ rows }: { rows: StoragePanel["rows"] }) {
  return (
    <>
      <div
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-navy-200"
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
        {rows.map((row, at) => (
          <li key={row.key} className="flex items-center justify-between gap-3 text-base">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${BAR_COLOURS[at % BAR_COLOURS.length]}`}
                aria-hidden="true"
              />
              <span className="truncate text-navy-700">{row.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-navy-900">{row.human}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function BuyCreditsDialog({ username }: { username: string }) {
  const { t, tn } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [result, setResult] = useState<"failed" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Escape and click-outside close it — the two things a modal `<dialog>` gave
  // for free and a popover has to wire up. Only while open, so the listeners
  // are not attached for every owner who never presses the button.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointer(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  async function buy(tierId: string) {
    setBusyTier(tierId);
    const response = await fetch(`/api/v1/${username}/credits/purchase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: tierId }),
    }).catch(() => null);
    setBusyTier(null);

    if (response?.ok) {
      // The purchase created a pending transaction; go to its payment page.
      // The same link was emailed too, so this can be finished later — B405.
      const body = (await response.json().catch(() => null)) as { paymentUrl?: string } | null;
      setOpen(false);
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
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setResult(null);
            setOpen((o) => !o);
          }}
          className="inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
        >
          {t("me.paymentBuyTitle")}
        </button>
        <span className="text-sm text-navy-600">{t("me.paymentBuyBody")}</span>
      </div>
      {result && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("me.paymentBuyFailed")}
        </span>
      )}

      {/*
        The panel stays in the DOM so it can animate both ways; `open` toggles
        opacity + a short downward slide, and turns off pointer events and tab
        focus while hidden. `motion-reduce` drops the slide for readers who ask
        for less motion.
      */}
      <div
        role="menu"
        aria-label={t("me.buyDialogTitle")}
        aria-hidden={!open}
        className={`absolute left-0 top-full z-20 mt-2 w-[min(22rem,100%)] origin-top rounded-2xl border border-navy-200 bg-white p-4 shadow-xl transition duration-150 ease-out motion-reduce:transition-none ${
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-navy-600">
          {t("me.buyDialogTitle")}
        </p>
        <ul className="mt-2 space-y-2.5">
          {TIERS.map((tier) => (
            <li
              key={tier.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-navy-200 bg-cream-50 px-4 py-3"
            >
              <div>
                <p className="font-display text-base font-semibold text-navy-900">
                  {tier.credits} {tn("me.paymentUnit", tier.credits)}
                </p>
                <p className="text-sm text-navy-600">
                  {formatChf(tier.priceRappen)}
                  {tier.discount && ` · ${t("me.buyDialogDiscount", { discount: tier.discount })}`}
                </p>
              </div>
              <button
                type="button"
                role="menuitem"
                tabIndex={open ? 0 : -1}
                disabled={busyTier !== null}
                onClick={() => buy(tier.id)}
                className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyTier === tier.id ? t("me.buyDialogBusy") : t("me.buyDialogBuy")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** What the "Your details" panel needs to render `ContactManage` inline —
 * everything `/c/<token>` builds server-side, handed down instead of a link
 * to that page. */
/**
 * The journal's own name and subtitle, and the address that owns it — B619.
 *
 * `PATCH /api/journal` rather than `/api/v1/{user}/config`: that one takes a
 * bearer token and this is a cookie session, which are deliberately not
 * interchangeable. The route's own comment carries the reasoning.
 *
 * The email is rendered and has no input. It is the address that decides who
 * can obtain a write token for this journal, so a stolen year-long cookie
 * must not be able to move the journal to another mailbox — the one field
 * here that is a credential rather than a label.
 */
function JournalSettings({
  username,
  journal,
}: {
  username: string;
  journal: JournalPanel;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(journal.title);
  const [tagline, setTagline] = useState(journal.tagline);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");

  const dirty = title.trim() !== journal.title || tagline.trim() !== journal.tagline;

  async function save() {
    setBusy(true);
    setState("idle");
    const response = await fetch("/api/journal", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, title, tagline }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setState("failed");
      return;
    }
    setState("saved");
    // The title is in the header of every page, so the whole tree has to read
    // itself again — not only this card.
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <label className="block">
        <span className="text-sm font-semibold text-navy-900">{t("me.journalName")}</span>
        <input
          type="text"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
        />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-navy-900">{t("me.journalTagline")}</span>
        <input
          type="text"
          value={tagline}
          maxLength={200}
          onChange={(event) => setTagline(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          // A title cannot be cleared — `setJournalProfile` refuses it and
          // says so — and refusing the press is friendlier than a red line
          // saying what the person could see for themselves.
          disabled={busy || !dirty || title.trim() === ""}
          onClick={save}
          className="inline-flex min-h-11 w-fit items-center rounded-full bg-navy-900 px-5 text-base font-semibold text-cream-50 transition-colors hover:bg-navy-700 disabled:opacity-50"
        >
          {t("me.journalSave")}
        </button>
        {state === "saved" && !dirty && (
          <span className="text-sm text-navy-600">{t("me.journalSaved")}</span>
        )}
        {state === "failed" && <span className="text-sm text-coral-600">{t("me.journalFailed")}</span>}
      </div>

      <div className="border-t border-navy-200 pt-4">
        <p className="text-sm font-semibold text-navy-900">{t("me.journalEmail")}</p>
        <p className="mt-0.5 break-words text-base text-navy-900">{journal.email}</p>
        <p className="mt-1 text-sm leading-6 text-navy-600">{t("me.journalEmailNote")}</p>
      </div>
    </div>
  );
}

/**
 * One trip in "what you can read", with the pencil that edits it — B621.
 *
 * Owner only: `edit` is undefined for everybody else and the row is exactly
 * the link it always was. A person on a trip may write days into it, and what
 * the journey is called and who may read it stays the owner's.
 *
 * The form is two halves that save separately, and that is not tidiness — the
 * route refuses a body naming both, because each call rewrites `trip.md`
 * whole. It also happens to be the right shape for the page: who may read a
 * journey is not a field you change alongside a typo in its title, so it has
 * its own control and its own second press.
 */
function TripRow({
  trip,
  edit,
  username,
  reasonKey,
}: {
  trip: Viewer["trips"][number];
  edit?: TripEditPanel;
  username: string;
  reasonKey: TranslationKey;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <li>
      <div className="flex items-center">
        <Link
          href={trip.href}
          className="flex min-h-14 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-cream-50"
        >
          <span className="flex-1">
            <span className="block font-display text-lg font-semibold text-navy-900">
              {trip.title}
            </span>
            {/* B632 — a trip may hold some of its own days back further than
                the rest of it; a row that only says "you can read this trip"
                would leave a reader thinking they are seeing all of it. */}
            {trip.partial && (
              <span className="block text-xs text-navy-500">{t("me.tripPartial")}</span>
            )}
          </span>
          <span className="text-sm text-navy-600">{t(reasonKey)}</span>
        </Link>
        {edit && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={t("me.tripEdit", { trip: trip.title })}
            onClick={() => setOpen((was) => !was)}
            // Outside the `<Link>`, not inside it: a button nested in an
            // anchor is invalid, and a click on it would navigate.
            className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-600 transition-colors hover:bg-cream-100 hover:text-navy-900"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {edit && open && (
        <TripEditor username={username} trip={edit} onClose={() => setOpen(false)} />
      )}
    </li>
  );
}

function TripEditor({
  username,
  trip,
  onClose,
}: {
  username: string;
  trip: TripEditPanel;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(trip.title);
  const [tagline, setTagline] = useState(trip.tagline);
  const [start, setStart] = useState(trip.start);
  const [end, setEnd] = useState(trip.end);
  const [visibility, setVisibility] = useState(trip.visibility);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const dirty =
    title.trim() !== trip.title ||
    tagline.trim() !== trip.tagline ||
    start !== trip.start ||
    end !== trip.end;

  /** One call, one kind of change — see the route. `problem` carries the
   * server's own sentence rather than a code: every refusal here already
   * explains itself in words, and rewriting them in the client would be a
   * second copy to disagree with the first. */
  async function save(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    const response = await fetch("/api/trip", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, trip: trip.id, ...body }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const said = (await response?.json().catch(() => null)) as { message?: string } | null;
      setProblem(said?.message ?? t("me.journalFailed"));
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="border-t border-navy-200 bg-cream-50 px-4 py-4">
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-semibold text-navy-900">{t("me.tripTitle")}</span>
          <input
            type="text"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-navy-900">{t("me.tripTagline")}</span>
          <input
            type="text"
            value={tagline}
            maxLength={300}
            onChange={(event) => setTagline(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="block flex-1">
            <span className="text-sm font-semibold text-navy-900">{t("me.tripStart")}</span>
            {/* `type="date"` rather than a picker: the platform has one, it is
                localised, and it is the right control on a phone. */}
            <input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
            />
          </label>
          <label className="block flex-1">
            <span className="text-sm font-semibold text-navy-900">{t("me.tripEnd")}</span>
            <input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy || !dirty || title.trim() === ""}
            onClick={async () => {
              if (await save({ title, tagline, start, end })) onClose();
            }}
            className="inline-flex min-h-11 w-fit items-center rounded-full bg-navy-900 px-5 text-base font-semibold text-cream-50 transition-colors hover:bg-navy-700 disabled:opacity-50"
          >
            {t("me.journalSave")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 w-fit items-center rounded-full px-4 text-base text-navy-700 hover:underline"
          >
            {t("me.tripCancel")}
          </button>
        </div>
      </div>

      <div className="mt-5 border-t border-navy-200 pt-4">
        <label className="block">
          <span className="text-sm font-semibold text-navy-900">{t("me.tripWho")}</span>
          <select
            value={visibility}
            onChange={(event) => {
              setVisibility(event.target.value as TripEditPanel["visibility"]);
              setConfirming(false);
            }}
            className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
          >
            <option value="private">{t("me.tripWhoPrivate")}</option>
            <option value="guest">{t("me.tripWhoGuest")}</option>
            <option value="public">{t("me.tripWhoPublic")}</option>
          </select>
        </label>
        {visibility !== trip.visibility && (
          <>
            {/* Two presses, always — not only when it widens. Everything
                already published on this journey answers to the new value the
                moment it is written, and a `<select>` is one careless click. */}
            <p className="mt-2 text-sm leading-6 text-navy-700">{t("me.tripWhoWarning")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                if (await save({ visibility })) onClose();
              }}
              className="mt-2 inline-flex min-h-11 w-fit items-center rounded-full border border-coral-400 px-5 text-base font-semibold text-coral-600 transition-colors hover:bg-coral-50 disabled:opacity-50"
            >
              {t(confirming ? "me.tripWhoConfirm" : "me.tripWhoChange")}
            </button>
          </>
        )}
      </div>

      {problem && <p className="mt-3 text-sm leading-6 text-coral-600">{problem}</p>}
    </div>
  );
}

/**
 * One trip as its owner may edit it — B621.
 *
 * Beside `ViewerTrip`, not inside it: that type is every reader's answer to
 * "what can I open", and three quarters of the people who get one have no
 * business being handed a trip's dates and its visibility. This is resolved
 * for the owner alone, on the server, like every other panel here.
 */
export type TripEditPanel = {
  id: string;
  title: string;
  /** `""` when the trip has none; clearing the box removes the key. */
  tagline: string;
  start: string;
  end: string;
  visibility: "public" | "guest" | "private";
};

/** The journal's own description, for the card that edits it — B619. Owner
 * only, and resolved on the server like every other panel here. */
export type JournalPanel = {
  title: string;
  /** `""` when the journal has none; clearing the box removes the key. */
  tagline: string;
  /** Shown, never edited. See `JournalSettings`. */
  email: string;
};

export type ManagePanel = {
  token: string;
  locales: string[];
  dictionary: Record<string, string>;
  contact: ManageContact;
  /** B385: `whatsappCountryCode()`, resolved server-side like everything
   * else this panel carries — see the note on `PaymentPanel` below for why
   * that rule exists. */
  defaultCountryCode?: string;
  /** B399: `isEnabled("addressLookup", username)`, resolved server-side for
   * the same reason. */
  addressLookupEnabled?: boolean;
};

/**
 * What the Payment section needs — B367.
 *
 * Resolved entirely on the server (`app/[user]/me/page.tsx`), never here: a
 * balance and a recipient count are exactly the kind of field that rule
 * exists for, the same as `ownerName` above. `undefined` is the whole of B74
 * for this panel — credits switched off, or a reader who is not the owner —
 * and the component does not need to tell those two apart because it never
 * sees which one happened.
 */
export type PaymentPanel = {
  balance: number;
  /** Contacts `active` and opted in to the email digest, journal-wide. Not
   * one trip's count — see the long comment on this prop's caller. */
  emailRecipients: number;
  /** The same count for WhatsApp. A number whether or not the channel is
   * currently on: muting it does not un-opt anybody in, and the owner
   * switching it back on wants to see who it would reach. */
  whatsappRecipients: number;
  /**
   * Whether each channel is switched on for this journal — B463.
   *
   * `null` is **this server cannot offer it**: no transport configured, no
   * WhatsApp credentials. That is not a state an owner can change, so the row
   * and its switch are absent rather than shown off — the same rule the rest
   * of the site follows for a capability that is not there (B74).
   *
   * `false` is the owner having muted it, which is a state they can undo and
   * must therefore be able to see.
   */
  channels: { mail: boolean | null; whatsapp: boolean | null };
  /** What one printed card costs, or `null` where this journal does not offer
   * postcards. The largest single thing a balance is spent on, and until B463
   * the one panel about credits never mentioned it. */
  postcardCredits: number | null;
  /** Recent purchases, newest first — the history under the buy button (B413).
   * Each is a mock transaction; an unpaid one links back to its payment page. */
  transactions: PaymentRow[];
};

/**
 * How full this journal is, and what is filling it — B661, B664.
 *
 * Its own panel rather than a line inside Payment, and its own prop for the
 * reason that follows from that: it is about the journal and not about
 * credits, so it has to be there when charging is off. `canBuy` is the only
 * part that goes away then — an owner still wants to know they are nearly
 * full even where nothing is for sale.
 *
 * Preformatted on the server, like `PaymentRow.amount` and for the same
 * reason: the component does no arithmetic on bytes any more than on money.
 * `limit` is null where the instance sets no ceiling, and then there is
 * nothing to be near the end of.
 */
export type StoragePanel = {
  used: string;
  limit: string | null;
  percent: number | null;
  /** One row per thing an owner could act on, biggest first, already
   * formatted. `share` is a percentage of the *allowance* where there is one,
   * so the bar and the number under it agree. */
  rows: { key: string; label: string; human: string; share: number }[];
  /** What a cleanup would take back, and roughly what it is made of. */
  reclaimable: { human: string; files: number; hasStagedFiles: boolean };
  canBuy: boolean;
  buyCredits: number;
};

/** One row of the transaction history. `amount` is a preformatted CHF string
 * (server-side, from the pricing table) so the component never does money
 * arithmetic. */
export type PaymentRow = {
  id: string;
  credits: number;
  amount: string;
  status: "pending" | "requested" | "paid";
  createdAt: string;
};

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
 * the things that are genuinely yours rather than the journal's: your own
 * name, telephone and address, and — since B619, for the owner alone — what
 * the journal calls itself. Not a day, not a photograph, not a trip.
 */
export default function MePageContent({
  viewer,
  username,
  siteUrl,
  manage,
  journal,
  editableTrips,
  payment,
  storage,
  canSignIn,
  codeMinutes,
  contactsEnabled,
  analyticsEnabled = false,
  ownerName,
  signinNotice,
}: {
  viewer: Viewer;
  username: string;
  /** This instance's public base URL. Threaded from the server rather than
   * read off `location`, so the prompt an agent is handed names the address
   * the journal actually answers on rather than whatever host the owner
   * happens to have reached it through. */
  siteUrl: string;
  /** Present only when this reader has a contact record to edit. */
  manage?: ManagePanel;
  /** The journal's own name, subtitle and owner address — owner only, B619. */
  journal?: JournalPanel;
  /** The trips this reader may edit — B621. Owner only, and absent for
   * everybody else, which is what leaves their rows exactly as they were. */
  editableTrips?: TripEditPanel[];
  /** Present only for the owner — see `StoragePanel`. Absent where the
   * instance sets no ceiling, which is the one case with nothing to show. */
  storage?: StoragePanel;
  /** Present only for the owner, and only when credits are switched on —
   * see `PaymentPanel`. */
  payment?: PaymentPanel;
  /** Whether codes can be issued at all, which is what signing in needs. */
  canSignIn: boolean;
  /** How long a code lasts, from `CODE_TTL_MINUTES` — see GuestSignIn. */
  codeMinutes: string;
  /** Whether this journal keeps a guest list at all. Resolved on the server;
   * `isEnabled` reads server config and this file is a client component. */
  contactsEnabled: boolean;
  /** Whether this journal counts its readers at all — B566. Absent rather
   * than disabled when off, per B74: a card leading to a 404 is worse than
   * no card. Only ever true for the owner, because only the owner may open
   * the page it leads to. Optional, defaulting to off, so that omitting it
   * fails towards no card rather than towards one that 404s. */
  analyticsEnabled?: boolean;
  /**
   * What to call the person whose journal this is — one word, and never their
   * address (B20).
   *
   * Picked at the server boundary by `ownerShortName`, so this component is
   * handed a name and cannot reach the email sitting beside it in the config.
   * Absent when the journal names nobody, and the copy then falls back to the
   * sentences that name no one, because "Ask ." is worse than "ask them".
   */
  ownerName?: string;
  /**
   * Why they landed here rather than inside the journal (B142).
   *
   * `?signin=expired` has been redirected to for as long as the sign-in link
   * has existed, and until now nothing on this page said anything about it —
   * so somebody whose welcome link had been spent by their own mail provider
   * arrived at an ordinary page with no explanation and every reason to think
   * they had done something wrong.
   */
  signinNotice?: string;
}) {
  const { t, tn } = useI18n();
  const site = useSite();
  // Bumped when the handover block mints a key, so the list of live keys below
  // it reads itself again rather than showing the state from page load.
  const [keysChanged, setKeysChanged] = useState(0);

  // One line beside each trip, saying why it is open to this reader. The
  // wording is `resolveViewer`'s answer and never this component's: the panel
  // computing anything of its own about access is B41.
  const reason: Record<Viewer["trips"][number]["through"], TranslationKey> = {
    public: "me.viaPublic",
    owner: "me.viaOwner",
    traveller: "me.viaTraveller",
    guest: "me.viaGuest",
  };

  /**
   * The trips this reader may *write* — B320.
   *
   * `resolveViewer` has told this page apart from B80 onwards, and until now
   * the distinction bought one sentence in the list above. It is the whole
   * answer to a second question the page never asked: somebody named in a
   * trip's `people:`, or approved through a buddy link, may write days into
   * that trip and may hold a token scoped to it. Everything on this page that
   * said so was inside `{viewer.owner && …}`, so they were told they could
   * read and nothing else.
   *
   * **Excluded for the owner, deliberately.** An owner who also travelled has
   * `traveller` trips in this list, and the block below would offer them the
   * narrow, mail-a-code flow beside their own button for a journal-wide key —
   * two ways to do one job, to a reader with no basis for choosing, which is
   * exactly what B301 removed from the owner block.
   *
   * Nothing here grants anything: this decides what to *say*, and
   * `mayRequestAgentToken` in `/api/auth/request` is still the only thing that
   * decides whether a code is issued.
   */
  const writableTrips = viewer.owner ? [] : viewer.trips.filter((t) => t.through === "traveller");

  /**
   * The two channels a published day can cost credits on — B463.
   *
   * Declared here rather than inline so the table, the total and the switches
   * are reading one list: a third channel added to one of them and not the
   * others is exactly the bug this shape prevents.
   */
  const CHANNELS = payment
    ? ([
        {
          key: "mail",
          icon: Mail,
          labelKey: "me.paymentChannelEmail",
          recipients: payment.emailRecipients,
        },
        {
          key: "whatsapp",
          icon: MessageCircle,
          labelKey: "me.paymentChannelWhatsapp",
          recipients: payment.whatsappRecipients,
        },
      ] as const)
    : [];

  /** What one published day would cost right now — the muted channels
   * contributing nothing, which is the whole point of being able to mute
   * them. */
  const dayCost = CHANNELS.reduce(
    (total, { key, recipients }) => total + (payment?.channels[key] ? recipients : 0),
    0,
  );

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("me.title")}
        </h1>

        {/* First thing on the page, above the fold and above the sign-in
            control it tells them to use. It is the answer to the question they
            arrived with. */}
        {signinNotice && (
          <p
            role="status"
            className="mt-5 rounded-2xl border-l-4 border-yellow-400 bg-cream-100 py-4 pl-5 pr-4 text-lg leading-8 text-navy-900"
          >
            {t(signinNotice as never)}
          </p>
        )}

        {!viewer.email ? (
          <>
            <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
              <h2 className="font-display text-xl font-semibold text-navy-900">
                {t("me.strangerTitle")}
              </h2>
              {/*
                Who to ask, by name.

                The page is written for the reader least comfortable with
                software here — somebody who opens the journal from a link in
                an email and, when she loses the email, has no way back in. It
                told her the only way in was to ask a person and never said
                which person, on a site she may have reached without knowing
                whose it is.

                The name and nothing else. No address, no phone number: the
                same discipline the trip gate keeps (B117) — say enough that
                somebody who should be here knows who to write to, and nothing
                that would be a leak to whoever else tries the URL.
              */}
              <p className="mt-2 text-lg leading-8 text-navy-700">
                {ownerName
                  ? t("me.strangerBodyNamed", { name: ownerName })
                  : t("me.strangerBody")}
              </p>

              {/*
                There is exactly one door for a stranger, and it is signing in
                — which only works for somebody already known here.

                This page used to offer the open guestbook beside it: a form
                anybody who found the address could fill in, putting themselves
                on the owner's queue uninvited (B37). It is gone, and the
                sentence that used to appear only on journals with no guestbook
                is now the honest answer for every journal: the link somebody
                sends you is what lets you in.

                It is shown only when there is nothing to press. With sign-in
                available, the reader is offered that and nothing else —
                somebody reading this has almost certainly been here before and
                lost the email, and a second paragraph telling them to ask for
                a link would talk them out of the control right underneath it.
              */}
              {!canSignIn && (
                <p className="mt-4 border-l-2 border-yellow-400 pl-4 text-base leading-7 text-navy-900">
                  {ownerName ? t("me.askOwnerNamed", { name: ownerName }) : t("me.askOwner")}
                </p>
              )}
            </section>

            {/* The way back for somebody who has been here before and lost the
                email they were let in with. */}
            {canSignIn && <GuestSignIn username={username} codeMinutes={codeMinutes} />}
          </>
        ) : (
          <p className="mt-2 text-base text-navy-600">
            {t("me.signedInAs")}{" "}
            <strong className="font-semibold text-navy-900">{viewer.name ?? viewer.email}</strong>
          </p>
        )}

        {viewer.email && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">{t("me.canRead")}</h2>
            {/*
              Three empty states, because there are three people who can
              reach one — B395 added the third.

              For somebody who has never been let in, it means the invitation
              has not arrived, and the answer is to ask whoever sent them.
              For somebody `resolveViewer` already marks `guest` — a
              confirmed contact of this journal — that sentence is false: they
              were invited and approved, and an empty list here means every
              trip is closed to them regardless, not that nobody sent them
              anything. `/<user>/trips` already told that reader the true
              thing (`trips.hiddenSignedInBody`, B264/B278); this reuses the
              same sentence rather than inventing a third wording for the same
              fact. Said to the **owner** of a journal with no trips in it at
              all, neither sentence is true — nobody sent them, and there is
              nothing to be invited to (B75).

              `resolveViewer` puts every trip in the journal into the list for
              an owner, so an empty list has exactly one meaning for them: the
              journal has no trips. The answer is how one gets made — an agent,
              per decision 24 — and the prompt to hand it is already in the
              owner block below, so the copy points down the page rather than
              repeating the handover here.
            */}
            {viewer.trips.length === 0 ? (
              <p className="mt-2 text-lg leading-8 text-navy-700">
                {viewer.owner
                  ? t("me.ownerNoTrips")
                  : viewer.guest
                    ? t("trips.hiddenSignedInBody", { name: ownerName ?? username })
                    : t("me.nothing")}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-navy-200 overflow-hidden rounded-2xl border border-navy-200 bg-white">
                {viewer.trips.map((trip) => (
                  <TripRow
                    key={trip.id}
                    trip={trip}
                    edit={editableTrips?.find((candidate) => candidate.id === trip.id)}
                    username={username}
                    reasonKey={reason[trip.through]}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {/*
          Not the owner's — B621 moved theirs to `/{user}/contacts`, the page
          that is already about addresses, consents and who gets a postcard,
          where their own row is one more entry in the book rather than an
          aside on the access page. A guest has no such page and keeps it
          here, which is what it was built for.
        */}
        {manage && !viewer.owner && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">{t("me.details")}</h2>
            {/*
              Two sentences, because the shorter one is false to half its
              readers — B320.

              "Nothing else on this site can be edited here — the journal is
              written by an agent" is exactly right for a guest. Said to
              somebody on a trip it reads as a closed door, and they are one of
              the people that agent writes for; it was the only thing on the
              page that addressed their write access at all, and it denied it.
              The traveller's version keeps the true half — there is still no
              form, and it is still an agent that writes — and points at the
              block that tells them how.
            */}
            <p className="mt-2 text-lg leading-8 text-navy-700">
              {/* A third reader for a paragraph that had two — B619. To the
                  owner both existing sentences are false: "the journal is
                  written by an agent" is true and is not what this section is
                  for, and the traveller's version points at a block they do
                  not have. Theirs says what the details are actually good
                  for, which is a card in their own letterbox and a message on
                  their own telephone. */}
              {t(writableTrips.length > 0 ? "me.detailsBodyTraveller" : "me.detailsBody")}
            </p>
            {/* A native `<details>` rather than a link to `/c/<token>`: the
                same form, opened in place instead of on a second page — see
                `ManagePanel` above for why the data now travels down instead
                of a URL. */}
            <details className="mt-3">
              <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center rounded-full border border-navy-700 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-100 [&::-webkit-details-marker]:hidden">
                {t("me.editDetails")}
              </summary>
              <div className="mt-4 rounded-2xl border border-navy-200 bg-white">
                <ContactManage
                  className="px-5 py-6 sm:px-6"
                  locales={manage.locales}
                  dictionary={manage.dictionary}
                  username={username}
                  token={manage.token}
                  contact={manage.contact}
                  defaultCountryCode={manage.defaultCountryCode}
                  addressLookupEnabled={manage.addressLookupEnabled}
                  // B619. Their own row: the unsubscribe and delete buttons
                  // below the form promise things that are not true of the
                  // person whose journal it is — see the prop's own note.
                  isOwner={viewer.owner}
                />
              </div>
            </details>
          </section>
        )}

        {/*
          The buddy's half of the page — B320. Same place as the owner block
          below and the same shape, because it is the same job: what to hand an
          agent, and what that agent can then do. Never both, and the two
          cannot both render — `writableTrips` is empty for an owner.

          Gated on `viewer.email` only through `writableTrips`, which is empty
          for anybody not signed in, so this needs no separate check.
        */}
        {writableTrips.length > 0 && viewer.email && (
          <section className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-5 sm:p-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("me.buddyTitle")}
            </h2>
            <div className="mt-4">
              <BuddyHandover
                siteUrl={siteUrl}
                username={username}
                email={viewer.email}
                trips={writableTrips}
              />
            </div>
          </section>
        )}

        {viewer.owner && (
          <section className="mt-8">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-navy-900">
              {t("me.ownerTitle")}
            </h2>
            <p className="mt-1.5 text-base leading-7 text-navy-600">{t("me.ownerLede")}</p>

            {/*
              Three concern-cards instead of one flat wall — B392. The owner
              block used to be a single cream box with five subsections stacked
              as identical `h3 + p + p + button` groups, so the one figure a
              person scans for (the balance) read as prose in the middle of it.
              The jobs are the agent, the money and the people; the cards say so.
            */}
            <div className="mt-5 space-y-4">
              {/*
                What the journal calls itself — B619. First of the cards
                because it is the only one about the journal rather than about
                a thing the owner hands somebody: a title typoed at signup used
                to need an agent token to correct, which is a shell away from
                needing the server.
              */}
              {journal && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                      <BookMarked className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.journalCardTitle")}
                    </h3>
                  </div>
                  {/*
                    Collapsed to the thing it is about — B623. Renaming a
                    journal is done once and then not again for a year, and
                    two text boxes, a Save and the email block were taking
                    that room every visit. The pencil is the shape B621's trip
                    rows already use.
                  */}
                  <details className="mt-3">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="block truncate font-display text-lg font-semibold text-navy-900">
                          {journal.title}
                        </span>
                        {journal.tagline && (
                          <span className="block truncate text-sm text-navy-600">
                            {journal.tagline}
                          </span>
                        )}
                      </span>
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-600">
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        {/* The disclosure's own name is the journal's title,
                            which says what it is about and not what opening it
                            does. One hidden word says the second half. */}
                        <span className="sr-only">{t("me.journalCardEdit")}</span>
                      </span>
                    </summary>
                    <p className="mt-3 text-base leading-7 text-navy-600">
                      {t("me.journalCardBody")}
                    </p>
                    <JournalSettings username={username} journal={journal} />
                  </details>
                </div>
              )}

              {/* The agent — handing over a key, what it can do, and the live keys. */}
              <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                    <KeyRound className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <h3 className="font-display text-lg font-semibold text-navy-900">
                    {t("me.agentCardTitle")}
                  </h3>
                </div>

                {/* Shared with the empty trip list, which is where a new owner
                    actually lands first — see components/AgentHandover.tsx. */}
                <div className="mt-4">
                  <AgentHandover
                    username={username}
                    siteUrl={siteUrl}
                    onIssued={() => setKeysChanged((n) => n + 1)}
                  />
                </div>

                {/*
                  What the code actually becomes — the one thing a person needs
                  to judge before reading a code aloud: what the other end can
                  do, and for how long. The warning is decision 24 in a
                  sentence, and it earns the callout rather than a stray line.

                  Folded away since B623. The words are right and they are read
                  once: the first time somebody hands a key over. Left open
                  they sat between the button that mints one and the list of
                  live keys underneath, which is what an owner comes back for.
                  A `<details>` rather than state, like the details form — and
                  the summary keeps the heading, so what is behind it is named
                  rather than hidden.
                */}
                <details className="mt-5 border-t border-navy-200 pt-5">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 font-display text-base font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-navy-600 transition-transform [details[open]>summary>&]:rotate-90"
                      aria-hidden="true"
                    />
                    {t("me.tokenTitle")}
                  </summary>
                  <p className="mt-1.5 text-base leading-7 text-navy-700">{t("me.tokenBody")}</p>
                  <div className="mt-3 flex gap-3 rounded-xl border border-coral-300 bg-coral-300/15 p-3.5">
                    <TriangleAlert
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 text-coral-600"
                      aria-hidden="true"
                    />
                    <p className="text-base leading-7 text-navy-900">{t("me.tokenWarning")}</p>
                  </div>
                </details>

                {/* The way to take a key back — B283. Renders nothing until
                    there is a live key. */}
                <AgentKeys username={username} reloadOn={keysChanged} />
              </div>

              {/*
                Credits — the signature card, B367/B392. The balance is the one
                number on the page and reads as one: a featured figure in a
                well, the per-channel cost beside it, the flat price as a
                caption. Absent (not zero) when `payment` is undefined — credits
                off, or a reader who is not the owner — `page.tsx` already
                decided, and the component never asks which. The two counts are
                journal-wide, so "up to N" rather than a promise a private
                trip's send would not keep.
              */}
              {/*
                Storage — B664, and its own card rather than a line inside
                Payment. It is about the journal and not about credits, which
                is why it is here when charging is off: an owner still wants to
                know they are nearly full even where nothing is for sale, and
                the cleanup button is the lever that costs nothing. Absent only
                where the instance sets no ceiling, since a bar with no end
                measures nothing.
              */}
              {storage && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/50 text-navy-900">
                      <HardDrive className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.storageTitle")}
                    </h3>
                  </div>

                  <p className="mt-4 text-base text-navy-900">
                    {t("me.storageUsed", { used: storage.used, limit: storage.limit ?? "" })}
                  </p>
                  {storage.percent !== null && storage.percent >= 90 && (
                    <p className="mt-1 text-sm leading-6 text-coral-600">
                      {t("me.storageNearlyFull")}
                    </p>
                  )}

                  <StorageBar rows={storage.rows} />

                  {/*
                    Nothing to say when there is nothing to do. The empty state
                    used to be a sentence explaining that no photobooks or
                    postcard sheets were taking space — which is a paragraph
                    about a button that is not there, on a card whose one job
                    is to be read at a glance. A journal with nothing to
                    reclaim is the ordinary case, so the ordinary case is now
                    silent and the rule stays only where it separates
                    something.
                  */}
                  {(storage.reclaimable.files > 0 || storage.canBuy) && (
                    <div className="mt-5 border-t border-navy-200 pt-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {storage.reclaimable.files > 0 && (
                          <CleanupButton username={username} reclaimable={storage.reclaimable} />
                        )}
                        {storage.canBuy && <BuyStorageButton username={username} />}
                      </div>
                      {storage.reclaimable.files > 0 && (
                        <p className="mt-2 text-sm leading-6 text-navy-600">
                          {t("me.storageCleanupBody")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {payment && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/50 text-navy-900">
                      <Wallet className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.paymentTitle")}
                    </h3>
                  </div>

                  <div className="mt-4 sm:flex sm:items-stretch sm:gap-4">
                    <div className="flex flex-col justify-center rounded-xl border border-navy-200 bg-cream-50 px-5 py-4 sm:w-44 sm:shrink-0">
                      <span className="font-display text-4xl font-semibold tabular-nums tracking-tight text-navy-900">
                        {payment.balance}
                      </span>
                      <span className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-navy-600">
                        {tn("me.paymentUnit", payment.balance)}
                      </span>
                      {payment.balance === 0 && (
                        <span className="mt-2 text-sm leading-6 text-coral-600">
                          {t("me.paymentBalanceEmpty")}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 sm:mt-0 sm:flex-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">
                        {t("me.paymentEstimateTitle")}
                      </p>
                      {/*
                        A list rather than a table — B413 asked for the billing
                        to be plain and got columns; B471 took the columns back
                        out. Four things per row under three headings is a table
                        that does not fit a phone: "Aktive Empfänger" wrapped to
                        two lines and the switch wrapped under the channel's
                        name, so the two rows were different heights and neither
                        lined up with its own numbers.

                        Nothing is compared down a column here — there are two
                        rows and what the owner reads is each against the total
                        under it — so a table was buying headings and paying for
                        them in width.

                        One row per channel the server can actually offer. A
                        muted channel keeps its row, greyed and costing nothing,
                        because the owner muted it and can put it back; a
                        channel this server has no transport for has no row,
                        because nothing here would change that.
                      */}
                      <ul className="mt-2 border-t border-navy-200">
                        {CHANNELS.map(({ key, icon: Icon, labelKey, recipients }) => {
                          const on = payment.channels[key];
                          if (on === null) return null;
                          return (
                            <li
                              className="flex items-center justify-between gap-3 border-b border-navy-200 py-2.5"
                              key={key}
                            >
                              <div className="min-w-0">
                                <span className="flex items-center gap-2 text-base text-navy-900">
                                  <Icon
                                    className="h-4 w-4 shrink-0 text-navy-600"
                                    aria-hidden="true"
                                  />
                                  {t(labelKey)}
                                </span>
                                {/* What it would reach and what that costs, in
                                    the quiet grey: the headings are gone, so
                                    the count carries its own noun and the
                                    credits their own unit. */}
                                <span className="mt-0.5 block text-sm text-navy-500">
                                  {tn("me.paymentUpTo", recipients, {
                                    count: String(recipients),
                                  })}
                                  {" · "}
                                  <span className={on ? "font-semibold text-navy-900" : undefined}>
                                    {on ? recipients : 0} {tn("me.paymentUnit", on ? recipients : 0)}
                                  </span>
                                </span>
                              </div>
                              <ChannelSwitch
                                username={username}
                                channel={key}
                                label={t(labelKey)}
                                enabled={on}
                              />
                            </li>
                          );
                        })}
                      </ul>
                      {/*
                        The number the owner actually came for, and the one
                        thing the card used to make them work out themselves:
                        what publishing a day costs right now. Directly under
                        the switches, so muting a channel answers the question
                        in place.
                      */}
                      <p className="flex items-baseline justify-between gap-3 py-2.5 text-base font-semibold text-navy-900">
                        <span>{t("me.paymentDayTotal")}</span>
                        <span className="tabular-nums">{dayCost}</span>
                      </p>
                      <p className="mt-2.5 text-sm leading-6 text-navy-600">
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
                  </div>

                  {/* The dialog posts to the purchase route, which mails
                      the journal's own owner and grants nothing — the only
                      thing that may raise a balance is `grant` in
                      lib/credits.ts, run by hand on the server. */}
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-navy-200 pt-4">
                    <BuyCreditsDialog username={username} />
                  </div>

                  {/*
                    The transaction history — B413. Only when there is one.
                    A pending row is a purchase the owner started and did not
                    finish; it stays a link back to its payment page so it can
                    be paid (or abandoned). Nothing here is a balance change —
                    a paid mock transaction still added no credits.
                  */}
                  {payment.transactions.length > 0 && (
                    <div className="mt-5 border-t border-navy-200 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">
                        {t("me.txHistoryTitle")}
                      </p>
                      <ul className="mt-2 divide-y divide-navy-200">
                        {payment.transactions.map((tx) => (
                          <li key={tx.id} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                              <p className="text-base text-navy-900">
                                {tx.credits} {tn("me.paymentUnit", tx.credits)} · {tx.amount}
                              </p>
                              <p className="text-sm tabular-nums text-navy-600">
                                {tx.createdAt.slice(0, 10)}
                              </p>
                            </div>
                            {tx.status === "paid" ? (
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
                                <Check className="h-4 w-4" aria-hidden="true" />
                                {t("me.txPaid")}
                              </span>
                            ) : tx.status === "requested" ? (
                              <Link
                                href={`${site.base}/payment/${tx.id}`}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-navy-200 bg-cream-50 px-3 py-1 text-sm font-semibold text-navy-700 transition-colors hover:border-navy-500"
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

              {/*
                The door for people — B79/B282. This is a button that leads to
                the contacts panel, where links are made, listed, revoked and
                re-sent; the URL is not minted here, because a link this page
                could not show you again is a link that vanishes on the next
                navigation. Absent rather than disabled — B74 — when the journal
                has contacts off and therefore no queue for a redemption to land
                in.
              */}
              {contactsEnabled && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                      <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.peopleTitle")}
                    </h3>
                  </div>
                  <p className="mt-3 text-base leading-7 text-navy-700">{t("me.peopleBody")}</p>
                  <Link
                    href={`${site.base}/contacts`}
                    className="mt-4 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                  >
                    {t("me.contacts")}
                  </Link>
                </div>
              )}
              {analyticsEnabled && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                      <ChartNoAxesColumn className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.visitorsTitle")}
                    </h3>
                  </div>
                  <p className="mt-3 text-base leading-7 text-navy-700">{t("me.visitorsBody")}</p>
                  <Link
                    href={`${site.base}/me/analytics`}
                    className="mt-4 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                  >
                    {t("me.visitors")}
                  </Link>
                </div>
              )}
            </div>
          </section>
        )}

        {/*
          The guide that fits who this reader actually is — B445.

          `/<user>/me` is where somebody lands when they are not sure what they
          have here, so the link is aimed rather than generic: an owner is sent
          the owner's guide, somebody who was on a trip the buddy one, and
          everybody else the reader's. A menu of three would make a confused
          person choose before they know which one they are.
        */}
        <p className="mt-8">
          <Link
            href={`/docs/guide/${viewer.owner ? "creator" : writableTrips.length > 0 ? "buddy" : "guest"}`}
            className="text-base text-navy-700 underline decoration-navy-300 underline-offset-4
                       transition-colors hover:decoration-navy-700
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t("guides.readMore")}
          </Link>
        </p>

        {/*
          Where notifications are switched on, for a reader who is not standing
          on a trip's landing step — B439.

          The only other switch is inside `TripHero`, which `TripStory` renders
          on the story's landing step alone: it is gone the moment somebody
          pages into a day, and a reader who resumed where they left off never
          meets it at all. This page is the one that answers "what do I have
          here, and what does it do" — see the panel above — so it is where
          somebody goes looking.

          **The heading is handed to `PushOptIn` rather than written around
          it** — B448. It used to be a `<section>` here with the control
          inside, above a comment claiming the two were conditional on the same
          answer. They were not: the control returns `null` on a browser that
          cannot subscribe and on a journal with push off, and the heading and
          its paragraph stayed — promising notifications "on this device" over
          nothing at all. Only the component knows, so only the component can
          decide, and now it renders both or neither.
        */}
        <PushOptIn
          journal={username}
          heading={{ title: t("me.notifyTitle"), lede: t("me.notifyLede") }}
        />

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
