import "server-only";
import type { Tool } from "../types";
import { balanceOf, creditsEnabled } from "../../../credits";
import { creditsInRappen, EXTRA_STORAGE_CREDITS, formatChf } from "../../../credits/pricing";
import { formatBytes, storageFor } from "../../../storageQuota";
import { cleanupPlan } from "../../../storageCleanup";
import { isEnabled } from "../../../capabilities";
import { listSessions } from "../../../auth";
import { journalProfile } from "../../../journals";
import { getUser } from "../../../users";
// Dynamic, not static — `../../sessions` imports `./consent`, which imports
// `./model`, which reads `TOOLS` at module scope: a static import here closes
// that into a cycle and `TOOLS` comes back empty. A call-time import breaks
// it without breaking the one caller that needs it.
async function sessionsOf(username: string) {
  return (await import("../../sessions")).sessionsOf(username);
}

/**
 * The journal's own account — credits and room.
 *
 * One area of the registry — B1042. The tools were a nine-hundred-line array
 * in a single file, which is a file two people cannot edit at once and nobody
 * can read the shape of. What decides where a tool lives is what a person is
 * doing, not which route it posts to.
 */

/** A key still worth listing — live and able to write. The same test
 *  `app/api/v1/[user]/keys/route.ts` applies, copied rather than imported
 *  because that file's own `live` is not exported and the shape is three
 *  lines. */
function live(row: { kind: string; revokedAt: string | null; expiresAt: string }): boolean {
  if (row.kind !== "agent" && row.kind !== "handover") return false;
  if (row.revokedAt) return false;
  return new Date(row.expiresAt).getTime() > Date.now();
}

