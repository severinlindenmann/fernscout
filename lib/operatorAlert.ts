import "server-only";
import type { MailBlock } from "./mail/template";
import type { Composition } from "./messages/previews/types";
import { statusColumns, statusNotes, statusSummary, type StatusReport } from "./statusReport";

/** `op.alert` is always mail — the narrower slice of `Composition` this
 * module hands back so a caller may read `.content` without a channel
 * check it already knows the answer to. */
type MailComposition = Extract<Composition, { channel: "mail" }>;

/**
 * `op.alert`'s composition — pulled out of `scripts/alert.mts` (B2493) so
 * the same wording composes an admin preview and the real alert. Nothing
 * here reads a file or walks a journal: the caller (the script, for a real
 * send; the preview, with sample values) hands over the status report — or
 * none — already collected.
 */
export type OperatorAlertInput = {
  unit: string;
  succeeded: boolean;
  hostname: string;
  /** Already formatted, minute precision — "2026-09-27 21:04 UTC". */
  when: string;
  siteName: string;
  siteUrl: string;
  /** The full status report — only ever given when the recipient may see it
   * (an operator address, on a success). */
  report: StatusReport | null;
  /** True when a report exists to withhold because this recipient is not an
   * operator address, on an otherwise-reportable success — see
   * `scripts/alert.mts`'s own `mayHaveReport`. */
  reportWithheldNotOperator: boolean;
  /** The failure's own piped-in journal tail, when there is one. */
  piped: string;
};

export function composeOperatorAlert(input: OperatorAlertInput): MailComposition {
  const { unit, succeeded, hostname, when, siteName, siteUrl, report, reportWithheldNotOperator, piped } = input;
  const subject = `[${siteName}] ${unit} ${succeeded ? "succeeded" : "failed"}`;
  const title = succeeded ? "The backup finished cleanly" : "The backup failed";
  const opening = `${unit} on ${hostname}, ${when}.`;
  const blocks: MailBlock[] = [{ kind: "paragraph", text: opening }];

  if (report) {
    const summary = statusSummary(report);
    const columns = statusColumns(report);
    blocks.push(
      { kind: "heading", text: summary.headline },
      { kind: "meta", text: summary.lines.join(" · ") },
      {
        kind: "table",
        head: ["journal", ...columns.map((c) => c.head)],
        rows: report.journals.map((row) => ({
          cells: [row.username, ...columns.map((c) => c.of(row))],
          note:
            [row.current ? `on the road: ${row.current}` : "", row.listed ? "" : "unlisted"]
              .filter(Boolean)
              .join(" · ") || undefined,
        })),
      },
    );
    for (const note of statusNotes(report)) blocks.push({ kind: "meta", text: note });
    if (report.problems.length) {
      const n = report.problems.length;
      blocks.push({ kind: "paragraph", text: `${n} part${n === 1 ? "" : "s"} of this report could not be read:` });
      blocks.push({ kind: "code", text: report.problems.join("\n") });
    }
  } else if (reportWithheldNotOperator) {
    blocks.push({
      kind: "paragraph",
      text:
        "The status report is not included: it names every journal on this instance, and this mail is " +
        "going to the default journal's owner rather than to an operator address. Set BACKUP_ALERT_EMAIL " +
        "in the environment to receive it.",
    });
  } else if (piped) {
    blocks.push({ kind: "code", text: piped });
  }

  if (!succeeded) {
    blocks.push({ kind: "heading", text: "What to look at" });
    blocks.push({
      kind: "code",
      text: [`systemctl status ${unit}     # how the last run ended`, `journalctl -u ${unit} -n 50  # why`].join("\n"),
    });
  }
  if (siteUrl) {
    blocks.push({
      kind: "item",
      title: `${siteUrl}/api/health`,
      meta: "the .backup block, from anywhere",
      href: `${siteUrl}/api/health`,
    });
  }

  const why = `Sent by scripts/alert.sh, from the unit's ${succeeded ? "OnSuccess=" : "OnFailure="}.`;

  return {
    channel: "mail",
    subject,
    content: { template: "op.alert", preheader: opening, title, blocks, why },
  };
}
