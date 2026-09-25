import { COSTS_IMPORTERS } from "@/importers/costs";
import { checkCostsImporter, type CostsImporter, type Payment } from "@/importers/costs/schema";

/**
 * Reading a bank statement, and what happens to what comes out — B677.
 *
 * The second kind of import (B671 built the first), and the shape is the same
 * on purpose: **the import reads and reports; a separate call writes.** A
 * statement covering a fortnight holds the trip and the fortnight either side
 * of it, plus the rent, plus the phone bill, and only a person knows which
 * lines were the trip. So nothing here touches a trip — `apply.ts` does that,
 * with rows a person has agreed to.
 *
 * There is no category anywhere in this file. See `importers/costs/schema.ts`:
 * whether a payment was "food" or "the one good dinner" is an editorial
 * decision about somebody's trip, and this software does not make those.
 */

export type CostsOutcome = {
  kind: "costs";
  format: string;
  detected: boolean;
  /** Rows in the file, before anything is filtered. */
  read: number;
  from: string | null;
  to: string | null;
  /** The money going out, which is what a trip costs. */
  spending: {
    payments: number;
    /** Per day, newest last — the shape a journal records costs in. */
    days: { date: string; total: number; currency: string; payments: PaymentView[] }[];
    /** Biggest first. This is the list to agree categories against, because
     * one decision about a merchant covers every payment to it. */
    merchants: { description: string; total: number; currency: string; payments: number }[];
  };
  /**
   * What a unit of each foreign currency actually cost, from the money the
   * bank moved rather than from any published table — the median across the
   * trip's own payments. This is what `trip.md`'s `rates:` wants, and it is
   * easy to write upside down.
   */
  rates: Record<string, number>;
  /** Left out of the spending above, and counted rather than hidden. */
  skipped: { transfers: number; incoming: number };
};

type PaymentView = {
  date: string;
  description: string;
  /** Positive: what was spent. The sign belongs to the statement, not to a
   * journal, and `costs:` on a day records what a thing cost. */
  amount: number;
  currency: string;
  /** What it came to in the account's own currency, when they differ. */
  charged?: { amount: number; currency: string };
};

export type CostsRefusal = {
  refusal: "unknown_format" | "unreadable" | "contract";
  message: string;
  problems?: string[];
};

function subject(filename: string): string {
  return filename === "inline" ? "the text you sent" : JSON.stringify(filename);
}

const HEAD_CHARS = 64 * 1024;

function chooseImporter(
  text: string,
  filename: string,
  format: string | undefined,
): { importer: CostsImporter; detected: boolean } | CostsRefusal {
  if (format !== undefined) {
    const named = COSTS_IMPORTERS.find((i) => i.id === format);
    if (!named)
      return {
        refusal: "unknown_format",
        message:
          `No statement importer called ${JSON.stringify(format)}. Known formats: ` +
          `${COSTS_IMPORTERS.map((i) => i.id).join(", ")}. Leave \`format\` out and the ` +
          "file is recognised from its own contents.",
      };
    return { importer: named, detected: false };
  }
  const found = COSTS_IMPORTERS.find((i) => i.detect(text.slice(0, HEAD_CHARS), filename));
  if (!found)
    return {
      refusal: "unknown_format",
      message:
        `Nothing recognised ${subject(filename)} as a statement. Known formats: ` +
        `${COSTS_IMPORTERS.map((i) => i.id).join(", ")}. A bank this instance cannot read ` +
        "is an importer somebody has to write — `importers/costs/` is MIT-licensed for " +
        "exactly that.",
    };
  return { importer: found, detected: true };
}

/** The median, which is the honest middle of a handful of payments — a mean is
 * dragged by the one big transfer at a bad rate. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function readStatement(
  text: string,
  filename: string,
  options: { format?: string; from?: string; to?: string } = {},
): CostsOutcome | CostsRefusal {
  const chosen = chooseImporter(text, filename, options.format);
  if ("refusal" in chosen) return chosen;

  let rows: Payment[];
  try {
    rows = chosen.importer.parse(text);
  } catch (error) {
    return {
      refusal: "unreadable",
      message:
        `${chosen.importer.id} could not read ${subject(filename)}: ` +
        `${(error as Error).message}. ` +
        (chosen.detected
          ? "It was chosen by looking at the file, so it may be the wrong one — name a format."
          : "It was the format you named; check that against the file."),
    };
  }

  const problems = checkCostsImporter(chosen.importer, rows);
  if (problems.length > 0)
    return {
      refusal: "contract",
      message: `${chosen.importer.id} read the file, and what came out does not hold up.`,
      problems,
    };

  // The window is the caller's, and it is usually the trip's dates. Applied
  // here rather than by the caller so that the totals and the rates below
  // describe the trip rather than the statement.
  const inRange = rows.filter(
    (r) => (!options.from || r.date >= options.from) && (!options.to || r.date <= options.to),
  );
  const spend = inRange.filter((r) => r.amount < 0 && !r.transfer);
  const transfers = inRange.filter((r) => r.transfer).length;
  const incoming = inRange.filter((r) => !r.transfer && r.amount >= 0).length;

  const view = (r: Payment): PaymentView => ({
    date: r.date,
    description: r.description,
    amount: Math.abs(r.amount),
    currency: r.currency,
    charged: r.charged ? { amount: Math.abs(r.charged.amount), currency: r.charged.currency } : undefined,
  });

  const byDay = new Map<string, PaymentView[]>();
  for (const row of spend) {
    const day = byDay.get(row.date);
    if (day) day.push(view(row));
    else byDay.set(row.date, [view(row)]);
  }

  const byMerchant = new Map<string, { total: number; currency: string; payments: number }>();
  for (const row of spend) {
    // Grouped by what it cost the account, so two payments to one merchant in
    // two currencies add up to something meaningful.
    const charged = row.charged ?? { amount: row.amount, currency: row.currency };
    const seen = byMerchant.get(row.description);
    if (seen) {
      seen.total += Math.abs(charged.amount);
      seen.payments += 1;
    } else
      byMerchant.set(row.description, {
        total: Math.abs(charged.amount),
        currency: charged.currency,
        payments: 1,
      });
  }

  const observed = new Map<string, number[]>();
  for (const row of spend) {
    if (!row.charged || row.charged.currency === row.currency) continue;
    const list = observed.get(row.currency);
    const rate = Math.abs(row.charged.amount) / Math.abs(row.amount);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (list) list.push(rate);
    else observed.set(row.currency, [rate]);
  }

  const dates = inRange.map((r) => r.date).sort();
  return {
    kind: "costs",
    format: chosen.importer.id,
    detected: chosen.detected,
    read: rows.length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    spending: {
      payments: spend.length,
      days: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, payments]) => ({
          date,
          total: Number(payments.reduce((n, p) => n + (p.charged?.amount ?? p.amount), 0).toFixed(2)),
          currency: payments[0].charged?.currency ?? payments[0].currency,
          payments,
        })),
      merchants: [...byMerchant.entries()]
        .map(([description, m]) => ({ description, total: Number(m.total.toFixed(2)), currency: m.currency, payments: m.payments }))
        .sort((a, b) => b.total - a.total),
    },
    rates: Object.fromEntries(
      [...observed.entries()].map(([currency, list]) => [currency, Number(median(list).toFixed(4))]),
    ),
    skipped: { transfers, incoming },
  };
}
