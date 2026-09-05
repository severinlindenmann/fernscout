/**
 * Mail an operator how a systemd unit ended.
 *
 *   scripts/alert.sh fernscout-backup.service      # the normal caller
 *   npm run alert -- --unit fernscout-backup.service < detail.txt
 *   npm run alert -- --unit fernscout-backup.service --outcome success
 *   npm run alert -- --unit fernscout-backup.service --dry-run
 *
 * **`--outcome` defaults to `failure`**, and every other value reads as
 * `failure` too. A caller that cannot tell how the run ended must not be able
 * to announce a success by saying nothing (B458).
 *
 * The message body is read from stdin, so the caller decides how much journal
 * to include and this script never shells out to `journalctl` itself.
 *
 * **Who gets it:** `BACKUP_ALERT_EMAIL`, or the default journal's `owner.email`
 * from `content/<user>/config.json`. An operator address is not a secret, but
 * it is deployment configuration, which is why the env var wins.
 *
 * **No mail account needed to test this.** With the file transport (the
 * default) the alert lands as an `.eml` under `content/<user>/mail/`, which is
 * the whole point of `lib/mail` — the alarm can be rehearsed on a laptop.
 *
 * Exit codes, because `scripts/alert.sh` distinguishes them:
 *   0  sent
 *   3  mail is switched off on this instance — not a failure, but nothing was
 *      sent, and the caller should say so rather than claim it told somebody
 *   1  tried and failed
 *
 * Run through `npm run alert`, not `tsx` directly: `lib/mail` pulls in modules
 * marked `server-only`, which need the `react-server` export condition the npm
 * script supplies.
 */
import { isEnabled } from "../lib/capabilities";
import { sendTransactional } from "../lib/mail";
import { renderMail, type MailBlock } from "../lib/mail/template";
import { loadServerConfig } from "../lib/config";
import { getDefaultUsername, getUser } from "../lib/users";
import {
  collectStatus,
  statusColumns,
  statusNotes,
  statusSummary,
} from "../lib/statusReport";

const argv = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const unit = valueOf("--unit") ?? "an unnamed unit";
const dryRun = argv.includes("--dry-run");
// Anything that is not exactly "success" is a failure, including a typo and
// including nothing at all. See the note at the top of this file.
const succeeded = valueOf("--outcome") === "success";

function readStdin(): Promise<string> {
  // A caller with nothing to add closes stdin immediately; a tty means somebody
  // ran this by hand, and waiting forever for them to type would look like a
  // hang inside an OnFailure handler.
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (buffer += chunk));
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", () => resolve(buffer));
  });
}


function recipient(): { to: string; username?: string; isOperator: boolean } | null {
  const configured = process.env.BACKUP_ALERT_EMAIL?.trim();
  const username = getDefaultUsername() ?? undefined;
  if (configured) return { to: configured, username, isOperator: true };
  const owner = username ? getUser(username)?.owner : undefined;
  // The fallback, and what it is *not*. This address comes out of a journal's
  // own config.json, so it is "somebody who will notice", which is the whole
  // point on a box nobody configured — B64 is what silence costs. It is not
  // evidence that the reader operates the machine, and B468 is where that
  // distinction started to matter: see `detail` below.
  return owner?.email ? { to: owner.email, username, isOperator: false } : null;
}

const piped = (await readStdin()).trimEnd();
const to = recipient();

/**
 * The success body names every journal on the instance — unlisted ones
 * included — with its guests, its credits and its size (B464). That is an
 * operator's inventory, and it may only go to an address an *operator* chose.
 *
 * `BACKUP_ALERT_EMAIL` is that address. The fallback is the default journal's
 * `owner.email`, which is a journal's file rather than the machine's
 * configuration: on a shared instance the person who happens to own the
 * default journal is not the person running the box, and one edit to that
 * field would redirect the roster. Withheld rather than redacted — a summary
 * of a report nobody may read is still a report.
 *
 * Only the success path. A failure still goes to the fallback in full: an
 * unreachable backup has to reach *somebody*, and the journal tail it carries
 * is the same one it has always carried.
 */
const mayHaveReport = succeeded && to !== null && to.isOperator;

/**
 * Collected here rather than piped in as prose (B475). `scripts/alert.sh` used
 * to run `npm run status` and hand over its terminal output, which this file
 * could only wrap in a `<pre>` — a table already padded to a monospace grid is
 * not something a mail client can lay out. With the data in hand the HTML part
 * gets a real `<table>` and the text part gets the same grid as before.
 *
 * And it is only collected when it will be sent: withholding used to happen
 * after the walk, so a report going nowhere still counted every journal and
 * walked every byte.
 */
const report = mayHaveReport ? await collectStatus() : null;
const site = (() => {
  try {
    return loadServerConfig().site;
  } catch {
    return { name: "Fernscout", url: "" };
  }
})();