export const JOURNAL_TOOLS: readonly Tool[] = [
  {
    /** Credits and disk in one answer — the two questions about the account
     *  itself, which nobody asks one at a time. */
    name: "account",
    kind: "read",
    renders: "say",
    describe:
      "This journal's own account: credits left and disk space used. Credits pay for model, captions, transcription and printing, not a trip's money (trip_costs). A null balance means nothing is charged. Bytes only — never where anything is.",
    properties: {},
    run: async (username) => {
      const usage = await storageFor(username);
      return {
        credits: await balanceOf(username),
        used: formatBytes(usage.usedBytes),
        limit: usage.limitBytes === null ? null : formatBytes(usage.limitBytes),
        left: usage.remainingBytes === null ? null : formatBytes(usage.remainingBytes),
      };
    },
  },
  {
    /**
     * A title typoed at signup, fixed without a shell — B182 one level up.
     *
     * Deliberately narrow: `JOURNAL_PROFILE_FIELDS` has more than these two,
     * and turning a capability on or off is a bigger decision than a chat
     * message should make on its own. The route behind this
     * (`app/api/helper/[user]/journal/route.ts`) accepts nothing else.
     */
    name: "journal_settings",
    kind: "write",
    renders: "form",
    describe:
      // The one-journal sentence is B1341 (E03 A): asked for a "new journal",
      // the model proposed this rename form and the owner read it as a second
      // journal appearing. Saying the rule to the model is what stops that.
      "Change the journal's own title or tagline. Never a capability switch — those live on a page, not in a chat. One account has one journal: asked for a new journal, say so and offer a new trip or a rename instead; never propose this unasked.",
    properties: {
      title: { type: "string", description: "The journal's own title." },
      tagline: { type: "string", description: "One line under the title. Empty clears it." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/journal`,
    propose: async (username, args, say) => {
      const config = getUser(username);
      const profile = config ? journalProfile(config) : null;
      return {
        sentence: say("agent.tool.journalSettings"),
        accept: say("agent.tool.journalSettingsAccept"),
        done: say("agent.tool.journalSettingsDone"),
        fields: [
          { name: "title", value: args.title ?? profile?.title ?? "" },
          { name: "tagline", value: args.tagline ?? profile?.tagline ?? "" },
        ],
      };
    },
  },
  {
    /**
     * The read half of a full journal — B664's plan, read out loud rather
     * than only shown on `/[user]/account`.
     *
     * The preview is the read: `GET .../storage/cleanup` removes nothing,
     * and this tool's own `cleanupPlan` call is exactly that GET.
     */
    name: "cleanup",
    kind: "write",
    renders: "confirm",
    describe:
      "Free space by deleting generated photobook PDFs and postcard sheets. Say what a cleanup would take before asking — every day and photograph stays either way.",
    properties: {},
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/storage/cleanup`,
    propose: async (username, _args, say) => {
      const plan = await cleanupPlan(username);
      return {
        // Nothing to take is not a mistake to press through — B951's rule.
        ...(plan.bytes === 0 ? { refuse: "agent.tool.nothingToClean" } : {}),
        sentence: say(plan.files === 1 ? "agent.tool.cleanup.one" : "agent.tool.cleanup", {
          bytes: formatBytes(plan.bytes),
          files: String(plan.files),
        }),
        accept: say("agent.tool.cleanupAccept"),
        done: say("agent.tool.cleanupDone"),
        fields: [],
        preview: [say("agent.tool.cleanupPreview")],
      };
    },
  },
  {
    /** The one thing an owner can buy for the journal itself — B661. Spends
     *  credits, so the cost and the balance are said before the press,
     *  never after. */
    name: "buy_room",
    kind: "write",
    renders: "confirm",
    describe: "Buy 5 GB more room for this journal. Spends credits — say the cost and the balance first.",
    properties: {},
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/storage`,
    propose: async (username, _args, say) => {
      const price = formatChf(creditsInRappen(EXTRA_STORAGE_CREDITS));
      return {
        ...(!creditsEnabled() ? { refuse: "agent.tool.creditsOff" } : {}),
        sentence: say("agent.tool.buyRoom", { credits: String(EXTRA_STORAGE_CREDITS), price }),
        accept: say("agent.tool.buyRoomAccept"),
        done: say("agent.tool.buyRoomDone"),
        fields: [],
        preview: [
          say("agent.tool.buyRoomPreview", {
            credits: String(EXTRA_STORAGE_CREDITS),
            price,
            balance: String((await balanceOf(username)) ?? 0),
          }),
        ],
      };
    },
  },
  {
    /** What can write here — B283's list, read out rather than only shown on
     *  `/[user]/me`. Never the tokens themselves: only hashes are stored, so
     *  there is nothing here to leak, and an id is what revoking needs. */
    name: "keys",
    kind: "read",
    renders: "choose",
    describe:
      "The keys that can write to this journal — an agent's own token, or a handover not yet spent. Never a browser session; those sign out from their own page.",
    properties: {},
    run: async (username) => {
      if (!isEnabled("auth", username)) return [];
      return (await listSessions(username)).filter(live).map((row) => ({
        id: row.id,
        kind: row.kind,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
      }));
    },
    block: (data, say) => {
      const rows = data as { id: string; kind: string; createdAt: string; lastSeenAt: string | null }[];
      if (rows.length === 0) return null;
      return {
        shape: "choose",
        text: say("agent.block.keys"),
        options: rows.map((row) => ({
          value: row.id,
          label: say(row.kind === "agent" ? "agent.tool.keyAgent" : "agent.tool.keyHandover"),
          detail: `${row.createdAt.slice(0, 10)} · ${
            row.lastSeenAt ? row.lastSeenAt.slice(0, 10) : say("agent.tool.keyNeverUsed")
          }`,
        })),
      };
    },
  },
  {
    /** The other half of `keys` — a credential a person cannot revoke is one
     *  they cannot hand out carefully (B283). */
    name: "revoke_key",
    kind: "write",
    renders: "confirm",
    describe: "Take back one key. Call `keys` first to see which — this needs its id.",
    properties: {
      id: { type: "string", description: "The key's id, from `keys`." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/keys`,
    propose: async (username, args, say) => {
      const id = args.id ?? "";
      const row = id ? (await listSessions(username)).filter(live).find((r) => r.id === id) : undefined;
      return {
        ...(!row ? { refuse: "agent.tool.noKey" } : {}),
        sentence: say("agent.tool.revokeKey", {
          kind: row ? say(row.kind === "agent" ? "agent.tool.keyAgent" : "agent.tool.keyHandover") : "",
        }),
        accept: say("agent.tool.revokeKeyAccept"),
        done: say("agent.tool.revokeKeyDone"),
        fields: [{ name: "id", value: id, fixed: true }],
      };
    },
  },
  {
    /**
     * Where credits are bought — B368. A link, never a call this makes
     * itself: `POST .../credits/purchase` files a pending transaction and
     * mails a payment link, and nothing reachable from a conversation may
     * grant a credit (`lib/credits.ts` property 1). Hand over the page.
     */
    name: "buy_credits",
    kind: "link",
    renders: "link",
    describe: "Where to buy more credits. Hands over the page only — nothing here spends money or adds credits.",
    properties: {},
    link: (username, _args, say) => ({
      text: say("agent.tool.buyCredits"),
      href: `/${encodeURIComponent(username)}/account`,
      label: say("agent.tool.buyCreditsLabel"),
    }),
  },
  {
    /**
     * B1022 — nothing could produce `/agent?c=<session>` before this.
     * `sessionsOf` already answered exactly what a list needs; it had no
     * caller. Each option carries the session id as `value`, and — since a
     * past conversation has nothing left for a model to do with it — as
     * `href` too, so the room navigates straight to it (`lib/helper/blocks.ts`).
     */
    name: "past_conversations",
    kind: "read",
    renders: "choose",
    describe:
      "This owner's own past conversations with this helper, to reopen one. The block already lists them — say one short sentence at most, never the list again in prose.",
    properties: {},
    run: async (username) => sessionsOf(username),
    block: (data, say) => {
      const sessions = data as { session: string; from: string; opening: string }[];
      if (sessions.length === 0) return null;
      return {
        shape: "choose",
        text: say("agent.block.pastConversations"),
        options: sessions.map((one) => ({
          value: one.session,
          label: one.opening || say("agent.tool.pastConversationUntitled"),
          detail: one.from.slice(0, 10),
          href: `/agent?c=${encodeURIComponent(one.session)}`,
        })),
      };
    },
  },
];
