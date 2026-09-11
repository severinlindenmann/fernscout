"use client";

import { useI18n } from "@/components/LocaleProvider";

/**
 * What the picker will let somebody choose — B791.
 *
 * `image/*,video/*` was the whole of it, and it refused every file B689's
 * inbox screen was built to read: a bank statement, a Google Timeline export,
 * a GPX track. The route behind it has filed those into the inbox since it was
 * written (`kindForExtension`, then `storeInboxFile`) — the server could take
 * them and the picker would not offer them, so a whole shipped feature was
 * reachable only with an API token.
 *
 * The extensions mirror `INBOX_FILE_EXTENSIONS` in `lib/inbox.ts`, which is
 * server-only (it reads the filesystem) and cannot be imported into a client
 * component; `test/agent-picker-accepts.test.ts` is what keeps the two lists
 * from drifting. A wrong guess is not a refusal either way — the route decides
 * — but a missing extension is a file a phone will grey out.
 */
export const PICKER_ACCEPT = "image/*,video/*,.csv,.pdf,.json,.txt,.gpx,.md,.vcf";

/**
 * The extensions that are *not* photographs — `INBOX_FILE_EXTENSIONS` in
 * `lib/inbox.ts`, which is server-only and cannot be imported here (B845).
 * `test/agent-picker-kinds.test.ts` keeps the two from drifting, the same way
 * `PICKER_ACCEPT` above is kept honest.
 */
const FILE_EXTENSIONS = [".csv", ".pdf", ".json", ".txt", ".gpx", ".md", ".vcf"];

/**
 * How many of a pick are photographs and how many are something else — B845.
 *
 * B791 widened the picker so a bank statement or a Timeline export could be
 * chosen, and the label did not follow: attaching `receipt.pdf` was answered
 * with "1 photo chosen", which is the screen calling a PDF a photograph and
 * giving no sign that anything different will happen to it.
 *
 * The split is by extension rather than by `File.type`, which is empty for a
 * HEIC on most phones and wrong for a `.gpx` on all of them — and by the
 * *same* extension list the route sorts on, so the count and the destination
 * cannot disagree.
 */
export function countKinds(files: File[]): { photos: number; files: number } {
  const isFile = (name: string) =>
    FILE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
  const other = files.filter((file) => isFile(file.name)).length;
  return { photos: files.length - other, files: other };
}

/**
 * A file picker whose words are ours — B768.
 *
 * `<input type="file">` draws its own button and its own "No file chosen" in
 * the *browser's* locale, from strings no CSS and no attribute can reach. So
 * the input is still the control — still focusable, still in the accessibility
 * tree, `sr-only` being the clipped-rect technique rather than `display: none`
 * — and a `<label>` in front of it carries our text. Clicking a label opens
 * the picker because that is what a label does; `peer-focus-visible` puts the
 * focus ring on the label when the input behind it has focus, which is the one
 * thing hiding an input otherwise costs.
 *
 * The count replaces "No file chosen" and is better than it anyway: the
 * browser names one file and says nothing about twelve.
 *
 * Extracted out of `AgentWizard.tsx` by B984, unchanged, so both the wizard
 * (while it still exists) and the room's files pane share one picker rather
 * than two copies of this reasoning drifting apart.
 */
export function PhotoPicker({
  id,
  chosen,
  disabled,
  accept = PICKER_ACCEPT,
  bare,
  onPick,
  showChosen = true,
}: {
  id: string;
  /** What is chosen right now — empty says so in words. Files rather than a
   *  count since B845: a receipt and a photograph are not the same noun and
   *  do not go to the same place. */
  chosen: File[];
  disabled?: boolean;
  /**
   * What this picker will take, defaulting to everything the inbox sorts —
   * B1012. `EditDay` narrows it to photographs and video, which is the whole
   * of what a correction to a day can add; the "goes to the inbox" note below
   * then falls away on its own, because `countKinds` counts nothing else.
   */
  accept?: string;
  /** Button only, no paragraphs — B1349: the room's files pane lays the
   *  picker beside the camera button and says the rest itself. */
  bare?: boolean;
  onPick: (files: FileList | null) => void;
  /**
   * Whether to say what is chosen right now — on by default. `HelperRoom`'s
   * files pane turns this off (B1272): its upload starts the instant a file
   * is picked and clears `chosen` back to empty on success, so "No photos
   * chosen" was appearing under the pane's own list of what had just landed,
   * reading as a claim about the pane rather than about this input. The room
   * has its own accurate status line for busy/landed/failed, so this one has
   * nothing true left to add there.
   */
  showChosen?: boolean;
}) {
  const { t, tn } = useI18n();
  const kinds = countKinds(chosen);
  // "3 Fotos und 1 Datei gewählt" — the two nouns pluralised on their own
  // counts and then joined, because one key carrying both would have to
  // decline both at once and no plural system here does that.
  const parts = [
    ...(kinds.photos > 0
      ? [tn("agent.photosPart", kinds.photos, { count: String(kinds.photos) })]
      : []),
    ...(kinds.files > 0
      ? [tn("agent.filesPart", kinds.files, { count: String(kinds.files) })]
      : []),
  ].join(` ${t("agent.andJoin")} `);
  return (
    <div className={bare ? "" : "mt-3"}>
      <input
        id={id}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        onChange={(event) => onPick(event.target.files)}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        // Quiet on both screens: the bright thing on a step is the one that
        // moves a person on from it, and there is only ever one — B767.
        className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-navy-300 bg-cream-100 px-5 text-base font-semibold text-navy-800 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 peer-disabled:opacity-50"
      >
        {t("agent.chooseFiles")}
      </label>
      {!bare && showChosen && (
        <p className="mt-2 text-sm text-navy-700">
          {chosen.length === 0 ? t("agent.noneChosen") : t("agent.chosenParts", { parts })}
        </p>
      )}
      {/* Where the thing that is not a photograph has gone — B845. Said only
          when one was actually chosen, because it is also the only place the
          import feature is advertised, and a sentence about the inbox on a
          screen holding twelve photographs is noise. */}
      {kinds.files > 0 && (
        <p role="status" className="mt-1 text-sm leading-6 text-navy-700">
          {t("agent.filesToInbox")}
        </p>
      )}
      {/* What may be dropped here, since it is no longer only photographs —
          B791. The route sorts them; this stops the screen lying about what
          is welcome. Only where anything else *is* welcome, though (B1012):
          it names the inbox, and a narrowed picker has no inbox behind it. */}
      {!bare && accept === PICKER_ACCEPT && (
        <p className="mt-1 text-sm leading-6 text-navy-600">{t("agent.pickAnyFile")}</p>
      )}
    </div>
  );
}
