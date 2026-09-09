import "server-only";
import type { Tool } from "../types";
import { isEnabled } from "../../../capabilities";
import { listInvites } from "../../../contacts/invites";
import { mailWouldReach } from "../../../digest/dayLetter";
import { whatsappWouldCost, whatsappWouldReach } from "../../../digest/dayWhatsapp";
import { DAY_ARGS } from "../args";
import { resolveDay, tripIdFor } from "../resolve";


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
     * Letting somebody read it — B931, and the half of that ticket that makes
     * the other half sayable.
     *
     * *"nur meine Tochter soll das lesen können"* had no answer here at all.
     * There was no invite tool, so the only thing the conversation could do
     * with a named person was set a visibility — and `private` means the
     * people who were on the trip, which is precisely the value that shuts
     * out somebody who stayed at home. The model said her daughter could read
     * it. Her daughter could not.
     *
     * **A guest link and a buddy link are different things and do not share a
     * tool.** Only the guest one is here: a guest link belongs in a family
     * group chat, a buddy link is write access to a trip and belongs on the
     * contacts page. `components/InviteToRead.tsx` draws the same line on the
     * day page for the same reason, and there is no `kind` argument for a
     * model to get wrong.
     *
     * **It grants nothing**, and the sentences say so rather than softening
     * it: whoever opens the link proves their own address and lands in the
     * owner's queue. `approveContact` is still the only thing in this
     * codebase that writes a grant, and the answer after the press is "they
     * can now ask", never "they now have access".
     */
    name: "invite_guest",
    kind: "write",
    renders: "form",
    describe:
      "Propose a link that lets somebody ask to read this journal — the answer when they name a person who should be able to read it. Nothing is made until they press, and it grants nothing even then: whoever opens it proves their own address and waits to be approved.",
    properties: {
      name: {
        type: "string",
        description:
          "Who the link is for, as they said it. It only says whose link it is; it lets nobody in.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/invite`,
    propose: async (_username, args, say) => ({
      sentence: say("agent.tool.inviteGuest"),
      accept: say("agent.tool.inviteGuestAccept"),
      done: say("agent.tool.inviteGuestDone"),
      fields: [{ name: "name", value: args.name ?? "" }],
    }),
  },
  {
    /**
     * Which links are out there — B1051, `invite_guest`'s missing other half.
     *
     * A link the owner cannot see again is a link they cannot revoke either:
     * "did I already send my mother one of these" had no answer but reissuing
     * one and hoping the first quietly expires. **Never the token** — AGENTS.md
     * is explicit that a link is shown once, at issue, and `listInvites` (as
     * opposed to `listInvitesWithLinks`, which the owner's own contacts page
     * uses) already answers with hashes turned into facts and nothing a model
     * could repeat into a message. This reads that function and nothing else.
     */
    name: "invites",
    kind: "read",
    renders: "choose",
    describe:
      "Every invite link this journal has issued: what kind, who it was for, when, and whether it has been used or revoked. Never the link itself — that exists once, at the moment it was made.",
    properties: {},
    run: async (username) => {
      if (!isEnabled("contacts", username)) return { contactsOff: true, invites: [] };
      const invites = await listInvites(username);
      return {
        contactsOff: false,
        invites: invites.map((invite) => ({
          id: invite.id,
          kind: invite.kind,
          name: invite.name,
          createdAt: invite.createdAt,
          revoked: invite.revokedAt !== null,
          used: invite.uses > 0,
        })),
      };
    },
    block: (data, say) => {
      const result = data as {
        contactsOff: boolean;
        invites: { id: string; kind: string; name: string | null; createdAt: string; revoked: boolean; used: boolean }[];
      };
      if (result.contactsOff || result.invites.length === 0) return null;
      return {
        shape: "choose",
        text: say("agent.block.invites"),
        options: result.invites.map((invite) => ({
          value: invite.id,
          label: invite.name ? `${invite.kind} — ${invite.name}` : invite.kind,
          detail: invite.revoked
            ? say("agent.block.invitesRevoked")
            : invite.used
              ? say("agent.block.invitesUsed")
              : say("agent.block.invitesWaiting"),
        })),
      };
    },
  },
  {
    /**
     * Taking one back — B1051, and the link this whole thing hinges on:
     * revoking is one row, `revokeInvite`'s own doc comment says so, and it
     * "removes nothing anybody wrote" — everybody already approved through it
     * stays exactly where they are. The sentence says that rather than
     * softening it into silence, for the same reason `invite_guest` says a
     * link grants nothing: the words have to carry what the mechanism
     * actually does.
     */
    name: "revoke_invite",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose taking back one invite link so it can never be used again. Everybody already approved through it keeps their access — this only stops a new redemption. Needs the link's id, as `invites` lists it.",
    properties: {
      invite: {
        type: "string",
        description: "Which invite to revoke, by the id `invites` gave it.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/invite/revoke`,
    propose: async (username, args, say) => {
      const invites = isEnabled("contacts", username) ? await listInvites(username) : [];
      const invite = invites.find((one) => one.id === (args.invite ?? "").trim());
      return {
        ...(invite ? {} : { refuse: "agent.tool.noInvite" }),
        sentence: invite
          ? say("agent.tool.revokeInvite", { kind: invite.kind })
          : say("agent.tool.noInvite"),
        accept: say("agent.tool.revokeInviteAccept"),
        done: say("agent.tool.revokeInviteDone"),
        fields: [{ name: "invite", value: invite?.id ?? "" }],
      };
    },
  },
  {
    /**
     * Announcing a day that is already on the site — B1051. `send-mail` and
     * `send-whatsapp` are two routes in `/api/v1` because mail is free and
     * WhatsApp spends credits and Meta invoices per message; they are **one**
     * tool here because a person says "tell them", not which transport, and
     * the prompt budget cannot carry two rows that differ in one field.
     *
     * **Reach and cost are read from the same functions the routes send
     * with** (`mailWouldReach`, `whatsappWouldReach`, `whatsappWouldCost`) —
     * never a hand-rolled count, which is exactly the duplication those
     * functions' own doc comments warn against.
     *
     * Refuses a day still in draft: `publish_day` puts a day on the site,
     * this tells people about it, and the two must not be reachable out of
     * order — there is nobody to tell about a day nobody can read yet.
     */
    name: "tell_readers",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose announcing a published day — by mail (free) or WhatsApp (spends credits). Refused for a day still in draft: publish it first. Ask which channel if they did not say; default to mail.",
    properties: {
      ...DAY_ARGS,
      channel: {
        type: "string",
        description: "mail or whatsapp. Leave out only when they truly did not say.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/tell-readers`,
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      const channel: "mail" | "whatsapp" = args.channel === "whatsapp" ? "whatsapp" : "mail";

      if (found?.entry.draft) {
        return {
          refuse: "agent.tool.tellReadersDraft",
          sentence: say("agent.tool.tellReadersDraft"),
          accept: "",
          done: "",
          fields: [],
        };
      }

      const reach = found
        ? channel === "whatsapp"
          ? await whatsappWouldReach(username, found.trip.ref, found.entry.slug)
          : await mailWouldReach(username, found.trip.ref, found.entry.slug)
        : 0;
      const cost =
        found && channel === "whatsapp"
          ? await whatsappWouldCost(username, found.trip.ref, found.entry.slug)
          : 0;

      const sentence = !found
        ? say("agent.tool.publishNoDay")
        : channel === "whatsapp"
          ? say("agent.tool.tellReadersWhatsapp", {
              date: found.entry.date,
              title: found.entry.title,
              count: String(reach),
              credits: String(cost),
            })
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
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          {
            name: "channel",
            value: channel,
            options: [
              { value: "mail", label: say("agent.tool.channelMail") },
              { value: "whatsapp", label: say("agent.tool.channelWhatsapp") },
            ],
          },
        ],
      };
    },
  },
  {
    /**
     * The two switches themselves — B1051, and the reason it lives beside
     * `tell_readers` rather than in `areas/journal.ts`: both are about what
     * reaches a reader, and this is the one that decides whether anything
     * does at all. `POST /api/v1/<user>/channels` is the route it mirrors,
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
