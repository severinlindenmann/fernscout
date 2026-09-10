import "server-only";
import type { Tool } from "../types";
import { DAY_ARGS } from "../args";
import { AS_AUTHOR, getEntryBySlug } from "../../../entries";
import { findInboxFile, listInbox } from "../../../inbox";
import { formatBytes } from "../../../storageQuota";
import { getTrips } from "../../../trips";
import { resolveDay, tripIdFor } from "../resolve";

/** What kind of thing an inbox entry is, in the words a person reads rather
 *  than the folder name — `INBOX_KINDS` from `lib/inbox.ts`. */
const INBOX_KIND_WORD: Record<string, string> = {
  media: "photograph",
  files: "file",
  photobook: "photobook order",
  postcards: "postcard order",
};

/**
 * The day and the photograph a tick in the files pane names — B925's own
 * trick, for a photograph rather than a staged file.
 *
 * `describeSelection` already resolves a `photo:<slug>:<src>` id this way to
 * say what is selected; this is the same walk, kept small, because the id
 * carries no trip and the entry it names could be in any of them.
 */
function entryWithPhoto(username: string, slug: string, src: string) {
  for (const trip of getTrips(username)) {
    const entry = getEntryBySlug(trip.ref, slug, AS_AUTHOR);
    const item = entry?.gallery.find((one) => one.src === src);
    if (entry && item) return { trip, entry, item };
  }
  return null;
}

/**
 * Photographs and the files waiting to become them.
 *
 * One area of the registry — B1042. The tools were a nine-hundred-line array
 * in a single file, which is a file two people cannot edit at once and nobody
 * can read the shape of. What decides where a tool lives is what a person is
 * doing, not which route it posts to.
 */
