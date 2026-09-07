import "server-only";
import { loadServerConfig } from "./config";
import { balanceOf } from "./credits";
import { getDatabaseOrNull } from "./db";
import { getUsernames } from "./users";
import { usageByOwnerSince, usageDailySince, usageSince, type UsageTotal } from "./usage";

/**
 * What the instance costs to run — B746.
 *
 * Deliberately not `lib/costs.ts`: that file is a *trip's* budget and
 * spending, which is content a journal owns. This is the operator's bill for
 * running the server, which no journal can see.
 *
 * The arithmetic layer over `lib/usage.ts`, `print_orders`, `day_notifications`
 * and `credit_ledger`. Nothing here writes anything, and nothing here is
 * reachable from a journal's own pages: `/admin` is the only caller, and
 * `lib/admin.ts` is what gates it.
 *
 * **Money is integer rappen throughout**, the rule `lib/credits/pricing.ts`
 * sets. Token prices are quoted per million and audio per thousand minutes, so
 * every multiplication here divides afterwards and rounds once, at the end —
 * rounding each row to the rappen before summing would lose most of a bill
 * made of thousands of fractional-rappen calls.
 *
 * **A line with no price is not an error.** An instance that has priced
 * nothing shows real usage against a cost of zero, which is honest; a default
 * price invented here would read as a measurement. Every unpriced line is
 * reported as such so the page can say so rather than showing a quiet zero.
 */

/** One priced line of the dashboard. */
export type CostLine = {
  label: string;
  /** What was consumed, already in words — "1.2M in / 84k out", "412 min". */
  detail: string;
  calls: number;
  rappen: number;
  /** True when this line consumed something the price list does not cover, so
   *  the page can say "not priced" rather than showing a confident zero. */
  unpriced: boolean;
};

/** Whole rappen, rounded once. Never `Math.floor` — a bill rounded down every
 *  time is a bill that is always wrong in the same direction. */
function rappenOf(value: number): number {
  return Math.round(value);
}

