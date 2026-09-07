import type { Metadata } from "next";
import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import { notFound } from "next/navigation";
import MePageContent, {
  type JournalPanel,
  type TripEditPanel,
  type ManagePanel,
  type PaymentPanel,
  type StoragePanel,
} from "./MePageContent";
import { manageTokenFor, listContacts, normaliseEmail, optedInCounts } from "@/lib/contacts";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { pickLocale } from "@/lib/contacts/locale";
import { isEnabled } from "@/lib/capabilities";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { EXTRA_STORAGE_CREDITS, formatChf, POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { listPayments } from "@/lib/payments";
import { cleanupPlan } from "@/lib/storageCleanup";
import { formatBytes, storageBreakdown, storageFor } from "@/lib/storageQuota";
import { ownerShortName, serverSite } from "@/lib/site";
import { resolveViewer } from "@/lib/viewer";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { whatsappCountryCode } from "@/lib/whatsapp/settings";

// Reads a session on every request; there is nothing here to prerender.
export const dynamic = "force-dynamic";

/** Never indexed: it is a different page for every reader, and most of them
 * are one person's own access. */
/** The tab title follows the reader; see the note in the gallery page. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: translateIn(await requestLocale(), "me.title"),
    robots: { index: false, follow: false },
  };
}

export default async function MePage({ params, searchParams }: PageProps<"/[user]/me">) {
  const { user } = await params;
  const journal = getUser(user);
  if (!journal) notFound();

  // Why they are here rather than inside the journal. Both values are written
  // by this codebase — `/api/auth/link` on a spent link, and the same route on
  // a throttle — and anything else in the query is ignored rather than
  // rendered, so the parameter cannot be used to put a sentence of somebody
  // else's choosing on the page.
  const signin = (await searchParams).signin;
  const viewer = await resolveViewer(user);

  // Only shown to a reader still without a session: B359 found it sitting
  // above "Signed in as …" once the fresh code from the same page had
  // worked, because the parameter that drives it survives the sign-in
  // unread. `GuestSignIn` reloads rather than navigating, so the
  // query string is still `?signin=expired` on the request that renders the
  // new session — this is where that request learns the session exists and
  // stops repeating a notice about a link that no longer matters.
  const signinNotice = viewer.email
    ? undefined
    : signin === "expired"
      ? "me.signinExpired"
      : signin === "throttled"
        ? "me.signinThrottled"
        : undefined;

  // Asked once, for both doors this page opens into contacts. B74: the
  // guest-details link below was gated on it and the owner's guest-list link
  // was not, so an owner whose journal has contacts off followed a link their
  // own page had drawn and got a 404.
  const contactsEnabled = isEnabled("contacts", user);

  // The manage form itself lives in one place, `ContactManage`, and is reused
  // rather than rebuilt: it works with no login from the token in every mail
  // footer (`/c/<token>`), and it renders again here, inline, for a reader
  // who is already signed in and would otherwise be sent to a second page for
  // one field they can see right in front of them.
  let manage: ManagePanel | undefined;
  if (viewer.email && contactsEnabled) {
    const contact = (await listContacts(user)).find(
      (c) => c.email === normaliseEmail(viewer.email!),
    );
    if (contact) {
      // The reader's own UI language, not the one on the contact record —
      // the record's `locale` is a separate question ("write to me in"),
      // still asked inside the form's own dropdown. Rendering the form's
      // chrome in the record's language instead would put it next to a
      // header in whatever language this reader is actually reading in.
      const uiLocale = await requestLocale();
      manage = {
        token: manageTokenFor(user, contact.id),
        locales: localesFor(user),
        dictionary: dictionaryFor(uiLocale),
        contact: {
          name: contact.name ?? "",
          email: contact.email,
          locale: pickLocale(contact.locale, journal.defaultLocale),
          status: contact.status,
          wantsEmailDigest: contact.wantsEmailDigest,
          wantsPostcard: contact.wantsPostcard,
          wantsWhatsapp: contact.wantsWhatsapp,
          address: contact.postalAddress ?? EMPTY_ADDRESS,
        },
        // B385: same fallback `toE164` reads at send time.
        defaultCountryCode: whatsappCountryCode(),
        // B399: same server-ceiling-and-journal-opt-in check as everywhere
        // else this capability is read.
        addressLookupEnabled: isEnabled("addressLookup", user),
      };
    }
  }

  // B367. `balanceOf` answers `null` for a journal with credits switched
  // off, which is not the same question as "zero left" — B74's rule is that
  // the whole section is then absent rather than showing a dash or a zero,
  // so `payment` stays `undefined` and the component never has to tell the
  // two apart. Nothing is fetched for anyone but the owner: a stranger or a
  // traveller has no business knowing what this journal has left to spend.
  // B619. Owner only, like everything else resolved here: the address is on
  // it, and `config.json` is not something a reader's page should be able to
  // ask about. `tagline` defaults to `""` in lib/config.ts, which is also what
  // clearing the box means, so the two ends already agree.
  const journalPanel: JournalPanel | undefined = viewer.owner
    ? {
        title: journal.title,
        tagline: journal.tagline,
        email: journal.owner.email ?? "",
      }
    : undefined;

  /**
   * The trips this reader may edit — B621, owner only.
   *
   * Read from `viewer.trips` rather than the journal's own list, so the rows
   * and the pencils cannot disagree about which trips exist; `getTrip` is a
   * cached read per trip, which is what the page is already doing to build
   * that list. Everybody else gets `undefined` and their rows stay links.
   */
  const editableTrips: TripEditPanel[] | undefined = viewer.owner
    ? viewer.trips
        .map((seen) => getTrip(tripRef(user, seen.id)))
        .filter((trip) => trip !== null && trip !== undefined)
        .map((trip) => ({
          id: trip.id,
          title: trip.title,
          tagline: trip.tagline ?? "",
          start: trip.start,
          end: trip.end,
          visibility: trip.visibility,
        }))
    : undefined;

  /**
   * Storage — B664. Owner only, and outside the `balance !== null` branch
   * below on purpose: how full a journal is has nothing to do with whether
   * this instance charges for sends, and an owner on an instance with credits
   * off still wants to know. Only `canBuy` depends on that.
   */
  let storage: StoragePanel | undefined;
  if (viewer.owner) {
    const usage = await storageFor(user);
    if (usage.limitBytes !== null) {
      const limit = usage.limitBytes;
      const reclaimable = await cleanupPlan(user, true);
      storage = {
        used: formatBytes(usage.usedBytes),
        limit: formatBytes(limit),
        percent: Math.round((usage.usedBytes / limit) * 100),
        // Biggest first: the question the chart answers is "which of these is
        // the big one", and reading it should not need a scan.
        rows: storageBreakdown(user)
          .filter((row) => row.bytes > 0)
          .sort((a, b) => b.bytes - a.bytes)
          .map((row) => ({
            key: row.key,
            label: row.label,
            human: formatBytes(row.bytes),
            // Of the allowance, not of what is used — so the bar's empty tail
            // is the room that is left, which is the thing being asked about.
            share: Math.min(100, (row.bytes / limit) * 100),
          })),
        reclaimable: {
          human: formatBytes(reclaimable.bytes),
          files: reclaimable.files,
          hasStagedFiles: reclaimable.stagedFiles > 0,
        },
        canBuy: creditsEnabled(),
        buyCredits: EXTRA_STORAGE_CREDITS,
      };
    }
  }

  let payment: PaymentPanel | undefined;
  if (viewer.owner) {
    const balance = await balanceOf(user);
    if (balance !== null) {
      // `optedInCounts` (lib/contacts) is `recipientsFor`'s own predicate,
      // read here without a trip to ask `mayMailTrip` about — see its doc
      // comment for why that makes this the journal-wide "up to N" rather
      // than one trip's exact count.
      // The owner's own address and number go in as *exclusions* — B614.
      // `recipientsFor` always sends them their own copy and never charges
      // for it, and a contact at the owner's own address (an owner who is
      // also in their own guestbook) is that same free copy rather than a
      // second, paid one.
      const counts = optedInCounts(await listContacts(user), journal.owner);
      const transactions = (await listPayments(user)).map((tx) => ({
        id: tx.id,
        credits: tx.credits,
        amount: formatChf(tx.amountRappen),
        status: tx.status,
        createdAt: tx.createdAt,
      }));
      // What the owner may switch, and what they may not — B463. The server
      // ceiling and the journal's own flag are two different answers and the
      // panel needs both: a channel this server cannot offer has no switch,
      // because there is nothing an owner could do about it, while one they
      // have muted themselves has to stay visible to be un-muted.
      // `isEnabled(name)` with no username is the server ceiling and nothing
      // else — the same question `setJournalFeatures` asks before it allows a
      // capability to be switched on — while `journal.features` is what this
      // journal asks for. `isEnabled(name, user)` is the two together and
      // cannot tell them apart, which is why it is not what is read here.
      const channelState = (name: "mail" | "whatsapp") =>
        isEnabled(name) ? journal.features[name].enabled : null;

      payment = {
        balance,
        transactions,
        emailRecipients: counts.email,
        whatsappRecipients: counts.whatsapp,
        channels: { mail: channelState("mail"), whatsapp: channelState("whatsapp") },
        // The price of a card, where cards can be posted at all. Not a
        // per-send estimate like the rows above: it is a flat price, and the
        // count is whatever the owner chooses on the preview page.
        postcardCredits: isEnabled("postcards", user) ? POSTCARD_CREDITS : null,
      };
    }
  }

  return (
    <MePageContent
      viewer={viewer}
      username={user}
      siteUrl={serverSite().url}
      manage={manage}
      journal={journalPanel}
      editableTrips={editableTrips}
      payment={payment}
      storage={storage}
      // Resolved here rather than guessed in the component: a capability is a
      // server ceiling and a journal opt-in, and the page was offering a door
      // that this journal had never opened. The panel used to take a second
      // flag, `canJoin`, which was `isEnabled("contacts", …)` under a name
      // that promised something narrower — there is no open form to gate any
      // more (B37), so it is gone rather than left to be misread.
      canSignIn={isEnabled("auth", user)}
      codeMinutes={CODE_TTL_MINUTES}
      contactsEnabled={contactsEnabled}
      // B566. Only ever true for the owner: the page it links to is
      // owner-only, and a card leading to a 404 is the broken kind of
      // absent (B74). Resolved here because `isEnabled` reads server
      // config and the component is a client one.
      analyticsEnabled={viewer.owner && isEnabled("analytics", user)}
      // B20. The stranger's half of this page told somebody to ask for a link
      // and never said whom to ask, on a site they may have reached without
      // knowing whose it is.
      //
      // One string, picked here: `journal.owner` also carries the owner's
      // email address, and the rule is that the field is chosen at the server
      // boundary rather than in the component, so that a later edit to the
      // component cannot leak a value it was never handed. Nothing narrower
      // than the whole object would do — this is the whole object minus the
      // address, computed to a single word.
      ownerName={ownerShortName(journal)}
      signinNotice={signinNotice}
    />
  );
}
