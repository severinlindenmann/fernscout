"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Coins,
  Eye,
  Folder,
  History,
  MessageCircle,
  MoreVertical,
  RefreshCw,
  Share,
  Smartphone,
  SquarePlus,
  PanelLeftClose,
  PanelRightClose,
  Paperclip,
  Plus,
} from "lucide-react";
import AgentHandover from "@/components/AgentHandover";
import BackLink from "@/components/BackLink";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import CurrencyProvider from "@/components/CurrencyProvider";
import HelperAsk from "@/components/HelperAsk";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import { InboxFileGroups } from "@/components/InboxFileGroups";
import { PhotoPicker } from "@/components/PhotoPicker";
import { DayCard } from "@/components/StoryPager";
import type { Opening as RoomOpeningState } from "@/lib/helper/opening";
import type { RoomFile, RoomFiles } from "@/lib/helper/server";
import type { CurrencyOptions } from "@/lib/rates";
import type { Day, DaySummary } from "@/lib/types";

/** Where the resizable preview column's width is remembered — B1121. Read
 *  once, on mount, and written back on every drag release. */
const PREVIEW_WIDTH_KEY = "fs.agent.previewWidth";
const PREVIEW_MIN = 380;
const PREVIEW_MAX = 440;

/**
 * The room — B901 and B902, round 4 and round 5 of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * The conversation had turns, proposals and a field, and nowhere to *look*.
 * Two things were missing and they are the same missing thing twice: nothing
 * showed what was being talked about, and nothing offered the files a sentence
 * would need to talk about.
 *
 * ```
 * ┌───────────────┬────────────────────────────┬────────────────┐
 * │  FILES        │  CONVERSATION              │  PREVIEW       │
 * │  inbox        │  turns, proposals, field   │  the day card, │
 * │  this trip    │                            │  filling in    │
 * └───────────────┴────────────────────────────┴────────────────┘
 * ```
 *
 * **390px is the design width and the three columns are the wide case.** On a
 * phone the conversation is the whole screen and the other two are summoned
 * rather than laid out beside it — both as the same modal `<dialog>` sheet
 * (`Sheet`, below), opened by a press and closed by its own button. B1121's
 * two-height peek sheet is gone (B1170): it rose by itself the moment the
 * conversation named a day, inserted 112px into the layout flow under the
 * composer, and could never be dismissed. `showModal()` is what makes the
 * dialogs reachable rather than merely present: the platform's own modal
 * moves focus in, makes the rest of the page inert, closes on Escape and
 * puts focus back on the button that opened it.
 *
 * **On a laptop the same two panes are rails now, not a hide/show pair of
 * sentence buttons in the header — B1121.** Both collapse to about 40px at
 * their own edge (`FilesRail`, `PreviewColumn`) rather than vanishing
 * outright, so the way back is always in the same place. The preview also
 * grew, from a fixed 320px to 380–440px, and takes a drag handle on its own
 * left edge; its width is kept in `localStorage` across visits. The top
 * bar's right side is down to exactly two icons — a clock opening a history
 * panel (B1121 builds the shell; B1109 owns its contents) and one accent
 * button starting a new conversation.
 *
 * **Since B1016 nothing above the conversation opens either pane.** A header
 * row with two pills was chrome for things that are local: a preview is
 * about the one day a turn just named, so `HelperAsk` draws a small card
 * inside that turn (`DayChip`) and its press is what opens the preview now —
 * `onPreview`, below. Files are picked up beside the field that is about to
 * mention them, so they are a slim strip above the composer (`FilesStrip`)
 * rather than a button above the whole screen; a tap still opens the same
 * `<dialog>` `FilesPane` always has.
 *
 * **Both panes are additions and neither is a requirement.** With the files
 * pane hidden and the preview empty this is exactly the conversation B899 and
 * B900 built: `HelperAsk` takes `selected` and `onSubject` as optional props
 * and behaves identically without them, which is why it is still the same
 * component under a journal's day card.
 *
 * **Nothing here decides anything.** The pane sends ids; the server resolves
 * them against disk (`describeSelection`). The preview draws the day the
 * conversation named, from the same `GET /api/helper/<user>/day` the wizard
 * reads — the real `DayCard` with the real props, so what is wrong here is
 * wrong on the site.
 *
 * **Since B984 the files pane can also add a photograph, not only offer one.**
 * `UploadPanel`, below `FilesPane`, is `PhotoPicker` and `uploadQueue.ts` —
 * unchanged from the wizard's own use of both — aimed at whichever day the
 * conversation is about. That is the wizard's reason to exist shrinking to
 * nothing rather than a second copy of it: the day the picker writes to is
 * `subject`, the same value `PreviewPane` already reads, so the two can never
 * name different days.
 */

/** What the preview pane is currently about. `at` changes on every mention,
 *  including a second mention of the same day, which is what makes the pane
 *  re-read after a write rather than showing what it read before one. */
type Subject = { trip: string; slug: string; at: number };

type Preview = { day: Day; summary: DaySummary; dayIndex: number };

