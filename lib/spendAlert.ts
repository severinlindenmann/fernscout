import "server-only";
import { adminEmail } from "./admin";
import { isEnabled } from "./capabilities";
import { loadServerConfig } from "./config";
import { formatChf } from "./creditsFormat";
import { dailyCosts } from "./instanceCosts";
import { sendMail } from "./mail";
import { renderMail } from "./mail/template";
import { translateIn } from "./locales";
import { OPERATION_LABEL } from "./operations";
import { serverSite } from "./site";

/** No per-operator locale exists to resolve (W44 D7 names owner/reader/
 * stranger chains only) — English, through a real key rather than a literal,
 * so the string lives beside every other mail's and a future operator-locale
 * setting has somewhere to plug in. */
const OPERATOR_LOCALE = "en";

/**
 * Yesterday's metered spend against the operator's own alert line.
 *
 * Run once a night by `scripts/spend-alert.mts` (from `scripts/backup.sh`, the
 * one thing on the box that already runs every night). It looks at one whole
 * UTC day, the one that just ended, so it can mail at most once per day and
 * never about a day still in progress.
 *
 * **Measured, never forecast.** The figure is `dailyCosts`' — the same one the
 * chart on `/admin` draws — and like every figure there it is a floor: usage
 * the price list does not cover is counted and not priced, so it cannot push a
 * day over the line.
 *
 * Every way of having nothing to do is a reason, not an error: costs off, no
 * line set, no operator address, or a day under the line. The script prints
 * it, the same contract `scripts/reminders.mts` keeps.
 */

export type SpendAlertResult =
  | { sent: false; reason: string; date?: string; rappen?: number }
  | { sent: true; dryRun: boolean; date: string; rappen: number; to: string };

export async function checkSpendAlert(input: { dryRun?: boolean; now?: Date } = {}): Promise<SpendAlertResult> {
  const now = input.now ?? new Date();
  if (!isEnabled("costs")) return { sent: false, reason: "costs are switched off on this instance" };

  const line = loadServerConfig().costs.alertDailyRappen;
  if (!line) return { sent: false, reason: "no alert line is set (costs.alertDailyRappen)" };

  const to = adminEmail();
  if (!to) return { sent: false, reason: "FERNSCOUT_ADMIN_EMAIL is not set, so there is nobody to tell" };

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - 86_400_000).toISOString();
  const [day] = await dailyCosts(since, 1);
  if (!day || day.rappen <= line) {
    return {
      sent: false,
      reason: `metered spend was under the line of ${formatChf(line)}`,
      date: day?.date,
      rappen: day?.rappen ?? 0,
    };
  }

  if (input.dryRun) return { sent: true, dryRun: true, date: day.date, rappen: day.rappen, to };

  const site = serverSite();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(OPERATOR_LOCALE, key, vars);
  const vars = { site: site.name, amount: formatChf(day.rappen), date: day.date, line: formatChf(line) };
  const result = await sendMail(
    renderMail(to, t("op.spendSubject", vars), {
      template: "op.spend",
      preheader: t("op.spendPreheader", vars),
      title: t("op.spendTitle", vars),
      blocks: [
        { kind: "paragraph", text: t("op.spendBody", vars) },
        {
          kind: "table",
          head: ["What", "Spent"],
          rows: day.parts.map((part) => ({
            cells: [OPERATION_LABEL[part.operation] ?? part.operation, formatChf(part.rappen)],
          })),
        },
        { kind: "button", text: t("op.spendButton"), href: `${site.url.replace(/\/$/, "")}/admin` },
      ],
      footer: t("op.spendFooter"),
    }),
  );
  if (!result) return { sent: false, reason: "mail is switched off on this instance", date: day.date, rappen: day.rappen };
  return { sent: true, dryRun: false, date: day.date, rappen: day.rappen, to };
}
