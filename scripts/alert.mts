/**
 * Mail an operator that a systemd unit failed.
 *
 *   scripts/alert.sh fernscout-backup.service      # the normal caller
 *   npm run alert -- --unit fernscout-backup.service < detail.txt
 *   npm run alert -- --unit fernscout-backup.service --dry-run
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
import { sendMail } from "../lib/mail";
import { loadServerConfig } from "../lib/config";
import { getDefaultUsername, getUser } from "../lib/users";

const argv = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const unit = valueOf("--unit") ?? "an unnamed unit";
const dryRun = argv.includes("--dry-run");

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function recipient(): { to: string; username?: string } | null {
  const configured = process.env.BACKUP_ALERT_EMAIL?.trim();
  const username = getDefaultUsername() ?? undefined;
  if (configured) return { to: configured, username };
  const owner = username ? getUser(username)?.owner : undefined;
  return owner?.email ? { to: owner.email, username } : null;
}

const detail = (await readStdin()).trimEnd();
const site = (() => {
  try {
    return loadServerConfig().site;
  } catch {
    return { name: "Fernscout", url: "" };
  }
})();

const subject = `[${site.name}] ${unit} failed`;
// Blank lines are content here, so nothing is filtered out of the array — only
// the health URL, which is absent when the config could not be read at all.
const lines = [
  `${unit} failed on ${process.env.HOSTNAME ?? "this host"} at ${new Date().toISOString()}.`,
  "",
  detail || "(no detail was supplied)",
  "",
  "What to look at:",
  `  systemctl status ${unit}       how the last run ended`,
  `  journalctl -u ${unit} -n 50    why`,
];
if (site.url) lines.push(`  ${site.url}/api/health    the .backup block, from anywhere`);
lines.push("", "Sent by scripts/alert.sh, from the unit's OnFailure=.");
const text = lines.join("\n");

const html = `<pre style="font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`;

if (dryRun) {
  const target = recipient();
  console.log(`[alert] --dry-run; would send to ${target?.to ?? "(nobody — no BACKUP_ALERT_EMAIL and no owner email)"}`);
  console.log(text);
  process.exit(target ? 0 : 1);
}

if (!isEnabled("mail")) {
  // Mail is off by default on every instance (AGENTS.md), so this is the
  // ordinary case, not a fault. Say what still knows, so the operator reading
  // the journal does not go looking for a mail that was never going to exist.
  console.error(
    `[alert] mail is switched off on this instance — no alert was sent for ${unit}. ` +
      "The failure is recorded in DATA_DIR and reported by /api/health.",
  );
  process.exit(3);
}

const target = recipient();
if (!target) {
  console.error(
    "[alert] nobody to tell: set BACKUP_ALERT_EMAIL, or give the default journal an owner.email in content/<user>/config.json.",
  );
  process.exit(1);
}

try {
  const result = await sendMail({ to: target.to, subject, text, html, username: target.username });
  if (!result) {
    console.error(`[alert] mail declined to send for ${unit}.`);
    process.exit(1);
  }
  console.log(`[alert] ${unit} failure mailed to ${target.to} via ${result.transport}`);
} catch (error) {
  console.error(`[alert] could not send: ${(error as Error).message}`);
  process.exit(1);
}
