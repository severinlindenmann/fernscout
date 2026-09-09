import "server-only";
import type { Tool } from "../types";
import { DAY_ARGS } from "../args";
import { findInboxFile } from "../../../inbox";
import { resolveDay, tripIdFor } from "../resolve";

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
      "Propose putting photographs waiting in the inbox onto a day — \"put these on yesterday\", about the files pane. Leave `files` out: what they ticked is known here. Never ask them for an id.",
    properties: {
      ...DAY_ARGS,
      files: {
        type: "string",
        description: "Omit it: the ticked files are used.",
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
       */
      const asking =
        (args.files ?? "").trim() !== ""
          ? (args.files ?? "").split(",")
          : selected.filter((id) => id.startsWith("inbox:")).map((id) => id.slice("inbox:".length));
      // Resolved against disk, here as well as in the route: an id is a
      // reference and never a fact, and a proposal must name the files a
      // person will actually get rather than the ones a model typed.
      const names: string[] = [];
      const ids: string[] = [];
      for (const asked of asking) {
        const staged = findInboxFile(username, asked.trim());
        if (!staged || staged.entry.kind !== "media") continue;
        names.push(staged.entry.filename);
        ids.push(staged.entry.id);
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
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          { name: "files", value: ids.join(",") },
        ],
      };
    },
  },
  {
    /**
     * Photographs are files, and files are not a sentence. The day's own page
     * has the picker, the upload and what the camera recorded; this hands
     * somebody to it, on the right day, and changes nothing. Choosing files
     * inside the conversation is round 6 of the plan.
     */
    name: "add_photos",
    kind: "link",
    renders: "link",
    describe:
      "Where photographs are added to a day — the picker, what the camera recorded, and the upload. Use this whenever they want to put pictures on a day. It only hands them the page.",
    properties: DAY_ARGS,
    link: (username, args, say) => {
      const query = new URLSearchParams(
        Object.entries({ trip: args.trip ?? "", slug: args.slug ?? "", date: args.date ?? "" }).filter(
          ([, value]) => value !== "",
        ),
      ).toString();
      return {
        text: say("agent.tool.addPhotos"),
        href: `/agent/${encodeURIComponent(username)}${query ? `?${query}` : ""}`,
        label: say("agent.tool.addPhotosLabel"),
      };
    },
  },
];