const subject = `[${site.name}] ${unit} ${succeeded ? "succeeded" : "failed"}`;
// The heading inside the letter is not the subject line. The subject carries
// the instance name in brackets so it sorts in an inbox; repeating that as an
// `<h1>` is how a mail ends up shouting its own filing label at its reader.
const title = succeeded ? "The backup finished cleanly" : "The backup failed";
// The heading says the outcome; this says which unit, where and when. Saying
// "finished cleanly" twice, once under the other, is what it did first.
//
// Minute precision, and a space instead of the `T`: an ISO instant is 24
// characters of unbroken punctuation that a 560px column wraps in the middle
// of, and nobody reading a backup mail needs the milliseconds.
const when = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
const opening = `${unit} on ${process.env.HOSTNAME ?? "this host"}, ${when}.`;

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
        // The two facts only some journals have, and neither of which earns a
        // column: where they are, and whether anybody is told they exist.
        note: [row.current ? `on the road: ${row.current}` : "", row.listed ? "" : "unlisted"]
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
} else if (succeeded && to !== null && !to.isOperator) {
  // B468: the roster names every journal on the instance, and this address
  // came out of a journal's config rather than the operator's. Withheld rather
  // than redacted — a summary of a report nobody may read is still a report.
  blocks.push({
    kind: "paragraph",
    text:
      "The status report is not included: it names every journal on this instance, and this mail is " +
      "going to the default journal's owner rather than to an operator address. Set BACKUP_ALERT_EMAIL " +
      "in the environment to receive it.",
  });
} else if (piped) {
  // A failure: the journal tail, monospaced, as it has always been.
  blocks.push({ kind: "code", text: piped });
}

// A failure's next question is "why", and the two commands that answer it. A
// success has no next question — pointing a reader at `journalctl` to confirm
// that nothing is wrong is exactly the log-reading this mail exists to replace
// (B464). It keeps the health URL, which is the one thing worth a click.
if (!succeeded) {
  blocks.push({ kind: "heading", text: "What to look at" });
  blocks.push({
    kind: "code",
    text: [`systemctl status ${unit}     # how the last run ended`, `journalctl -u ${unit} -n 50  # why`].join("\n"),
  });
}
// A link rather than a line of monospace: it is a URL, and the one thing in
// this letter worth a click.
if (site.url) {
  blocks.push({
    kind: "item",
    title: `${site.url}/api/health`,
    meta: "the .backup block, from anywhere",
    href: `${site.url}/api/health`,
  });
}

const footer = `Sent by scripts/alert.sh, from the unit's ${succeeded ? "OnSuccess=" : "OnFailure="}.`;

/** The plain-text part, which is also what `--dry-run` prints and what lands in
 * a terminal mail client. `renderMail` builds it from the same blocks, so there
 * is no second composition to keep in step. */
function textOf(mail: { text: string }): string {
  return mail.text;
}

if (dryRun) {
  const target = to;
  console.log(`[alert] --dry-run; would send to ${target?.to ?? "(nobody — no BACKUP_ALERT_EMAIL and no owner email)"}`);
  console.log(
    textOf(
      renderMail(target?.to ?? "nobody@invalid", subject, {
        preheader: opening,
        title,
        blocks,
        footer,
      }),
    ),
  );
  process.exit(target ? 0 : 1);
}

if (!isEnabled("mail")) {
  // Mail is off by default on every instance (AGENTS.md), so this is the
  // ordinary case, not a fault. Say what still knows, so the operator reading
  // the journal does not go looking for a mail that was never going to exist.
  console.error(
    `[alert] mail is switched off on this instance — nothing was sent for ${unit}. ` +
      "How the run ended is recorded in DATA_DIR and reported by /api/health.",
  );
  process.exit(3);
}

const target = to;
if (!target) {
  console.error(
    "[alert] nobody to tell: set BACKUP_ALERT_EMAIL, or give the default journal an owner.email in content/<user>/config.json.",
  );
  process.exit(1);
}

try {
  // Transactional on purpose: this is the box saying how its backup went, not
  // the journal writing to anybody. `username` here only decides which folder
  // the `.eml` lands in, and a journal that has switched off letters to its
  // readers has said nothing about whether the operator should hear that the
  // backups stopped — B64 is what that silence costs. See B60.
  const result = await sendTransactional(
    renderMail(
      target.to,
      subject,
      { preheader: opening, title, blocks, footer },
      target.username,
    ),
    "an operator alert about the machine, not a letter from the journal",
  );
  if (!result) {
    console.error(`[alert] mail declined to send for ${unit}.`);
    process.exit(1);
  }
  console.log(`[alert] ${unit} ${succeeded ? "success" : "failure"} mailed to ${target.to} via ${result.transport}`);
} catch (error) {
  console.error(`[alert] could not send: ${(error as Error).message}`);
  process.exit(1);
}