export default function HelperRoom({
  username,
  title,
  files,
  currency,
  opening,
  history = [],
  first,
  journals = [],
  consented,
  speech,
  consentedSpeech,
  speechProvider,
  whatsappNumber,
  credits = null,
  siteUrl,
  weather = false,
}: {
  username: string;
  /** The journal's own title, so the room says whose it is. */
  title: string;
  /** The pane's contents, read on the server — `filesForRoom`. */
  files: RoomFiles;
  /** What the day card draws money with, the same options the wizard uses. */
  currency: CurrencyOptions;
  /** The day a person arrived from (`?about=`, B994) — the one case the
   *  preview opens with something in it. Every other arrival starts with no
   *  subject: the conversation's own opening says what is waiting. B1170. */
  opening: { trip: string; slug: string } | null;
  /**
   * A conversation reopened by URL — B984, drawn from what was stored.
   *
   * **Reopening is resuming now** — B1168. The page adopts the stored
   * session into the live thread, so the next sentence continues exactly
   * the conversation on the screen and is recorded under it.
   */
  history?: { created_at: string; said: string | null; answered: string | null; origin?: string | null }[];
  /** What the room says before anybody has said anything — B984. Named apart
   *  from `opening` above, which is the *preview's* day: two different first
   *  things, and one of them is a sentence. */
  first: RoomOpeningState;
  /** Every journal this person owns — for the switcher, and only drawn when
   *  there is more than one to switch between. */
  journals?: { username: string; title: string }[];
  consented: boolean;
  speech: boolean;
  consentedSpeech: boolean;
  speechProvider: string;
  /** The wa.me number to chip in the opening — B1127. Only ever present when
   *  the server has already checked both gating facts (a proven number,
   *  `whatsappInbound` on for this journal); absent means the chip is
   *  simply not drawn. */
  whatsappNumber?: string;
  /** The journal's credit balance, or `null` when this instance charges for
   *  nothing — then no chip is drawn at all. B1208 (D06). */
  credits?: number | null;
  /** This instance's public base URL, for the handover prompt — B1210. */
  siteUrl: string;
  /** Whether the `weather` capability is on for this journal — B1218 (D48):
   *  threaded to `HelperAsk` unchanged, which is where it decides whether
   *  the follow-up chip after a words write may offer a lookup at all. */
  weather?: boolean;
}) {
  const { t, tn } = useI18n();

  const [selected, setSelected] = useState<string[]>([]);
  /**
   * The pane's own copy of what is waiting — B915.
   *
   * It arrives from the server (`filesForRoom`) and shrinks here: a
   * photograph that has been put on a day has left the inbox, and a tile that
   * went on offering it would be offering a file that is no longer there.
   * Nothing else about the pane is decided in the browser — this is a removal
   * the server has already made, echoed rather than guessed.
   */
  const [inbox, setInbox] = useState(files.inbox);
  const [subject, setSubject] = useState<Subject | null>(
    opening ? { ...opening, at: 0 } : null,
  );
  /** Whether the field in `HelperAsk` has focus — B1016. The files strip
   *  collapses while it does: the arithmetic in B1016 is what is left of a
   *  390 × 844 phone with the keyboard up, and there is not room for both. */
  const [fieldFocused, setFieldFocused] = useState(false);
  /** Where the desktop preview column is, so an inline card's press can
   *  scroll to it rather than opening the phone's full-screen sheet over a
   *  layout that already has room for the preview — B1016. */
  const previewRef = useRef<HTMLElement>(null);
  const [scrollTick, setScrollTick] = useState(0);
  useEffect(() => {
    if (scrollTick > 0) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollTick]);
  /** The last answer that came back, and which mention it answered. Kept as
   *  one value rather than as a card and a flag: "still reading" is then a
   *  comparison instead of a second piece of state to keep in step — and the
   *  card that is already up stays up while the next read is in flight, so a
   *  day being written does not blink out between two words. */
  const [landed, setLanded] = useState<{ at: number; preview: Preview | null } | null>(null);
  const preview = landed?.preview ?? null;
  const reading = subject !== null && landed?.at !== subject.at;

  /** The one photograph a turn's inline card is allowed to show without a
   *  fetch of its own — B1016. Named to the exact day it is a read of, so a
   *  card about a different day draws a marker instead of somebody else's
   *  photograph. */
  const dayPhoto =
    subject && preview
      ? { trip: subject.trip, slug: subject.slug, src: preview.day.lead.gallery[0]?.src ?? null }
      : null;

  // Desktop only: two rails a person can collapse. The conversation never
  // moves, which is the point of collapsing either.
  /**
   * The files rail collapses to about 40px **when there is nothing in it** —
   * B947, carried over from the old show/hide toggle into the new rail —
   * A designer on a laptop: it held 256px of muted placeholder on a journal
   * with an empty inbox, never changed shape, and took that width from the
   * conversation, which is the pane that matters. Her own cut, asked which
   * one thing she would remove.
   *
   * Not hidden any more — B1121 makes the rail a permanent 40px strip with a
   * count badge, so there is always a way back to it without a header
   * button. What changes is which width a person with nothing to attach
   * starts at.
   */
  const [filesCollapsed, setFilesCollapsed] = useState(
    !(files.inbox.length > 0 || files.trip.length > 0),
  );
  /**
   * Closed until there is something to look at — B1320, the owner's own
   * revision of D24: an open column holding an empty-state sentence was
   * dead space on every arrival. It opens itself the first time the
   * preview actually has content; after a manual close it stays closed
   * (the dot says something new arrived) until a deliberate open or a
   * pressed day chip. Nothing is remembered across visits any more —
   * closed-when-empty is the memory.
   */
  const [previewCollapsed, setPreviewCollapsed] = useState(true);
  const manuallyClosed = useRef(false);
  function togglePreviewCollapsed() {
    setPreviewCollapsed((was) => {
      manuallyClosed.current = !was;
      return !was;
    });
    setPreviewUnseen(false);
  }
  /** The preview column's width, 380–440px, dragged from its own edge and
   *  kept across visits — B1121. Read once, lazily, so a server render and a
   *  browser with nothing stored both land on the same default. */
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_MIN);
  /**
   * The stored width is applied after mount, never in the initializer —
   * B1197. The server renders the default, and at hydration the
   * server-rendered inline style wins over a client initializer's value,
   * so a width read there was stored faithfully and never applied: a
   * reload always snapped back to 380px, found by a persona who had just
   * resized it. The same storage-in-initializer trap the photobook
   * composer hit (B603).
   */
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(PREVIEW_WIDTH_KEY));
    // The same disable CurrencyProvider carries for the same shape: there is
    // no event to wait for — the stored value exists only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored >= PREVIEW_MIN && stored <= PREVIEW_MAX) setPreviewWidth(stored);
  }, []);
  /**
   * The divider's own drag, tracked through pointer capture rather than a
   * pair of `window` listeners — the same shape `PostcardCropper.tsx` already
   * uses. `setPointerCapture` keeps delivering `pointermove`/`pointerup` to
   * the divider even once the pointer has left it, so nothing has to be added
   * to or removed from `window` at all — and with it goes the whole class of
   * bug where a handler added at drag-start closes over a `previewWidth`
   * that is already stale by the time the pointer lifts.
   */
  const resizeStart = useRef<{ startX: number; startWidth: number } | null>(null);
  function onResizeDown(event: React.PointerEvent) {
    resizeStart.current = { startX: event.clientX, startWidth: previewWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onResizeMove(event: React.PointerEvent) {
    const drag = resizeStart.current;
    if (!drag) return;
    // The column sits to the right of the divider, so dragging left (a
    // shrinking `clientX`) is what grows it.
    const delta = drag.startX - event.clientX;
    setPreviewWidth(Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, drag.startWidth + delta)));
  }
  function onResizeUp() {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    window.localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth));
  }

  /**
   * `?c=new` must not outlive its press — B1178. The + button lands here
   * with it, and left in the address bar a reload (or a bookmark of it)
   * would draw the room blank forever while a live thread answered
   * invisibly underneath. Replaced, not pushed: there is no state a Back
   * press should return to a blank room for.
   */
  useEffect(() => {
    const params =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    // `about` for the same reason — B994: left in the bar, a reload would
    // forget the conversation it had just started and start another.
    if (params && (params.get("c") === "new" || params.get("about"))) {
      window.history.replaceState(null, "", "/agent");
    }
  }, []);

  // The one panel that opens over the conversation at any width — B1121.
  // Its contents are B1109's; this ticket builds the button and an empty
  // shell that says so.
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The account sheet (balance, month, storage) — B1208 (D07/D09). */
  const [accountOpen, setAccountOpen] = useState(false);
  /**
   * The version chip — B1361 (F03 A). The service worker updates only on
   * the next launch, so the installed PWA keeps running an old build with
   * nothing saying so. The room remembers the server's build id from its
   * first health read and re-asks whenever the app comes back to the
   * foreground; a different answer draws one quiet reload chip. Unsent
   * words survive the reload — the draft is stored on every keystroke.
   */
  const [updateReady, setUpdateReady] = useState(false);
  const firstCommit = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    const check = async () => {
      const body = (await fetch("/api/health")
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null)) as { commit?: string | null } | null;
      const commit = body?.commit ?? null;
      if (!live || !commit) return;
      if (firstCommit.current === null) firstCommit.current = commit;
      else if (commit !== firstCommit.current) setUpdateReady(true);
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  /** The Darstellung sheet — B1340 (E01 A): display settings left the
   *  credits sheet, so its label tells the truth again. */
  const [displayOpen, setDisplayOpen] = useState(false);
  /**
   * The phone's own navigation — B1215 (D39): a bottom tab bar, Chat ·
   * Dateien · Vorschau, replacing the summoned sheets as the way to the
   * panes. Desktop ignores it entirely (`lg:` keeps the rails).
   */
  const [tab, setTab] = useState<"chat" | "files" | "preview">("chat");
  /**
   * A short pulse on the preview when an accepted write changed the day —
   * B1214 (D27, the coarse half: the card pulses and scrolls to top; a
   * per-passage diff was deliberately not built). Keyed by time so two
   * writes in a row pulse twice.
   */
  const [pulse, setPulse] = useState(0);
  const lastDayText = useRef<string>("");
  useEffect(() => {
    if (!preview) return;
    // The column opens itself the moment there is a day to show — B1320 —
    // unless the person closed it by hand, in which case the dot carries
    // the news instead.
    if (!manuallyClosed.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewCollapsed(false);
    }
    const text = `${preview.day.lead.title}\n${preview.day.lead.content ?? ""}`;
    if (lastDayText.current && lastDayText.current !== text) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPulse(Date.now());
    }
    lastDayText.current = text;
  }, [preview]);

  /**
   * Three keyboard shortcuts and a card that lists them — B1220 (D42).
   * ⌘/Ctrl+K starts fresh, ⌘/ focuses the field, "?" (outside the field)
   * opens the cheatsheet; Esc already closes every dialog through the
   * platform's own <dialog> behaviour.
   */
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const inField =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        void newConversation();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        document.getElementById(`ask-${username}`)?.focus();
      } else if (event.key === "?" && !inField) {
        setCheatsheetOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  /**
   * One dismissible install hint, from the second visit — B1220 (D40).
   * Never inside a standalone display (already installed), never again
   * once dismissed. Phone-only (`lg:hidden` on the row, B1334 round 2):
   * on a desktop the browser installs from its own omnibox icon, not a
   * share menu, so the sentence was simply untrue there.
   */
  const [installHint, setInstallHint] = useState(false);
  const [installHowOpen, setInstallHowOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return;
      if (window.localStorage.getItem("fs.agent.installHintDismissed") === "1") return;
      const visits = Number(window.localStorage.getItem("fs.agent.visits") ?? "0") + 1;
      window.localStorage.setItem("fs.agent.visits", String(visits));
      if (visits >= 2) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setInstallHint(true);
      }
    } catch {
      // Storage refused (private mode) — the hint simply never shows.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The bring-your-own-agent sheet — B1210 (D11/D12). */
  const [agentSheetOpen, setAgentSheetOpen] = useState(false);
  /**
   * The two display settings the account sheet holds — B1209 (D03/D04).
   * Read after mount (the storage-in-initializer trap, B1197), written on
   * every change; the classes they map to live in globals.css, scoped to
   * the room.
   */
  const [textScale, setTextScale] = useState<"s" | "m" | "l">("m");
  const [darkRoom, setDarkRoom] = useState(false);
  useEffect(() => {
    const scale = window.localStorage.getItem("fs.agent.textScale");
    if (scale === "s" || scale === "l") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTextScale(scale);
    }
    if (window.localStorage.getItem("fs.agent.dark") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDarkRoom(true);
    }
  }, []);
  function chooseTextScale(next: "s" | "m" | "l") {
    setTextScale(next);
    window.localStorage.setItem("fs.agent.textScale", next);
  }
  function chooseDark(next: boolean) {
    setDarkRoom(next);
    window.localStorage.setItem("fs.agent.dark", next ? "1" : "0");
  }

  /** The ⋯ menu holding what left the header — B1208 (D10). */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  /**
   * Low enough to warn — B1208 (D08). A plain conversation turn is free;
   * the writes that charge cost about a credit each (WRITE_DAY_CREDITS),
   * so ten credits is roughly ten more days of writing.
   */
  const lowCredits = credits !== null && credits <= 10;

  /**
   * Phone only: the files dialog, and the preview's own sheet — both plain
   * open/closed now. The preview used to *peek* by itself the moment the
   * conversation named a day (B1121), inserting 112px into the layout flow
   * and pushing the composer up as a side effect of a model answer — and it
   * could never be dismissed back to hidden. B1170: it opens on a press (a
   * turn's day chip), closes on its own button, and nothing on the phone
   * layout appears without being asked for. The day chip in the turn stays
   * as the way back in.
   */

  /** A turn named a day while the desktop preview rail was collapsed — the
   *  rail shows a dot instead of opening itself. B1170. */
  const [previewUnseen, setPreviewUnseen] = useState(false);

  /**
   * The day, re-read whenever the conversation names one.
   *
   * `GET` only, and the same read the wizard makes; a failed read leaves the
   * pane empty and says nothing, because a preview is a courtesy and not a
   * claim — the conversation has already said what happened.
   */
  useEffect(() => {
    if (!subject) return;
    let live = true;
    const at = subject.at;
    fetch(
      `/api/helper/${encodeURIComponent(username)}/day?trip=${encodeURIComponent(subject.trip)}&slug=${encodeURIComponent(subject.slug)}`,
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { preview?: Preview } | null) => {
        if (live) setLanded({ at, preview: body?.preview ?? null });
      })
      .catch(() => {
        if (live) setLanded({ at, preview: null });
      });
    return () => {
      live = false;
    };
  }, [username, subject]);

  function toggle(id: string) {
    setSelected((was) => (was.includes(id) ? was.filter((one) => one !== id) : [...was, id]));
  }

  /**
   * Files arriving by drop or paste land in the inbox — B1216 (D29/D30).
   * The same door the pane's picker uses; the answer's stored descriptors
   * become tiles at once, exactly as `UploadPanel` echoes them.
   */
  const [dropping, setDropping] = useState(false);
  /** How many files just landed while a day was on the table — drawn as
   *  one attach-nudge chip. B1216 (D32). */
  const [nudgeCount, setNudgeCount] = useState(0);
  const dragDepth = useRef(0);
  /** In-flight tiles for the drop/paste path — B1216 (D31): thumbnails
   *  appear at once with a ring, replaced by the stored tiles when the
   *  route answers. (The picker path keeps its own status line.) */
  const [pending, setPending] = useState<{ key: string; url: string | null }[]>([]);
  async function sendToInbox(files: File[]) {
    if (files.length === 0) return;
    const stamp = Date.now();
    setPending(
      files.map((file, n) => ({
        key: `${stamp}-${n}`,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })),
    );
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const response = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, {
      method: "POST",
      body: form,
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as
      | { items?: { id: string; filename: string; kind: RoomFile["kind"]; bytes: number; uploadedAt: string }[] }
      | null;
    setPending((was) => {
      for (const one of was) if (one.url) URL.revokeObjectURL(one.url);
      return [];
    });
    if (!response?.ok || !body?.items) return;
    if (subject) setNudgeCount(body.items.length);
    setInbox((was) => [
      ...body.items!.map((item) => ({
        id: `inbox:${item.id}`,
        name: item.filename,
        src:
          item.kind === "media"
            ? `/api/helper/${encodeURIComponent(username)}/inbox/${encodeURIComponent(item.id)}/thumbnail`
            : undefined,
        kind: item.kind,
        bytes: item.bytes,
        uploadedAt: item.uploadedAt,
      })),
      ...was,
    ]);
  }
  useEffect(() => {
    // Whole-window handlers: the room is the drop target (D29), and ⌘V
    // with an image lands it too (D30). Files only — dragging text or a
    // link changes nothing.
    function hasFiles(event: DragEvent) {
      return [...(event.dataTransfer?.types ?? [])].includes("Files");
    }
    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      dragDepth.current += 1;
      setDropping(true);
    }
    function onDragLeave() {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropping(false);
    }
    function onDragOver(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDropping(false);
      void sendToInbox([...(event.dataTransfer?.files ?? [])]);
    }
    function onPaste(event: ClipboardEvent) {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length > 0) void sendToInbox(files);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  /**
   * A turn injected from outside the conversation — B1214 (D26): the
   * preview header's "Put this day on the site" fetches the same
   * publish_day proposal the model would draw, and this is how the card
   * reaches the thread. Publishing itself still happens only on the
   * card's own press, in the conversation, exactly as everywhere else.
   */
  const [injected, setInjected] = useState<{ blocks: unknown[]; at: number } | null>(null);
  /**
   * Fetch one tool's proposal and put its card in the thread — the shared
   * mechanism behind the preview's publish shortcut (B1214), the attach
   * nudge and the tile menu (B1216). Every write still happens only on
   * the card's own press, in the conversation.
   */
  function proposeToThread(tool: string, args: Record<string, string>) {
    void (async () => {
      const response = await fetch(`/api/helper/${encodeURIComponent(username)}/proposal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool, arguments: args, today: new Date().toISOString().slice(0, 10) }),
      }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as { blocks?: unknown[] } | null;
      if (body?.blocks?.length) {
        setInjected({ blocks: body.blocks, at: Date.now() });
        setTab("chat");
      }
    })();
  }
  /** The nudge chip's press — B1216 (D32): everything waiting, proposed by
   *  name (B1189's fallback is what makes one press safe). */
  function askNudge() {
    if (subject) proposeToThread("attach_files", { trip: subject.trip, slug: subject.slug });
  }
  function publishFromPreview() {
    if (subject) proposeToThread("publish_day", { trip: subject.trip, slug: subject.slug });
  }

  const filesPane = (
    <>
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" aria-hidden>
          {pending.map((one) => (
            <span
              key={one.key}
              className="relative block h-12 w-12 overflow-hidden rounded-lg border border-navy-200 bg-navy-50"
            >
              {one.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={one.url} alt="" className="h-full w-full object-cover opacity-60" />
              )}
              <span className="absolute inset-0 m-auto h-5 w-5 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
            </span>
          ))}
        </div>
      )}
    <FilesPane
      files={{ ...files, inbox }}
      selected={selected}
      onToggle={toggle}
      onClear={() => setSelected([])}
      username={username}
      // What the pane's own upload just put in the inbox — B1171. Prepended,
      // because newest-first is the pane's own order, and echoed here rather
      // than re-fetched: the route answered with exactly what it stored.
      subject={subject}
      onProposal={proposeToThread}
      onInboxAdded={(added) => {
        setInbox((was) => [...added, ...was]);
        // One chip over the composer when a day is under discussion —
        // B1216 (D32): a shortcut for the sentence, through the ordinary
        // confirm; sending anything clears it.
        if (subject) setNudgeCount(added.length);
      }}
    />
    <StorageLine username={username} refresh={inbox.length} />
    </>
  );

  const previewPane = (
    <>
      {/* A real header for the pane — B1214 (D25): the day it shows, the
          way onto the site for a published day, and for a draft the
          publish shortcut that opens the ordinary confirm card in the
          conversation (D26). */}
      {preview && subject && (
        <div className="mb-2 flex items-center gap-2 border-b border-navy-100 pb-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-navy-900">
              {preview.day.lead.title || preview.day.lead.date}
            </p>
            <p className="text-xs text-navy-500">{preview.day.lead.date}</p>
          </div>
          {preview.day.lead.draft ? (
            <button
              type="button"
              onClick={publishFromPreview}
              className="shrink-0 rounded-full border border-navy-300 bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 transition-colors hover:bg-navy-50"
            >
              {t("agent.about.publish")}
            </button>
          ) : (
            <a
              href={`/${encodeURIComponent(username)}/trips/${encodeURIComponent(subject.trip)}/day/${encodeURIComponent(subject.slug)}`}
              className="shrink-0 text-xs font-semibold text-navy-700 underline underline-offset-4 hover:text-navy-900"
            >
              {t("agent.room.openOnSite")}
            </a>
          )}
        </div>
      )}
      <div key={pulse || undefined} className={pulse ? "fs-pulse" : undefined}>
        <PreviewPane preview={preview} reading={reading} currency={currency} />
      </div>
    </>
  );

  const filesStrip = (
    <FilesStrip
      files={{ ...files, inbox }}
      selected={selected}
      collapsed={fieldFocused}
      onOpen={() => setTab("files")}
    />
  );

  /**
   * `forget()` and a full navigation — B1121. This is not the "Start over"
   * link inside `HelperAsk` (that one stays; it is what a lapsed session's own
   * panel offers) but the same server call the top bar now makes reachable
   * without scrolling into the composer to find it. A full reload rather than
   * clearing local state by hand is deliberate: `HelperAsk` holds the visible
   * turns and the field, neither of which this file may reach into, so the
   * one honest way to make both start clean is the same round trip the
   * journal switcher above already takes.
   */
  async function newConversation() {
    await fetch(`/api/helper/${encodeURIComponent(username)}/ask`, { method: "DELETE" }).catch(
      () => {
        // A failed forget is not worth blocking on: the worst case is a
        // thread that outlives its clean start, not a start that fails.
      },
    );
    // `?c=new`, not bare `/agent` — B1168. A bare visit resumes whatever is
    // live, which immediately after the DELETE is nothing, but the stored
    // latest used to be redrawn and the press looked like it did nothing.
    // Naming the intent in the URL keeps "new" true however the resume
    // logic evolves.
    window.location.href = "/agent?c=new";
  }

  return (
    // The room is the whole viewport now — B1121 moved the one back link
    // `app/agent/layout.tsx` used to draw above every page here into this
    // header's own left edge, so there is no second frame to subtract.
    // Outer paints the ground edge to edge; inner caps the app at 1680px —
    // B1208 (D43): three panes floating in 2560px of ground looked lost.
    <div
      className={`h-dvh bg-cream-50 ${textScale === "s" ? "fs-scale-s" : textScale === "l" ? "fs-scale-l" : ""} ${
        darkRoom ? "fs-room-dark" : ""
      }`}
    >
    <div className="mx-auto flex h-full max-w-[1680px] flex-col">
      {dropping && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-dashed border-yellow-600 bg-yellow-400/10"
        >
          <p className="rounded-full bg-white px-5 py-2.5 font-display text-base font-semibold text-navy-900 shadow-lg">
            {t("agent.room.dropHere")}
          </p>
        </div>
      )}
      <header className="flex items-center gap-2 border-b border-navy-200 bg-white px-2 py-2">
        {/* "Zurück" moves here — a chevron before the journal name rather
            than its own bar above the whole page — B1121. */}
        <BackLink
          fallbackHref="/"
          fallbackLabel={t("nav.back")}
          retraceLabel={t("nav.back")}
          showLabel={false}
          iconClassName="h-5 w-5"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900"
        />

        {/*
          The journal, and a way to change it only when there is one to change
          to — B984. A switcher on a person with one journal is a control that
          can only tell them what they already know.

          It writes a cookie and reloads: the choice has to survive a visit,
          and it must not go back into the path, which is the whole of what
          this ticket is about.
        */}
        {journals.length > 1 ? (
          // B814 — a switcher here in place of the plain title used to leave
          // the whole page with no heading at all: nothing for a screen
          // reader to jump to, on the one page that is a conversation rather
          // than a document. The `<select>` is still the visible control; this
          // just gives the page back the landing point every other one has.
          <>
            <h1 className="sr-only">{t("agent.room.title")}</h1>
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("agent.room.whichJournal")}</span>
              <select
                value={username}
                onChange={(event) => {
                  document.cookie = `fs.journal=${encodeURIComponent(event.target.value)};path=/;max-age=31536000;samesite=lax`;
                  window.location.href = "/agent";
                }}
                className="min-h-11 w-full truncate rounded-full border border-navy-300 bg-white px-3 font-display text-base font-semibold text-navy-900"
              >
                {journals.map((one) => (
                  <option key={one.username} value={one.username}>
                    {one.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          /**
           * Which journal this conversation edits — B1208 (D53, the owner's
           * own addition). The name links to the journal, and the path
           * ("/alex") rides beside it on wider screens: the one label
           * that is also the address.
           */
          <h1 className="flex min-w-0 flex-1 items-baseline gap-2 truncate">
            <Link
              href={`/${encodeURIComponent(username)}`}
              className="truncate font-display text-base font-semibold text-navy-900 hover:underline"
            >
              {title}
            </Link>
            <Link
              href={`/${encodeURIComponent(username)}`}
              className="hidden shrink-0 font-mono text-xs text-navy-500 hover:text-navy-800 hover:underline sm:inline"
            >
              /{username}
            </Link>
          </h1>
        )}

        {/*
          Everything else that used to live here — two sentence-buttons, then
          two mobile pills (B1016) — is gone. Files and the preview each carry
          their own icon at the edge of the panel they open (`FilesRail`,
          `PreviewColumn`, below); the top right holds exactly two icons now —
          B1121.
        */}
        <div className="flex shrink-0 items-center gap-1">
          {/* The balance, whenever this instance charges at all — B1208
              (D06/D08). Coral once it is low enough to matter; the tap opens
              the account sheet, which is where the buy link lives. */}
          {credits !== null && (
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              aria-label={t("agent.room.account")}
              className={`flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors ${
                lowCredits
                  ? "border-coral-600 bg-coral-600 text-white hover:bg-coral-400"
                  : "border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
              }`}
            >
              <Coins className="h-3.5 w-3.5" aria-hidden />
              {credits.toLocaleString("de-CH", { maximumFractionDigits: 1 })}
            </button>
          )}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label={t("agent.room.history")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900"
          >
            <History className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void newConversation()}
            aria-label={t("agent.room.newConversation")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-yellow-400 text-navy-900 transition-colors hover:bg-yellow-300"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
          {/* What left the header lives here — B1208 (D10): the language
              chip, the account sheet, handing the journal to an agent of
              your own. A plain popover, closed by Escape or a click
              outside. */}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((was) => !was)}
              aria-label={t("agent.room.more")}
              aria-expanded={menuOpen}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900"
            >
              <MoreVertical className="h-5 w-5" aria-hidden />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-navy-200 bg-white p-2 shadow-lg">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-sm text-navy-800">{t("agent.room.language")}</span>
                  <LocaleSwitcher subtle />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDisplayOpen(true);
                  }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-navy-800 hover:bg-navy-50"
                >
                  {t("agent.room.display")}
                </button>
                {credits !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setAccountOpen(true);
                    }}
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-navy-800 hover:bg-navy-50"
                  >
                    {t("agent.room.account")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setAgentSheetOpen(true);
                  }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-navy-800 hover:bg-navy-50"
                >
                  {t("agent.open.bringAgent")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {updateReady && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex min-h-10 w-full shrink-0 items-center justify-center gap-2 border-b border-yellow-600/30 bg-yellow-400/20 px-4 text-sm font-semibold text-navy-800"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t("agent.room.updateReady")}
        </button>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left. Never drawn below `lg`: half a screen of thumbnails beside a
            conversation is the thing this layout is for not doing. */}
        <FilesRail
          collapsed={filesCollapsed}
          onToggleCollapsed={() => setFilesCollapsed((was) => !was)}
          count={files.inbox.length + files.trip.length}
          filesLabel={t("agent.room.files")}
          showLabel={t("agent.room.showFiles")}
          hideLabel={t("agent.room.hideFiles")}
        >
          {filesPane}
        </FilesRail>

        {/* Middle — on a phone, the Chat tab (B1215). The inner wrapper caps
            the reading measure — B1177: at 1440px the column is ~1000px and
            a line of conversation spanned all of it, three times the width
            a paragraph stays readable at. The column keeps its flex width;
            only the content is held to ~65-75 characters. */}
        <main
          className={`min-h-0 flex-1 flex-col px-4 py-3 ${tab === "chat" ? "flex" : "hidden"} lg:flex`}
        >
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <HelperAsk
            username={username}
            consented={consented}
            speech={speech}
            consentedSpeech={consentedSpeech}
            speechProvider={speechProvider}
            inRoom
            opened={history}
            opening={first}
            aboutOffer={opening !== null}
            // The day's own state, once the preview has read it — B1199:
            // the offer must not include taking a draft off the site.
            aboutDraft={preview ? preview.day.lead.draft === true : null}
            injected={injected as { blocks: never[]; at: number } | null}
            whatsappNumber={whatsappNumber}
            weather={weather}
            onProposal={proposeToThread}
            selected={selected}
            onSubject={(day) => {
              setSubject({ ...day, at: Date.now() });
              // The rail says something new is behind it rather than opening
              // itself — B1170.
              if (previewCollapsed) setPreviewUnseen(true);
            }}
            onFilesMoved={(moved) => {
              // The pane's ids carry the `inbox:` prefix; the route answers
              // with the bare ids it moved.
              const gone = new Set(moved.map((id) => `inbox:${id}`));
              setInbox((was) => was.filter((file) => !gone.has(file.id)));
              setSelected((was) => was.filter((id) => !gone.has(id)));
            }}
            dayPhoto={dayPhoto}
            /**
             * A turn's inline card was pressed — B1016. "Look at it" means
             * something different depending on how much screen there is:
             * on a phone the preview's sheet opens (a modal `Sheet`, the
             * same one the files use — B1170 replaced the two-height peek
             * sheet with it); on a wider one the column opens and scrolls
             * into view. `matchMedia` is read defensively — a caller with
             * none (a test) gets the phone's own behaviour, which is the one
             * this ticket is actually about.
             */
            onPreview={(day) => {
              setSubject({ ...day, at: Date.now() });
              setPreviewUnseen(false);
              const desktop =
                typeof window !== "undefined" &&
                typeof window.matchMedia === "function" &&
                window.matchMedia("(min-width: 1024px)").matches;
              if (desktop) {
                manuallyClosed.current = false;
                setPreviewCollapsed(false);
                setScrollTick((n) => n + 1);
              } else {
                // The Vorschau tab, not a sheet — B1215.
                setTab("preview");
              }
            }}
            filesStrip={filesStrip}
            notice={
              nudgeCount > 0 && subject ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNudgeCount(0);
                      // Everything waiting is proposed by name before the
                      // press — B1189's fallback is what makes this one
                      // sentence safe.
                      askNudge();
                    }}
                    className="min-h-9 rounded-full border border-navy-300 bg-white px-3.5 text-sm text-navy-800 transition-colors hover:bg-navy-50"
                  >
                    {tn("agent.room.attachNudge", nudgeCount, { count: String(nudgeCount) })}
                  </button>
                </div>
              ) : lowCredits ? (
                <p className="mb-2 shrink-0 rounded-xl border border-coral-400 bg-coral-50 px-3 py-2 text-sm leading-5 text-coral-600">
                  {t("agent.room.lowCredits")}{" "}
                  <a
                    href={`/${encodeURIComponent(username)}/account#buy`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {t("agent.room.accountBuy")}
                  </a>
                </p>
              ) : undefined
            }
            onOpenFiles={() => setTab("files")}
            onFieldFocusChange={setFieldFocused}
          />

          {/* Bring-your-own-agent lost its footer line in B1327: it was the
              same sheet the ⋯ menu opens, said twice on one screen. The menu
              entry is its one home now. */}
          {installHint && (
            <p className="mx-auto mt-1 flex w-full max-w-md shrink-0 items-center justify-center gap-2 text-center text-xs text-navy-500 lg:hidden">
              <span className="min-w-0">{t("agent.room.installHint")}</span>
              {/* "How?" opens the three steps in a sheet — there is no reader
                  doc page for this, so the sheet is the doc. B1334. */}
              <button
                type="button"
                onClick={() => setInstallHowOpen(true)}
                className="shrink-0 whitespace-nowrap font-semibold text-navy-700 underline underline-offset-2 hover:text-navy-900"
              >
                {t("agent.room.installHow")} →
              </button>
              <button
                type="button"
                onClick={() => {
                  setInstallHint(false);
                  window.localStorage.setItem("fs.agent.installHintDismissed", "1");
                }}
                aria-label={t("agent.room.closeAccount")}
                className="shrink-0 rounded-full px-1.5 text-navy-500 hover:text-navy-800"
              >
                ✕
              </button>
            </p>
          )}
          </div>
        </main>

        {/* Right. */}
        <PreviewColumn
          innerRef={previewRef}
          collapsed={previewCollapsed}
          unseen={previewUnseen}
          onToggleCollapsed={togglePreviewCollapsed}
          width={previewWidth}
          onResizeDown={onResizeDown}
          onResizeMove={onResizeMove}
          onResizeUp={onResizeUp}
          previewLabel={t("agent.room.preview")}
          showLabel={t("agent.room.showPreview")}
          hideLabel={t("agent.room.hidePreview")}
          resizeLabel={t("agent.room.resizePreview")}
        >
          {previewPane}
        </PreviewColumn>

        {/* The phone's two other tabs — B1215 (D39). Full views, not
            sheets: one tap each from the bar below, nothing summoned over
            the conversation. */}
        {tab === "files" && (
          <section
            aria-label={t("agent.room.files")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 lg:hidden"
          >
            {filesPane}
          </section>
        )}
        {tab === "preview" && (
          <section
            aria-label={t("agent.room.preview")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 lg:hidden"
          >
            {previewPane}
          </section>
        )}
      </div>

      {/* The tab bar — B1215 (D39). Chat is the home; the dot on Vorschau
          is the same claim the desktop rail's dot makes. */}
      <nav
        aria-label={t("agent.room.tabs")}
        className="flex shrink-0 border-t border-navy-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {(
          [
            ["chat", t("agent.room.tabChat"), MessageCircle],
            ["files", t("agent.room.files"), Folder],
            ["preview", t("agent.room.preview"), Eye],
          ] as const
        ).map(([which, label, Icon]) => (
          <button
            key={which}
            type="button"
            aria-current={tab === which ? "page" : undefined}
            onClick={() => {
              setTab(which);
              if (which === "preview") setPreviewUnseen(false);
            }}
            className="relative flex min-h-14 flex-1 items-center justify-center px-1 py-2"
          >
            {/* F02 A (B1360): the active tab is a filled yellow pill around
                icon and word; the other two are quiet icon-and-word. */}
            <span
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                tab === which
                  ? "bg-yellow-400 font-semibold text-navy-900"
                  : "text-navy-500"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {label}
            </span>
            {/* A day arrived while the person was on another tab — the
                same claim the desktop rail's dot makes. */}
            {which === "preview" && previewUnseen && tab !== "preview" && (
              <span aria-hidden className="absolute right-3 top-2 h-2 w-2 rounded-full bg-yellow-400" />
            )}
          </button>
        ))}
      </nav>


      {historyOpen && (
        <HistoryPanel
          username={username}
          label={t("agent.room.history")}
          onClose={() => setHistoryOpen(false)}
          onOpenDay={(day) => {
            setSubject({ ...day, at: Date.now() });
            setPreviewUnseen(false);
            setPreviewCollapsed(false);
            setTab("preview");
          }}
        />
      )}

      {accountOpen && (
        <AccountSheet
          username={username}
          label={t("agent.room.account")}
          onClose={() => setAccountOpen(false)}
        />
      )}

      {displayOpen && (
        <Sheet
          label={t("agent.room.display")}
          close={t("agent.room.closeAccount")}
          onClose={() => setDisplayOpen(false)}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-navy-800">{t("agent.room.textSize")}</span>
            <div className="flex gap-1" role="group" aria-label={t("agent.room.textSize")}>
              {(["s", "m", "l"] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={textScale === size}
                  onClick={() => chooseTextScale(size)}
                  className={`min-h-9 min-w-9 rounded-full border text-sm font-semibold transition-colors ${
                    textScale === size
                      ? "border-navy-800 bg-navy-800 text-white"
                      : "border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
                  }`}
                >
                  {size.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm text-navy-800">{t("agent.room.darkRoom")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={darkRoom}
              onClick={() => chooseDark(!darkRoom)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                darkRoom ? "bg-navy-800" : "bg-navy-200"
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  darkRoom ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </Sheet>
      )}

      {cheatsheetOpen && (
        <Sheet
          label={t("agent.room.shortcuts")}
          close={t("agent.room.closeAccount")}
          onClose={() => setCheatsheetOpen(false)}
        >
          <ul className="space-y-2 text-sm text-navy-800">
            <li className="flex items-center justify-between gap-3">
              <span>{t("agent.room.newConversation")}</span>
              <kbd className="rounded border border-navy-300 px-1.5 font-mono text-xs">⌘K</kbd>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span>{t("agent.room.focusField")}</span>
              <kbd className="rounded border border-navy-300 px-1.5 font-mono text-xs">⌘/</kbd>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span>{t("agent.room.closePanels")}</span>
              <kbd className="rounded border border-navy-300 px-1.5 font-mono text-xs">Esc</kbd>
            </li>
          </ul>
        </Sheet>
      )}

      {installHowOpen && (
        <Sheet
          label={t("agent.room.installTitle")}
          close={t("agent.room.closeAccount")}
          onClose={() => setInstallHowOpen(false)}
        >
          <p className="mb-3 text-sm leading-6 text-navy-700">{t("agent.room.installHint")}</p>
          <ol className="space-y-3.5">
            {(
              [
                [Share, t("agent.room.installStep1")],
                [SquarePlus, t("agent.room.installStep2")],
                [Smartphone, t("agent.room.installStep3")],
              ] as const
            ).map(([Icon, label], index) => (
              <li key={index} className="flex items-center gap-3 text-sm text-navy-700">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream-100 text-navy-600">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ol>
        </Sheet>
      )}

      {agentSheetOpen && (
        <Sheet
          label={t("agent.open.bringAgent")}
          close={t("agent.room.closeAccount")}
          onClose={() => setAgentSheetOpen(false)}
        >
          {/* The same block /me renders — one implementation of minting and
              the prompt, two homes. B1210 (D12). */}
          <p className="mb-3 text-sm leading-6 text-navy-700">{t("agent.room.bringAgentIntro")}</p>
          <AgentHandover username={username} siteUrl={siteUrl} />
          <p className="mt-4 border-t border-navy-200 pt-3">
            <a
              href={`/${encodeURIComponent(username)}/me`}
              className="text-sm text-navy-600 underline underline-offset-4 hover:text-navy-900"
            >
              {t("agent.room.bringAgentMore")}
            </a>
          </p>
        </Sheet>
      )}
    </div>
    </div>
  );
}

/**
 * One thing over the conversation, on a phone — the files sheet and the
 * full-screen preview are the same object with different contents.
 *
 * A real `<dialog>`, opened with `showModal()`, for everything it gives for
 * nothing: focus moves in, the page behind goes inert, Escape closes it, and
 * focus returns to the button that opened it. The one obvious way back is a
 * button as well, because Escape is not a way back on a telephone.
 */
function Sheet({
  label,
  close,
  onClose,
  children,
}: {
  label: string;
  close: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  /** The platform's own close where there is one — that is what restores
   *  focus to the button that opened this, and it is why `onClose` rather
   *  than the click is what unmounts. jsdom implements neither `showModal`
   *  nor `close`, so a test drives the same exit directly. */
  const dismiss = () =>
    dialog.current?.close ? dialog.current.close() : onClose();

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={onClose}
      className="m-0 flex w-full max-w-none flex-col border-0 bg-white p-0 backdrop:bg-navy-900/40 fixed inset-x-0 bottom-0 top-auto h-auto max-h-[92dvh] rounded-t-2xl lg:mx-auto lg:max-h-[80dvh] lg:max-w-xl"
    >
      <div className="flex items-center gap-3 border-b border-navy-200 px-4 py-2">
        {/* The handle, and it is the button: a bar somebody can only drag is a
            bar a keyboard cannot reach. Dragging it is not built — a tap
            closes, and so does Escape. */}
        <span aria-hidden className="h-1 w-10 rounded-full bg-navy-200" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-900">{label}</p>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 shrink-0 text-sm font-semibold text-navy-800 underline underline-offset-4"
        >
          {close}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
    </dialog>
  );
}

/**
 * The files, on a laptop, as a rail rather than a hide/show pair of sentence
 * buttons in the header — B1121.
 *
 * Collapsed is now a permanent ~40px strip carrying its own icon and a count
 * badge, never gone entirely: the toggle used to live in the header either
 * way, so this only moves it onto the edge of the thing it opens. A laptop
 * with nothing waiting starts collapsed (`filesCollapsed` in the room, B947's
 * reasoning carried over); one with something in it starts open.
 */
function FilesRail({
  collapsed,
  onToggleCollapsed,
  count,
  filesLabel,
  showLabel,
  hideLabel,
  children,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Everything in the rail, waiting or already on the trip — not the
   *  selection, which has its own live region inside `children`. */
  count: number;
  filesLabel: string;
  showLabel: string;
  hideLabel: string;
  children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={count > 0 ? `${filesLabel} (${count})` : filesLabel}
        title={showLabel}
        className="hidden w-10 shrink-0 flex-col items-center gap-1 border-r border-navy-200 bg-white py-3 lg:flex"
      >
        <Paperclip className="h-5 w-5 text-navy-700" aria-hidden />
        {count > 0 && (
          <span
            aria-hidden
            className="min-w-[18px] rounded-full bg-navy-800 px-1 text-center text-[10px] font-semibold leading-[18px] text-cream-50"
          >
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <section
      aria-label={filesLabel}
      className="hidden min-h-0 w-64 shrink-0 flex-col border-r border-navy-200 bg-white lg:flex"
    >
      <div className="flex shrink-0 justify-end border-b border-navy-200 p-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={hideLabel}
          title={hideLabel}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900"
        >
          <PanelLeftClose className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
    </section>
  );
}

/**
 * The preview, on a laptop — B1121. Grown from a fixed 320px column to
 * 380–440px, resizable from its own left edge, and collapsible from an icon
 * at that same edge rather than a sentence button in the header.
 *
 * The drag handle is a `role="separator"`, not a `<button>`: a `<div>` taking
 * pointer capture is what lets the room own the drag (`onResizeDown`/`Move`/
 * `Up`, tracked in `HelperRoom` itself, since a divider between two columns
 * is shared state a leaf component should not hold alone) while a keyboard
 * user still reaches the collapse button beside it, which is the operable
 * control for anyone who cannot drag.
 */
function PreviewColumn({
  innerRef,
  collapsed,
  unseen,
  onToggleCollapsed,
  width,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  previewLabel,
  showLabel,
  hideLabel,
  resizeLabel,
  children,
}: {
  innerRef: React.RefObject<HTMLElement | null>;
  collapsed: boolean;
  /** A turn named a day while this rail was collapsed — drawn as a dot, so
   *  the rail says there is something new without opening itself. B1170. */
  unseen: boolean;
  onToggleCollapsed: () => void;
  width: number;
  onResizeDown: (event: React.PointerEvent) => void;
  onResizeMove: (event: React.PointerEvent) => void;
  onResizeUp: (event: React.PointerEvent) => void;
  previewLabel: string;
  showLabel: string;
  hideLabel: string;
  resizeLabel: string;
  children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={showLabel}
        title={showLabel}
        className="hidden w-10 shrink-0 flex-col items-center gap-1 border-l border-navy-200 bg-white py-3 lg:flex"
      >
        <PanelRightClose className="h-5 w-5 rotate-180 text-navy-700" aria-hidden />
        {unseen && <span aria-hidden className="h-2 w-2 rounded-full bg-yellow-400" />}
      </button>
    );
  }

  return (
    <section
      ref={innerRef}
      aria-label={previewLabel}
      style={{ width: `${width}px` }}
      className="relative hidden min-h-0 shrink-0 flex-col border-l border-navy-200 bg-white lg:flex"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={resizeLabel}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none"
      />
      <div className="flex shrink-0 justify-start border-b border-navy-200 p-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={hideLabel}
          title={hideLabel}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900"
        >
          <PanelRightClose className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
    </section>
  );
}

/** One conversation, as the panel lists it — the same shape `sessionsOf`
 *  answers, read back over `GET /api/helper/<user>/sessions`. */
type SessionRow = { session: string; from: string; to: string; turns: number; opening: string };

/**
 * The clock in the top right, and what it opens — B1121 built the shell;
 * B1109 is what fills it.
 *
 * **A fetch of its own, not a prop.** Every other thing this room draws
 * arrives from the server render that made the page, but a list that changes
 * every time somebody presses "New conversation" would go stale the moment it
 * did if it were a prop instead — so this reads `GET
 * /api/helper/<user>/sessions` itself, once, when the panel opens.
 *
 * **Grouped by the day it started, oldest conversation of a day last** — the
 * same "one thing on a fixed local clock" a person's own calendar draws,
 * using `formatLongDate` rather than `toLocaleDateString` for the reason
 * `HelperConsentList.tsx` gives at length: a server render and a browser must
 * agree on what day it is.
 *
 * **A row is a link, not a button with an `onClick`.** `/agent?c=<session>`
 * is `past_conversations`' own `href` (`lib/helper/tools/areas/journal.ts`)
 * — the same address, so a conversation opened from the model's own list and
 * one opened from this panel land on exactly the same page. A full
 * navigation, matching "New conversation" a few lines above: `HelperAsk`
 * holds the turns on screen and this file may not reach into it, so the one
 * honest way to swap them is the round trip the journal switcher already
 * takes.
 */
/** One day, as the panel's Tage tab lists it — B1217 (D44). */
type PanelDay = { trip: string; slug: string; date: string; title: string; draft: boolean };

function HistoryPanel({
  username,
  label,
  onClose,
  onOpenDay,
}: {
  username: string;
  label: string;
  onClose: () => void;
  /** A Tage row was pressed: the room opens that day in the preview. */
  onOpenDay: (day: { trip: string; slug: string }) => void;
}) {
  const { t, tn, formatLongDate } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);
  const dismiss = () => (dialog.current?.close ? dialog.current.close() : onClose());

  // `null` while loading, `[]` once answered with nothing — two different
  // facts, the same distinction `said`/`answered` draws in the table itself.
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  /** The conversation a next sentence would extend, so its row can say so —
   *  B1168. `null` while loading and when nothing is in progress. */
  const [liveId, setLiveId] = useState<string | null>(null);
  /** Which of the panel's two tabs — B1217 (D44). */
  const [panelTab, setPanelTab] = useState<"history" | "days">("history");
  /** The search words — B1217 (D36). Debounced by the effect below. */
  const [q, setQ] = useState("");
  const [tripDays, setTripDays] = useState<PanelDay[]>([]);
  const [tripTitle, setTripTitle] = useState("");
  useEffect(() => {
    let live = true;
    const load = () => {
      fetch(
        `/api/helper/${encodeURIComponent(username)}/sessions${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            body: {
              sessions?: SessionRow[];
              live?: string | null;
              days?: PanelDay[];
              tripTitle?: string;
            } | null,
          ) => {
            if (live) {
              setSessions(body?.sessions ?? []);
              setLiveId(body?.live ?? null);
              setTripDays(body?.days ?? []);
              setTripTitle(body?.tripTitle ?? "");
            }
          },
        )
        .catch(() => {
          if (live) setSessions([]);
        });
    };
    // Immediate on open; a quarter-second of quiet while typing a search.
    const timer = q === "" ? null : window.setTimeout(load, 250);
    if (q === "") load();
    return () => {
      live = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [username, q]);

  // Newest conversation first, and within that the days themselves in the
  // order `sessionsOf` already returned them — grouping must not re-sort
  // what is already the right order.
  const days: { day: string; rows: SessionRow[] }[] = [];
  for (const row of sessions ?? []) {
    const day = row.from.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={onClose}
      className="fixed inset-0 m-0 flex h-full w-full max-w-none flex-col border-0 bg-white p-0 backdrop:bg-navy-900/40 sm:inset-y-0 sm:left-auto sm:h-full sm:w-96 sm:max-w-[90vw] sm:rounded-l-2xl"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-navy-200 px-4 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-900">{label}</p>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 shrink-0 text-sm font-semibold text-navy-800 underline underline-offset-4"
        >
          {t("agent.room.closeHistory")}
        </button>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-navy-200 px-4 pt-2">
        {(
          [
            ["history", label],
            ["days", t("agent.room.daysTab")],
          ] as const
        ).map(([which, name]) => (
          <button
            key={which}
            type="button"
            aria-current={panelTab === which ? "page" : undefined}
            onClick={() => setPanelTab(which)}
            className={`relative min-h-10 rounded-t-lg px-3 text-sm transition-colors ${
              panelTab === which ? "font-semibold text-navy-900" : "text-navy-500 hover:text-navy-800"
            }`}
          >
            {name}
            {panelTab === which && (
              <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-yellow-400" />
            )}
          </button>
        ))}
      </div>
      {panelTab === "history" && (
        <div className="shrink-0 px-4 pt-3">
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={t("agent.room.searchHistory")}
            aria-label={t("agent.room.searchHistory")}
            className="min-h-10 w-full rounded-full border border-navy-300 bg-white px-4 text-sm text-navy-900 placeholder:text-navy-500"
          />
        </div>
      )}
      {panelTab === "days" && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {tripDays.length === 0 ? (
            <p className="text-sm leading-6 text-navy-700">{t("agent.room.daysEmpty")}</p>
          ) : (
            <>
              {tripTitle && (
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                  {tripTitle}
                </h3>
              )}
              <ul className="flex flex-col gap-1">
                {tripDays.map((day) => (
                  <li key={`${day.trip}/${day.slug}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenDay({ trip: day.trip, slug: day.slug });
                        dismiss();
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-navy-200 bg-white px-3 py-2 text-left transition-colors hover:bg-navy-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-navy-900">
                          {day.title || day.date}
                        </span>
                        <span className="block text-xs text-navy-500">{day.date}</span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          day.draft ? "bg-yellow-400 text-navy-900" : "bg-green-100 text-green-800"
                        }`}
                      >
                        {day.draft ? t("draft.badge") : t("agent.room.dayOnline")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {panelTab === "history" && (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {sessions === null ? (
          <p className="text-sm leading-6 text-navy-700">{t("agent.room.historyLoading")}</p>
        ) : days.length === 0 && liveId === null ? (
          <p className="text-sm leading-6 text-navy-700">{t("agent.room.historyEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {/* The conversation you are in, when it has no recorded turns
                yet and therefore no row of its own — B1201. Right after
                "New conversation" the panel listed everything except where
                the person actually was. */}
            {liveId !== null && !(sessions ?? []).some((row) => row.session === liveId) && (
              /* A button that closes the panel, not a link: the person is
                 already in this conversation, and "go where you are" is a
                 reload pretending to be navigation. */
              <button
                type="button"
                onClick={dismiss}
                className="block w-full rounded-xl border border-navy-300 bg-navy-50 px-3 py-2 text-left transition-colors hover:bg-navy-100"
              >
                <p className="truncate text-sm font-medium text-navy-900">
                  {t("agent.room.historyThisOne")}
                  <span className="ml-2 rounded-full bg-yellow-400 px-2 py-0.5 text-[11px] font-semibold text-navy-900">
                    {t("agent.room.historyLive")}
                  </span>
                </p>
              </button>
            )}
            {days.map(({ day, rows }) => (
              <section key={day}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                  {formatLongDate(day)}
                </h3>
                <ul className="flex flex-col gap-1">
                  {rows.map((row) => (
                    <li key={row.session}>
                      <a
                        href={`/agent?c=${encodeURIComponent(row.session)}`}
                        className="block rounded-xl border border-navy-200 bg-white px-3 py-2 transition-colors hover:bg-navy-50"
                      >
                        <p className="truncate text-sm font-medium text-navy-900">
                          {row.opening || t("agent.tool.pastConversationUntitled")}
                        </p>
                        <p className="text-xs text-navy-500">
                          {tn("agent.room.historyTurns", row.turns, { count: String(row.turns) })}
                          {row.session === liveId && (
                            <span className="ml-2 rounded-full bg-yellow-400 px-2 py-0.5 text-[11px] font-semibold text-navy-900">
                              {t("agent.room.historyLive")}
                            </span>
                          )}
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      )}
    </dialog>
  );
}


/** What `GET /api/helper/<user>/account` answers — B1208 (D06/D07). */
type AccountFacts = {
  credits: number | null;
  monthSpent: number | null;
  storage: { usedBytes: number; ceilingBytes: number | null };
};

/**
 * The account sheet the credit chip opens — B1208 (D07), grown into the
 * minimal account home of D09 by B1209 (display settings arrive there).
 *
 * Balance, what this month has cost in credits (the ledger's own rows,
 * never the operator's token accounting), the storage bar, and the way to
 * buy — which is a link to the owner's page, where purchasing already
 * lives. Fetched on open, like the history panel and for the same reason.
 */
function AccountSheet({
  username,
  label,
  onClose,
}: {
  username: string;
  label: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);
  const dismiss = () => (dialog.current?.close ? dialog.current.close() : onClose());

  const [facts, setFacts] = useState<AccountFacts | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/helper/${encodeURIComponent(username)}/account`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: AccountFacts | null) => {
        if (live && body) setFacts(body);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [username]);

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={onClose}
      className="fixed inset-x-0 bottom-0 top-auto m-0 flex w-full max-w-none flex-col rounded-t-2xl border-0 bg-white p-0 backdrop:bg-navy-900/40 sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-96 sm:max-w-[90vw] sm:rounded-l-2xl sm:rounded-tr-none"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-navy-200 px-4 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-900">{label}</p>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 shrink-0 text-sm font-semibold text-navy-800 underline underline-offset-4"
        >
          {t("agent.room.closeAccount")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {facts === null ? (
          <p className="text-sm leading-6 text-navy-700">{t("agent.room.historyLoading")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {facts.credits !== null && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                  {t("agent.room.accountBalance")}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold text-navy-900">
                  {facts.credits.toLocaleString("de-CH", { maximumFractionDigits: 2 })}
                </p>
                {facts.monthSpent !== null && (
                  <p className="mt-1 text-sm text-navy-600">
                    {t("agent.room.accountMonth", {
                      count: facts.monthSpent.toLocaleString("de-CH", {
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </p>
                )}
                <a
                  // Straight onto the purchase control, not the /me page —
                  // B1319: the account page now carries the slider inline
                  // under this anchor.
                  href={`/${encodeURIComponent(username)}/account#buy`}
                  className="mt-2 inline-block min-h-11 rounded-full border border-yellow-600 bg-yellow-400 px-5 py-2.5 text-sm font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                >
                  {t("agent.room.accountBuy")}
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}

const GB = (n: number) => (n / (1024 * 1024 * 1024)).toFixed(n >= 1024 * 1024 * 1024 ? 1 : 2);

/**
 * The storage bar, at the foot of the files pane — B1340 (E07): how full the
 * journal is belongs with the files that fill it, not with the credits. The
 * whole line links to the owner's account page, where buying more lives.
 */
function StorageLine({ username, refresh }: { username: string; refresh: number }) {
  const { t } = useI18n();
  const [storage, setStorage] = useState<AccountFacts["storage"] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/helper/${encodeURIComponent(username)}/account`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: AccountFacts | null) => {
        if (live && body?.storage) setStorage(body.storage);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // `refresh` is the inbox count — B1350: an upload landed, so the bytes
    // on disk moved and the bar re-reads rather than showing the old fill.
  }, [username, refresh]);
  if (storage === null) return null;
  const ceiling = storage.ceilingBytes;
  return (
    <a
      href={`/${encodeURIComponent(username)}/account`}
      className="mt-3 block border-t border-navy-100 pt-2.5"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">
        {t("agent.room.accountStorage")}
      </p>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-navy-100">
        {ceiling !== null && (
          <div
            className="h-full rounded-full bg-yellow-400"
            style={{ width: `${Math.min(100, Math.round((storage.usedBytes / ceiling) * 100))}%` }}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-navy-600">
        {ceiling === null
          ? `${GB(storage.usedBytes)} GB`
          : t("agent.room.accountStorageOf", { used: GB(storage.usedBytes), ceiling: GB(ceiling) })}
      </p>
    </a>
  );
}

/**
 * The files, as tiles that can be selected — B902.
 *
 * Two groups, because they are two different things: what is waiting and
 * belongs to no day yet, and what is already on this trip. A checkbox each,
 * labelled, so the whole pane is operated with Tab and Space and needs no
 * pointer at all — and so a screen reader says "selected" rather than leaving
 * a person to infer it from a border.
 *
 * **An inbox tile has no picture and that is not an omission.** Nothing in
 * `inbox/` is reachable by URL, by construction, and it stays that way: a file
 * nobody has filed is not published. The name is what a person recognises
 * their own file by.
 */
/**
 * A staged file whose name says it is a moving picture — B1123.
 *
 * The inbox stores a video under `kind: "media"` beside a photograph, and the
 * thumbnail route serves only still images, so a video would otherwise ask for
 * a picture that never comes. Its own extension is the one thing known here
 * without a lookup.
 */
const VIDEO = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

function FilesPane({
  files,
  selected,
  onToggle,
  onClear,
  username,
  subject,
  onProposal,
  onInboxAdded,
}: {
  files: RoomFiles;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  username: string;
  /** The day under discussion, for the tile menu's attach — B1216 (D34). */
  subject: { trip: string; slug: string } | null;
  /** Open one tool's confirm card in the conversation — never a direct
   *  write. The tile menu's two actions both go through it. */
  onProposal: (tool: string, args: Record<string, string>) => void;
  /** The pane's upload stored these in the inbox — B1171. The room prepends
   *  them to its own copy, so the tiles appear the moment the route answers. */
  onInboxAdded: (added: RoomFile[]) => void;
}) {
  const { t, tn } = useI18n();
  /**
   * The tile menu — B1216 (D34): right-click, or the long-press that fires
   * `contextmenu` on phones, on a waiting file. Both actions open the same
   * confirmation proposals the conversation uses; nothing here writes.
   */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);
  const empty = files.inbox.length === 0 && files.trip.length === 0;

  return (
    <div>
      <p className="text-sm leading-6 text-navy-600">{t("agent.room.filesHint")}</p>

      {/**
       * The count is announced by a region that was **there first** — B949.
       *
       * This whole paragraph used to be behind `selected.length > 0`, so the
       * live region came into existence at the same moment as its first
       * content — and a screen reader may never announce that first change,
       * because the region was not there to be watched. Somebody ticking
       * their first photograph heard nothing, and would have had to tab
       * onward and find the "Clear" button to learn that anything had been
       * selected at all.
       *
       * The conversation log two hundred lines below has this fixed and says
       * why in the same words. The second live region on the same screen did
       * not get the same treatment, which is the whole of this ticket.
       *
       * So the `<span>` is always mounted and empty when nothing is picked;
       * only the button, which is a control rather than an announcement,
       * comes and goes.
       */}
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-navy-800">
        <span role="status">
          {selected.length > 0
            ? tn("agent.room.selected", selected.length, { count: String(selected.length) })
            : ""}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="min-h-11 px-1 text-sm text-navy-600 underline underline-offset-4 hover:text-navy-900"
          >
            {t("agent.room.clear")}
          </button>
        )}
      </p>

      {empty && <p className="mt-3 text-sm leading-6 text-navy-700">{t("agent.room.noFiles")}</p>}

      {/**
       * What is *waiting*, grouped by kind and newest first — B1123.
       *
       * This used to be one undifferentiated grid of tiles under a heading
       * saying "inbox". A photograph and a bank statement drew the same empty
       * square, and the pane led with what had been *chosen*, which a person
       * already knows, rather than what is waiting, which they do not.
       *
       * `InboxFileGroups` is the view; `filesForRoom` grew `kind`, `bytes`
       * and `uploadedAt` to feed it, and an inbox photograph's `src` now
       * points at the owner-only thumbnail route rather than being undefined.
       */}
      {menu && (
        <div
          role="menu"
          className="fixed z-50 w-52 rounded-xl border border-navy-200 bg-white p-1.5 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          {subject && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onProposal("attach_files", {
                  trip: subject.trip,
                  slug: subject.slug,
                  files: menu.id.replace(/^inbox:/, ""),
                });
              }}
              className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-navy-800 hover:bg-navy-50"
            >
              {t("agent.room.menuAttach")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              onProposal("discard_file", { file: menu.id.replace(/^inbox:/, "") });
            }}
            className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-coral-600 hover:bg-coral-50"
          >
            {t("agent.room.menuDiscard")}
          </button>
        </div>
      )}
      {files.inbox.length > 0 && (
        <div
          onContextMenu={(event) => {
            const tile = (event.target as HTMLElement).closest("[data-inbox-id]");
            const id = tile?.getAttribute("data-inbox-id");
            if (!id) return;
            event.preventDefault();
            setMenu({ id, x: Math.min(event.clientX, window.innerWidth - 220), y: event.clientY });
          }}
        >
        <InboxFileGroups
          files={files.inbox.map((file) => ({
            id: file.id,
            name: file.name,
            // The four inbox kinds collapse to the three shapes a person sees.
            // Only `media` has a picture; `files`, `photobook` and `postcards`
            // are documents and draw their type instead of an empty frame.
            kind: file.kind === "media" ? (VIDEO.test(file.name) ? "video" : "photo") : "document",
            src: file.src,
            bytes: file.bytes,
            at: file.uploadedAt,
          }))}
          selected={selected}
          onToggle={onToggle}
        />
        </div>
      )}

      {files.trip.length > 0 && (
        <Group heading={t("agent.room.onTrip", { trip: files.tripTitle })}>
          {files.trip.map((file) => (
            <Tile key={file.id} file={file} on={selected.includes(file.id)} onToggle={onToggle} />
          ))}
        </Group>
      )}

      <UploadPanel username={username} onInboxAdded={onInboxAdded} />
    </div>
  );
}

/**
 * The files, as a slim strip above the composer rather than a pane above the
 * conversation — B1016.
 *
 * A header pill used to open this on a press; now it is always in view when
 * there is anything to show, about 50px tall, and a tap expands it into the
 * same `FilesPane` the pill used to open — the drawer is one mechanism, not
 * two. Mobile only (`lg:hidden`): the wide layout already has the files as
 * their own column, and a second copy of it above the composer would be a
 * pane repeating a pane.
 *
 * **Collapses while the field has focus.** The arithmetic in the ticket is
 * why: on a 390 × 844 phone with the keyboard up there is 126px left below
 * the back bar, the room header and the composer — two lines of conversation
 * with a 50px strip, and none at all with the 40% tray a literal "pane below
 * the chat" would have been.
 *
 * **Its live region is the third on this screen, and it is mounted from the
 * first render** — B949 is the record of what happens to the second one that
 * was not: created at the same moment as its first content, and a screen
 * reader may never have been watching it. So this one exists, empty, whether
 * or not there is anything to show, and says nothing until there is.
 */
function FilesStrip({
  files,
  selected,
  collapsed,
  onOpen,
}: {
  files: RoomFiles;
  selected: string[];
  /** The field in `HelperAsk` has focus. */
  collapsed: boolean;
  onOpen: () => void;
}) {
  const { t, tn } = useI18n();
  const items = [...files.inbox, ...files.trip];
  const show = items.length > 0 && !collapsed;

  return (
    <div className="lg:hidden">
      <span role="status" className="sr-only">
        {selected.length > 0
          ? tn("agent.room.selected", selected.length, { count: String(selected.length) })
          : ""}
      </span>
      {show && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={
            selected.length > 0
              ? tn("agent.room.selected", selected.length, { count: String(selected.length) })
              : t("agent.room.files")
          }
          className="mb-2 flex h-[50px] w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-navy-200 bg-white p-1"
        >
          {items.map((file) => (
            <span
              key={file.id}
              className={`relative block h-full w-[42px] shrink-0 overflow-hidden rounded-md border bg-white ${
                selected.includes(file.id) ? "border-navy-800 ring-2 ring-navy-800" : "border-navy-200"
              }`}
            >
              {file.src ? (
                <Image src={file.src} loader={mediaLoader} alt="" fill sizes="42px" className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-sm" aria-hidden>
                  📄
                </span>
              )}
            </span>
          ))}
        </button>
      )}
    </div>
  );
}

/** What `POST /api/helper/<user>/inbox` answers with per stored file — the
 *  inbox entry as `lib/inbox.ts` wrote it. */
type StoredInboxItem = {
  id: string;
  filename: string;
  kind: RoomFile["kind"];
  bytes: number;
  uploadedAt: string;
};

/**
 * The picker and the upload — B984 put it in the room, B1171 pointed it at
 * the inbox.
 *
 * It used to write photographs straight onto whatever day the preview
 * happened to be about, which on a fresh visit was a months-old draft nobody
 * chose — and with no subject there was no upload control at all. Everything
 * lands in the inbox now, where a file that belongs to no day yet is designed
 * to wait (B663); the conversation is what files it onto a day ("put these on
 * Friday"), which keeps the one decision — what happened on which day — in
 * the conversation's hands and nowhere else.
 *
 * One request, not the wizard's two-phase queue: an inbox file needs no web
 * derivative before anybody can see the day, because it is not on a day yet.
 */
function UploadPanel({
  username,
  onInboxAdded,
}: {
  username: string;
  /** Called with the stored files, as `RoomFile`s, the moment the route
   *  answers — the pane's tiles must never claim nothing is waiting while
   *  something it just stored is. */
  onInboxAdded: (added: RoomFile[]) => void;
}) {
  const { t, tn } = useI18n();
  // The room mounts this pane twice at once — the desktop column stays in the
  // DOM behind `hidden lg:block` and the phone sheet is a second full copy —
  // so a fixed id here would put two `id="…"` inputs on one page. `useId()`
  // is React's own answer to exactly that: unique per mounted instance, and
  // stable for that instance's whole life.
  const pickerId = useId();
  const [chosen, setChosen] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [landedCount, setLandedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: File[]) {
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    setLandedCount(0);
    // The one storage check, before any of it starts — B683: a sentence
    // somebody can act on while every photograph is still in front of them,
    // rather than a wall after the upload has already been sent.
    const room = await fetch(`/api/helper/${encodeURIComponent(username)}/day/media`).catch(
      () => null,
    );
    const check = (await room?.json().catch(() => null)) as
      | { remainingBytes: number | null }
      | null;
    if (!room || !room.ok || !check) {
      setError(t("agent.failed", { error: "network" }));
      setBusy(false);
      return;
    }
    const needed = list.reduce((n, file) => n + file.size, 0);
    const left = check.remainingBytes;
    if (left !== null && needed > left) {
      const mb = (n: number) => String(Math.max(1, Math.round(n / (1024 * 1024))));
      setError(t("agent.noRoom", { needed: mb(needed), left: mb(left) }));
      setBusy(false);
      return;
    }

    const form = new FormData();
    for (const file of list) form.append("files", file);
    const response = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, {
      method: "POST",
      body: form,
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as
      | { items?: StoredInboxItem[]; error?: string; problems?: { expected: string }[] }
      | null;
    setBusy(false);

    if (!response || !response.ok || !body?.items) {
      // The route's own refusal names the file and what was expected; keep
      // that half rather than flattening it into a code.
      const expected = body?.problems?.[0]?.expected;
      setError(expected ?? t("agent.failed", { error: body?.error ?? "network" }));
      return;
    }

    setChosen([]);
    setLandedCount(body.items.length);
    onInboxAdded(
      body.items.map((item) => ({
        id: `inbox:${item.id}`,
        name: item.filename,
        src:
          item.kind === "media"
            ? `/api/helper/${encodeURIComponent(username)}/inbox/${encodeURIComponent(item.id)}/thumbnail`
            : undefined,
        kind: item.kind,
        bytes: item.bytes,
        uploadedAt: item.uploadedAt,
      })),
    );
  }

  return (
    <section className="mt-4 border-t border-navy-200 pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-600">
        {t("agent.uploadTitle")}
      </h2>

      {/* The two ways in, side by side — B1349: two lonely buttons around a
          paragraph read as clutter on a phone. The camera stays phone-only
          (B1216, D33); the hint moves below both. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PhotoPicker
          id={pickerId}
          chosen={chosen}
          disabled={busy}
          bare
          onPick={(list) => {
            const files = Array.from(list ?? []);
            setChosen(files);
            if (files.length > 0) void upload(files);
          }}
        />
        <div className="lg:hidden">
          <input
            id={`${pickerId}-camera`}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) void upload(files);
            }}
            className="peer sr-only"
          />
          <label
            htmlFor={`${pickerId}-camera`}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-navy-300 bg-white px-5 text-base font-semibold text-navy-800 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 peer-disabled:opacity-50"
          >
            {t("agent.room.camera")}
          </label>
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-navy-600">{t("agent.pickAnyFile")}</p>

      {/* Mounted from the first render, empty until there is something to
       *  say — B949 again, in the pane that taught this file the rule the
       *  first time. A live region created at the same moment as its first
       *  content is one a screen reader may never have been watching. */}
      <p role="status" aria-live="polite" className="mt-2 text-sm leading-6 text-navy-800">
        {busy
          ? t("agent.askWorking")
          : landedCount > 0
            ? tn("agent.room.uploadedWaiting", landedCount, { count: String(landedCount) })
            : ""}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm leading-6 text-coral-600">
          {error}
        </p>
      )}
    </section>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-600">{heading}</h2>
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">{children}</ul>
    </section>
  );
}

/** One small thumbnail, and the checkbox is the tile. The input is the label's
 *  own child and only visually hidden, so it keeps every keyboard and screen
 *  reader behaviour a checkbox has. */
function Tile({
  file,
  on,
  onToggle,
}: {
  file: RoomFile;
  on: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <li>
      <label
        className={`flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy-800 ${
          on ? "border-navy-800 ring-2 ring-navy-800" : "border-navy-200"
        }`}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={() => onToggle(file.id)}
          className="sr-only"
        />
        <span className="relative block aspect-square bg-cream-200">
          {file.src ? (
            <Image
              src={file.src}
              loader={mediaLoader}
              alt=""
              fill
              sizes="96px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg" aria-hidden>
              📄
            </span>
          )}
        </span>
        <span className="truncate px-1 py-1 text-[11px] leading-4 text-navy-800">{file.name}</span>
      </label>
    </li>
  );
}

/**
 * What is being talked about, as it now stands — B901.
 *
 * The real `DayCard`, the real props, the same read the wizard's own preview
 * step makes. Empty is the honest state and says so: a pane that invented
 * something to show would be showing a day nobody wrote.
 */
function PreviewPane({
  preview,
  reading,
  currency,
}: {
  preview: Preview | null;
  reading: boolean;
  currency: CurrencyOptions;
}) {
  const { t } = useI18n();

  if (!preview) {
    return (
      <p role="status" className="text-sm leading-6 text-navy-700">
        {reading ? t("agent.room.previewReading") : t("agent.room.previewEmpty")}
      </p>
    );
  }

  return (
    <div aria-busy={reading}>
      <CurrencyProvider options={currency}>
        <DayCard day={preview.day} summary={preview.summary} dayIndex={preview.dayIndex} />
      </CurrencyProvider>
    </div>
  );
}
