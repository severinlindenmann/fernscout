import "server-only";
import type { Tool } from "../types";
import { isEnabled } from "../../../capabilities";
import { mailWouldReach } from "../../../digest/dayLetter";
import { DAY_ARGS } from "../args";
import { resolveDay, tripIdFor } from "../resolve";


import { journalPath } from "../../../journalPath";
/**
 * Letting somebody else read it.
 *
 * One area of the registry — B1042. The tools were a nine-hundred-line array
 * in a single file, which is a file two people cannot edit at once and nobody
 * can read the shape of. What decides where a tool lives is what a person is
 * doing, not which route it posts to.
 */
export const READERS_TOOLS: readonly Tool[] = [
  {
    /**
     * Letting somebody read it — B931 built `invite_guest` here; B2295 (one
     * door for readers, B2291) took it, `invites` and `revoke_invite` back
     * out. The owner decided `/@<user>/studio/readers` is the only place a
     * person is let in or an invite link is made, seen again or revoked — no
     * agent, on the web or on WhatsApp, does any of that any more. This is
     * what is left: a link to the one page, so "invite my daughter" still
     * gets an answer rather than a dead end.
     */
    name: "invite_to_read",
    kind: "link",
    renders: "link",
    describe:
      "Where to add or invite a reader or a buddy. Hands over the page only — nothing here lets anybody in.",
    properties: {},
    link: (username, _args, say) => ({
      text: say("agent.tool.inviteToRead"),
      href: `${journalPath(encodeURIComponent(username))}/studio/readers`,
      label: say("agent.tool.inviteToReadLabel"),
    }),
  },
  {
    /**
     * Announcing a day that is already on the site — B1051. B2597 retired
     * WhatsApp and SMS as reader channels (no plan includes either any more),
     * so this tells by mail — the only channel left, and free.
     *
     * **Reach is read from the same function the route sends with**
     * (`mailWouldReach`) — never a hand-rolled count, which is exactly the
     * duplication that function's own doc comment warns against.
     *
     * Refuses a day still in draft: `publish_day` puts a day on the site,
     * this tells people about it, and the two must not be reachable out of
     * order — there is nobody to tell about a day nobody can read yet.
     */
    name: "tell_readers",
    kind: "write",
    renders: "confirm",
    describe: "Propose announcing a published day by mail (free). Refused for a day still in draft: publish it first.",
    properties: { ...DAY_ARGS },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/tell-readers`,
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);

      if (found?.entry.draft) {
        return {
          refuse: "agent.tool.tellReadersDraft",
          sentence: say("agent.tool.tellReadersDraft"),
          accept: "",
          done: "",
          fields: [],
        };
      }

      const reach = found ? await mailWouldReach(username, found.trip.ref, found.entry.slug) : 0;

      const sentence = !found
        ? say("agent.tool.publishNoDay")
        : say("agent.tool.tellReadersMail", {
            date: found.entry.date,
            title: found.entry.title,
            count: String(reach),
          });

      return {
        sentence,
        accept: say("agent.tool.tellReadersAccept"),
        done: say("agent.tool.tellReadersDone"),
        fields: [
          { name: "trip", value: tripIdFor(username, args, found), fixed: true },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "", fixed: true },
        ],
      };
    },
  },
  {
    /**
     * The two switches themselves — B1051, and the reason it lives beside
     * `tell_readers` rather than in `areas/journal.ts`: both are about what
     * reaches a reader, and this is the one that decides whether anything
     * does at all. `PATCH /api/v2/<user>/channels` is the route it mirrors,
     * and this stays within the same closed pair it validates against
     * (`mail`, `whatsapp`) rather than growing into the settings surface that
     * route's own doc comment is explicit must not exist.
     *
     * The ceiling — whether this **server** offers a channel at all — is
     * asked without a username, exactly as `journalFeatures`'s own doc
     * comment describes it; a journal's own switch is asked with one. A
     * channel the server never turned on is refused outright rather than
     * offered as something to flip, because there would be nothing under the
     * switch.
     */
    name: "channels",
    kind: "write",
    renders: "form",
    describe:
      "Propose switching this journal's mail or WhatsApp sending on or off. Nothing changes until they press.",
    properties: {
      channel: { type: "string", description: "mail or whatsapp." },
      enabled: { type: "string", description: "on or off, as they said it." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/channels`,
    propose: async (username, args, say) => {
      const channel: "mail" | "whatsapp" = args.channel === "whatsapp" ? "whatsapp" : "mail";
      if (!isEnabled(channel)) {
        return {
          refuse: "agent.tool.channelUnavailable",
          sentence: say("agent.tool.channelUnavailable"),
          accept: "",
          done: "",
          fields: [],
        };
      }

      const current = isEnabled(channel, username);
      const said = (args.enabled ?? "").toLowerCase();
      const off = /off|aus|kikapcsol|stop|mute/.test(said);
      const on = /on|ein|bekapcsol|start|enable/.test(said);
      const enabled = off ? false : on ? true : current;

      return {
        sentence: say(enabled ? "agent.tool.channelsOn" : "agent.tool.channelsOff", { channel }),
        accept: say("agent.tool.channelsAccept"),
        done: say("agent.tool.channelsDone"),
        fields: [
          {
            name: "channel",
            value: channel,
            options: [
              { value: "mail", label: say("agent.tool.channelMail") },
              { value: "whatsapp", label: say("agent.tool.channelWhatsapp") },
            ],
          },
          {
            name: "enabled",
            value: enabled ? "on" : "off",
            options: [
              { value: "on", label: say("agent.tool.channelOn") },
              { value: "off", label: say("agent.tool.channelOff") },
            ],
          },
        ],
      };
    },
  },
];
