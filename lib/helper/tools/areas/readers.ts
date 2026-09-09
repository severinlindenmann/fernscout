import "server-only";
import type { Tool } from "../types";


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
];