export const FILES_TOOLS: readonly Tool[] = [
  {
    /**
     * The photographs already waiting, put on a day — B915.
     *
     * The one sentence the files pane exists for. A person ticks two
     * photographs in the inbox and says "put these on yesterday"; the ids ride
     * into the conversation on the selection line (`describeSelection`,
     * lib/helper/server.ts), and this proposes the move — the files named, the
     * day named, and nothing moved until the press.
     *
     * **It does not upload anything**, which is why `add_photos` below still
     * exists and still hands over the day's own page: bytes from a camera are
     * a picker and a file input, and neither is a sentence. This moves files
     * this journal already has, through the same
     * `attachStagedFiles` the documented v1 route calls, so the same
     * duplicate rule holds at both doors — the inbox names a file by a hash of
     * its bytes, so the same photograph offered twice is recognised rather
     * than stored again.
     */
    name: "attach_files",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose putting photographs waiting in the inbox onto a day — \"put these on yesterday\", \"the ones waiting\", about the files pane. Leave `files` out: what they ticked is used, and with nothing ticked every waiting photograph is proposed by name for them to check. Never ask them for an id.",
    properties: {
      ...DAY_ARGS,
      files: {
        type: "string",
        description: "Omit it: the ticked files are used, or all waiting photographs when nothing is ticked.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/attach`,
    propose: async (username, args, say, _today, selected) => {
      const found = resolveDay(username, args);
      /**
       * **The selection is resolved here, not read out by a person** — B925.
       *
       * The browser sends what is ticked on every turn. It used to reach the
       * tool only as a sentence in the model's context, so a model that did
       * not copy the ids asked *them* for ids — which appear nowhere on the
       * screen. What the model says is used when it says something; otherwise
       * the tick is the answer.
       *
       * **And with nothing ticked at all, the answer is everything waiting**
       * — B1189. "Put the photos waiting in my inbox on today" with empty
       * hands used to propose nothing, one turn after the `inbox` read had
       * listed those very files by name: a claim and its contradiction in
       * one message. The proposal is what makes the fallback safe — every
       * file is named on the card, and nothing moves until the press.
       */
      const waiting = Object.values(listInbox(username))
        .flat()
        .filter((entry) => entry.kind === "media");
      const explicit = (args.files ?? "").trim();
      const ticked = selected
        .filter((id) => id.startsWith("inbox:"))
        .map((id) => id.slice("inbox:".length));
      // Resolved against disk, here as well as in the route: an id is a
      // reference and never a fact, and a proposal must name the files a
      // person will actually get rather than the ones a model typed. A
      // model that typed a *filename* instead of an id is answered too —
      // the filename is on the screen, the id never is.
      const names: string[] = [];
      const ids: string[] = [];
      const take = (entry: { id: string; filename: string }) => {
        if (ids.includes(entry.id)) return;
        names.push(entry.filename);
        ids.push(entry.id);
      };
      if (explicit !== "") {
        for (const asked of explicit.split(",")) {
          const token = asked.trim();
          const staged = findInboxFile(username, token);
          if (staged && staged.entry.kind === "media") take(staged.entry);
          else {
            const byName = waiting.find((entry) => entry.filename === token);
            if (byName) take(byName);
          }
        }
      } else if (ticked.length > 0) {
        for (const asked of ticked) {
          const staged = findInboxFile(username, asked.trim());
          if (staged && staged.entry.kind === "media") take(staged.entry);
        }
      } else {
        for (const entry of waiting) take(entry);
      }
      // Either both or neither: a day with no files and files with no day are
      // the same refusal, and it says so rather than proposing half a move.
      const onto = names.length > 0 ? found : null;
      return {
        sentence: onto
          ? say("agent.tool.attachFiles", {
              count: String(names.length),
              date: onto.entry.date,
              title: onto.entry.title,
            })
          : say("agent.tool.attachNone"),
        accept: say("agent.tool.attachFilesAccept"),
        done: say("agent.tool.attachFilesDone"),
        // The files by name, and the day they are going on, before the press.
        // Their own filenames: nothing here is this software's prose.
        preview: onto ? [`${onto.entry.date} — ${onto.entry.title}`, ...names] : [],
        fields: [
          { name: "trip", value: tripIdFor(username, args, found), fixed: true },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "", fixed: true },
          { name: "files", value: ids.join(",") },
        ],
      };
    },
  },
  {
    /**
     * Photographs come in through the room's own pane now — B1220 (D52).
     * This used to hand people out to the step-wizard page; since B1171
     * the pane uploads into the inbox and `attach_files` puts things on a
     * day, so the honest answer is a sentence about the controls already
     * on this screen. Server text, not the model's — the screen-claim
     * guard checks the model's own answer, never a tool's block.
     */
    name: "add_photos",
    kind: "read",
    renders: "say",
    describe:
      "How photographs are added: say where the controls on this screen are. Use this whenever they want to put pictures on a day.",
    properties: DAY_ARGS,
    run: async () => ({ wrote: false }),
    block: (_data, say) => ({ shape: "say", text: say("agent.tool.addPhotosPane") }),
  },
  {
    /**
     * What is staged and belongs to no day yet — for talking about it, not
     * for drawing a second pane.
     *
     * The files pane already shows this on the screen (`FilesPane`,
     * `components/HelperRoom.tsx`); this exists so "was liegt noch rum?"
     * gets an answer in the conversation itself, without a person having to
     * look sideways at a pane that may be scrolled out of view. **Nothing on
     * a sidecar is reachable by URL** (`lib/inbox.ts`), so what goes on the
     * screen is a filename and a rough size, and the id — a hash of the
     * file's own bytes, safe to say for the same reason `describeSelection`
     * already says it for `attach_files`.
     */
    name: "inbox",
    kind: "read",
    renders: "files",
    describe:
      "What is waiting in the inbox and belongs to no day yet — what each file is and roughly how big.",
    properties: {},
    run: async (username) =>
      Object.values(listInbox(username))
        .flat()
        .map((entry) => ({
          id: entry.id,
          filename: entry.filename,
          kind: entry.kind,
          bytes: entry.bytes,
        })),
    block: (data, say) => {
      const staged = data as { id: string; filename: string; kind: string; bytes: number }[];
      if (staged.length === 0) return null;
      return {
        shape: "files",
        text: say("agent.block.inbox"),
        files: staged.map((file) => ({
          id: file.id,
          name: `${file.filename} — ${INBOX_KIND_WORD[file.kind] ?? file.kind}, ${formatBytes(file.bytes)}`,
        })),
      };
    },
  },
  {
    /**
     * The one irreversible thing in this area — B851's own sentence, said
     * before a press rather than found out after one.
     *
     * `detachGallery` (`lib/api/entries.ts`) deletes the derivative and the
     * kept original from disk — nothing here is a takedown like
     * `unpublish_day`, which only changes `status:`. So this renders a
     * `preview` of the photograph before the `confirm`, the same order
     * `publish_day` uses for the same reason: read it back before it is gone.
     *
     * The photograph is never named by the model. It comes from a tick in
     * the files pane (`photo:<slug>:<src>`, the same id `describeSelection`
     * already reads out) or, failing that, from `src` when somebody typed
     * one out — but a `src` that resolves to nothing proposes nothing rather
     * than proposing the wrong photograph, which is the whole of what this
     * tool must never do.
     */
    name: "remove_photo",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose taking one photograph off a day. This deletes it — the picture and its kept original both — and there is no undo. Use it only for a named photograph, never for a whole day.",
    properties: {
      ...DAY_ARGS,
      src: { type: "string", description: "Omit it: the ticked photograph is used." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/remove-photo`,
    propose: async (username, args, say, _today, selected) => {
      const askedSrc = (args.src ?? "").trim();
      const ticked = selected.find((id) => id.startsWith("photo:"));
      let target: ReturnType<typeof entryWithPhoto> = null;
      if (askedSrc !== "") {
        const found = resolveDay(username, args);
        const item = found?.entry.gallery.find((one) => one.src === askedSrc);
        target = found && item ? { trip: found.trip, entry: found.entry, item } : null;
      } else if (ticked) {
        const rest = ticked.slice("photo:".length);
        const at = rest.indexOf(":");
        if (at >= 0) target = entryWithPhoto(username, rest.slice(0, at), rest.slice(at + 1));
      }
      return {
        ...(target ? {} : { refuse: "agent.tool.removePhotoNone" }),
        sentence: target
          ? say("agent.tool.removePhoto", { date: target.entry.date, title: target.entry.title })
          : "",
        accept: say("agent.tool.removePhotoAccept"),
        done: say("agent.tool.removePhotoDone"),
        // The picture, before the button: its own filename, never this
        // software's prose about it.
        preview: target
          ? [`${target.entry.date} — ${target.entry.title}`, target.item.from ?? target.item.src]
          : [],
        fields: [
          { name: "trip", value: target?.trip.id ?? "", fixed: true },
          { name: "slug", value: target?.entry.slug ?? "", fixed: true },
          { name: "src", value: target?.item.src ?? "", fixed: true },
        ],
      };
    },
  },
  {
    /**
     * Throwing away a file nobody put on a day — the inbox's own take-back,
     * with this family's credential. `DELETE /api/v1/<user>/inbox/<id>` has
     * done this since B663; a browser here holds a cookie and no bearer
     * token, so that door was never reachable from the room.
     *
     * No preview and no picture: an inbox file is not yet on the site, not
     * yet read by anyone, and `removeInboxFile` is the same one-step take-back
     * the v1 route already offers without a confirmation code. `confirm` here
     * is only the ordinary "nothing happens until they press" rule every
     * write in this registry follows.
     */
    name: "discard_file",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose throwing away one file waiting in the inbox — not yet on any day. Never for a photograph already on a day; remove_photo is that.",
    properties: {
      // Named `file` rather than `id`: `revoke_key` also asks for an `id`, and
      // a slot's label is looked up by the field's own name — one `agent.slot.id`
      // cannot read correctly for both a key and a photograph waiting in an inbox.
      file: { type: "string", description: "Omit it: the ticked file is used." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/inbox/discard`,
    propose: async (username, args, say, _today, selected) => {
      const asked = (args.file ?? "").trim();
      const ticked = selected.find((id) => id.startsWith("inbox:"))?.slice("inbox:".length);
      const found = findInboxFile(username, asked !== "" ? asked : (ticked ?? ""));
      return {
        ...(found ? {} : { refuse: "agent.tool.discardFileNone" }),
        sentence: found ? say("agent.tool.discardFile", { filename: found.entry.filename }) : "",
        accept: say("agent.tool.discardFileAccept"),
        done: say("agent.tool.discardFileDone"),
        fields: [{ name: "file", value: found?.entry.id ?? "", fixed: true }],
      };
    },
  },
];