function thousands(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Price one provider's usage rows.
 *
 * Exported for the tests: this is the arithmetic the whole page rests on, and
 * it is checkable without a database.
 */
export function priceUsage(totals: UsageTotal[], costs = loadServerConfig().costs): CostLine[] {
  return totals.map((total) => {
    if (total.provider === "deepgram") {
      const perThousandMinutes = costs.transcriptionPerThousandMinutesRappen;
      const minutes = total.seconds / 60;
      return {
        label: `Deepgram · ${total.model} · ${total.operation}`,
        detail: `${minutes.toFixed(1)} min`,
        calls: total.calls,
        rappen: rappenOf((minutes * perThousandMinutes) / 1000),
        unpriced: perThousandMinutes === 0 && total.seconds > 0,
      };
    }
    const price = costs.models[total.model];
    const rappen = price
      ? rappenOf(
          (total.inputTokens * price.inputPerMillionRappen) / 1_000_000 +
            (total.outputTokens * price.outputPerMillionRappen) / 1_000_000,
        )
      : 0;
    return {
      label: `Anthropic · ${total.model} · ${total.operation}`,
      detail: `${thousands(total.inputTokens)} in / ${thousands(total.outputTokens)} out`,
      calls: total.calls,
      rappen,
      unpriced: !price && total.inputTokens + total.outputTokens > 0,
    };
  });
}

/**
 * What the printers actually charged — postcards and photobooks.
 *
 * The one group of lines that is **measured rather than priced**: a print
 * order carries `cost_minor` from the provider itself, so there is no price
 * list to apply and no assumption to get wrong. Orders that never reached a
 * provider (`draft`, `failed`) are counted and cost nothing, which is what
 * `cost_minor IS NULL` means.
 *
 * A caveat the page states rather than hides: `currency` is the provider's,
 * not necessarily the journal's. Mixed currencies are summed as-is here and
 * the currencies are listed, because converting them would need a rate this
 * module has no business fetching.
 */
async function printCosts(since: string): Promise<CostLine[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("print_orders")
    .select(({ fn }) => [
      "kind",
      "provider",
      "currency",
      fn.countAll<number>().as("orders"),
      fn.sum<number>("cost_minor").as("cost"),
    ])
    .where("created_at", ">=", since)
    .groupBy(["kind", "provider", "currency"])
    .execute();

  return rows.map((row) => ({
    label: `${row.kind === "photobook" ? "Photobooks" : "Postcards"} · ${row.provider}`,
    detail: row.currency ? `charged in ${row.currency}` : "nothing charged",
    calls: Number(row.orders ?? 0),
    rappen: Number(row.cost ?? 0),
    unpriced: false,
  }));
}

/**
 * What was sent to readers — WhatsApp, mail, and the notifications beside
 * them.
 *
 * **Counted, never priced, and that is the honest answer rather than a gap.**
 * A WhatsApp conversation's price depends on Meta's category and the
 * recipient's country, mail through Proton costs nothing per message, and a
 * push notification costs nothing at all. Inventing a per-message rate for any
 * of them would put a made-up number in a column of measured ones. What the
 * operator needs from this group is the volume, and the volume is exact.
 */
async function sendCounts(since: string): Promise<CostLine[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("day_notifications")
    .select(({ fn }) => ["channel", fn.countAll<number>().as("sent")])
    .where("sent_at", ">=", since)
    .groupBy("channel")
    .execute();

  return rows.map((row) => ({
    label: row.channel === "whatsapp" ? "WhatsApp · day announcements" : "Email · day announcements",
    detail: row.channel === "whatsapp" ? "priced by Meta per conversation" : "included in the mailbox",
    calls: Number(row.sent ?? 0),
    rappen: 0,
    unpriced: row.channel === "whatsapp",
  }));
}

/** The lines that are owed whether anybody writes a day or not. */
function fixedCosts(): CostLine[] {
  return loadServerConfig().costs.fixedMonthly.map((row) => ({
    label: row.label,
    detail: "every month",
    calls: 0,
    rappen: row.rappen,
    unpriced: false,
  }));
}

type JournalRow = {
  username: string;
  /** Null when credits are switched off instance-wide. */
  balance: number | null;
  granted: number;
  spent: number;
  /** What this journal's own model and audio calls cost over the period. */
  rappen: number;
};

/**
 * Every journal, with what it holds and what it has cost — the question that
 * follows the total.
 *
 * `granted` and `spent` are read from `credit_ledger` over **all time**, not
 * the period: "this journal has spent 40 of the 50 it was given" is the
 * sentence an operator wants, and a period-limited version of it answers a
 * question nobody asked. The money column is the period, because that is what
 * the total at the top is.
 */
async function journalRows(since: string): Promise<JournalRow[]> {
  const handle = await getDatabaseOrNull();
  const byOwner = await usageByOwnerSince(since);
  const costs = loadServerConfig().costs;

  const ledger = new Map<string, { granted: number; spent: number }>();
  if (handle) {
    const rows = await handle.db
      .selectFrom("credit_ledger")
      .select(({ fn }) => ["owner_id", fn.sum<number>("delta").as("total")])
      .groupBy(["owner_id"])
      .execute();
    // One pass, signed deltas split back apart: the ledger stores a signed
    // number precisely so a sign cannot be forgotten at a call site, so the
    // split happens here at read time rather than in a second column.
    const signed = await handle.db
      .selectFrom("credit_ledger")
      .select(({ fn }) => ["owner_id", fn.sum<number>("delta").as("total")])
      .where("delta", ">", 0)
      .groupBy(["owner_id"])
      .execute();
    for (const row of rows) {
      const positive = signed.find((s) => s.owner_id === row.owner_id);
      const granted = Number(positive?.total ?? 0);
      ledger.set(row.owner_id, { granted, spent: granted - Number(row.total ?? 0) });
    }
  }

  const names = getUsernames();
  return Promise.all(
    names.map(async (username) => {
      const totals = byOwner.find((entry) => entry.owner === username)?.totals ?? [];
      const rappen = priceUsage(totals, costs).reduce((sum, line) => sum + line.rappen, 0);
      const entry = ledger.get(username);
      return {
        username,
        balance: await balanceOf(username),
        granted: entry?.granted ?? 0,
        spent: entry?.spent ?? 0,
        rappen,
      };
    }),
  );
}

/**
 * Model and speech spend per day across the window — B763.
 *
 * Every day in the range, including the empty ones: a series that drops the
 * days nothing happened on turns a quiet fortnight into a straight line and
 * makes one busy afternoon look like a trend.
 *
 * Only the metered providers. Print lands in lumps on the day somebody ordered
 * a book and would swamp the shape; the fixed lines are monthly and have no
 * day at all.
 */
export async function dailyCosts(since: string, days: number): Promise<{ date: string; rappen: number }[]> {
  const rows = await usageDailySince(since);
  const costs = loadServerConfig().costs;

  const byDate = new Map<string, number>();
  for (const row of rows) {
    const priced = priceUsage(
      [{ ...row, operation: "", calls: 0 }],
      costs,
    )[0];
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + priced.rappen);
  }

  // Built from the window rather than from the rows, so the axis is the period
  // the page claims and not merely the days that happened to have traffic.
  const start = new Date(since);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { date, rappen: byDate.get(date) ?? 0 };
  });
}

export type Dashboard = {
  since: string;
  providers: CostLine[];
  print: CostLine[];
  sends: CostLine[];
  fixed: CostLine[];
  /** Everything above, in rappen. Unpriced lines contribute nothing and are
   *  flagged, so this is a floor rather than a guess. */
  totalRappen: number;
  journals: JournalRow[];
};

/** The whole page, in one call. */
export async function dashboard(since: string): Promise<Dashboard> {
  const [providers, print, sends, journals] = await Promise.all([
    usageSince(since).then((totals) => priceUsage(totals)),
    printCosts(since),
    sendCounts(since),
    journalRows(since),
  ]);
  const fixed = fixedCosts();
  const totalRappen = [...providers, ...print, ...sends, ...fixed].reduce(
    (sum, line) => sum + line.rappen,
    0,
  );
  return { since, providers, print, sends, fixed, totalRappen, journals };
}
