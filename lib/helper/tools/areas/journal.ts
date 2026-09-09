import "server-only";
import type { Tool } from "../types";
import { balanceOf } from "../../../credits";
import { formatBytes, storageFor } from "../../../storageQuota";

/**
 * The journal's own account — credits and room.
 *
 * One area of the registry — B1042. The tools were a nine-hundred-line array
 * in a single file, which is a file two people cannot edit at once and nobody
 * can read the shape of. What decides where a tool lives is what a person is
 * doing, not which route it posts to.
 */
export const JOURNAL_TOOLS: readonly Tool[] = [
  {
    /** Credits and disk in one answer — the two questions about the account
     *  itself, which nobody asks one at a time. */
    name: "account",
    kind: "read",
    renders: "say",
    describe:
      "This journal's own account: credits left, and disk space used out of what it may. Credits pay for the model, captions, transcription and printing, not a trip's money (trip_costs). A null balance means this server charges for nothing. Bytes only — never where anything is.",
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
];
