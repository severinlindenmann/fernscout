import "server-only";
import { loadServerConfig } from "./config";
import { balanceOf } from "./credits";
import { creditsFromUnits } from "./credits/format";
import { getDatabaseOrNull } from "./db";
import { crossRate } from "./currency";
import { paymentsAwaiting, paymentsPaidSince, takings, type Payment } from "./payments";
import { loadEcbRates } from "./rates";
import { getUsernames } from "./users";
import {
  usageByOwnerSince,
  usageDailyByOwnerSince,
  usageDailySince,
  usageSince,
  type UsageTotal,
} from "./usage";

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
 * `currency` is the provider's, not necessarily the journal's, so each
 * group is converted into rappen through the ECB table before it joins the
 * total — B1347; summing pence and cents as-is was how a GBP charge landed
 * in a CHF column at face value. A group whose currency the table cannot
 * answer for (or whose rows never named one) is flagged `unpriced` instead:
 * a figure the page cannot convert must not be a figure it adds up.
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

  const rates = loadEcbRates()?.rates ?? {};
  return rows.map((row) => {
    const minor = Number(row.cost ?? 0);
    const rate = row.currency ? crossRate(row.currency, "CHF", rates) : undefined;
    const converted = rate === undefined ? 0 : rappenOf(minor * rate);
    return {
      label: `${row.kind === "photobook" ? "Photobooks" : "Postcards"} · ${row.provider}`,
      detail:
        minor > 0 && row.currency
          ? `${row.currency} ${(minor / 100).toFixed(2)}${rate === undefined ? ", no rate to convert it" : " ≈"}`
          : "nothing charged",
      calls: Number(row.orders ?? 0),
      rappen: converted,
      unpriced: minor > 0 && rate === undefined,
    };
  });
}

/**
 * What was sent to readers — WhatsApp, SMS, mail, and the notifications
 * beside them.
 *
 * Mail and SMS are **counted, never priced**: mail through the mailbox costs
 * nothing per message, and the Twilio number's rent is a fixed line, so an
 * invented per-message rate would put a made-up number in a column of
 * measured ones. WhatsApp is counted per message and per Meta category from
 * `whatsapp_sends` (B1347 — `day_notifications` dedupes to one row per day
 * and never sees a reminder or a code), and priced from
 * `costs.whatsappPerMessageRappen` where the operator has priced a category.
 * Meta actually bills per conversation, so the figure is an approximation
 * the line says out loud; `service` replies are free by Meta's own
 * 24-hour-window rule and are counted at zero rather than "not priced".
 */
async function sendCounts(since: string): Promise<CostLine[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const mailRows = await handle.db
    .selectFrom("day_notifications")
    .select(({ fn }) => ["channel", fn.countAll<number>().as("sent")])
    .where("sent_at", ">=", since)
    .where("channel", "=", "mail")
    .groupBy("channel")
    .execute();

  const whatsappRows = await handle.db
    .selectFrom("whatsapp_sends")
    .select(({ fn }) => ["category", fn.countAll<number>().as("sent")])
    .where("sent_at", ">=", since)
    .groupBy("category")
    .execute();

  const smsRows = await handle.db
    .selectFrom("sms_messages")
    .select(({ fn }) => [fn.countAll<number>().as("sent")])
    .where("created_at", ">=", since)
    .where("direction", "=", "out")
    .execute();

  const prices = loadServerConfig().costs.whatsappPerMessageRappen;
  const lines: CostLine[] = mailRows.map((row) => ({
    label: "Email · day announcements",
    detail: "included in the mailbox",
    calls: Number(row.sent ?? 0),
    rappen: 0,
    unpriced: false,
  }));

  for (const row of whatsappRows) {
    const calls = Number(row.sent ?? 0);
    const free = row.category === "service";
    const price = prices[row.category];
    lines.push({
      label: `WhatsApp · ${row.category}`,
      detail: free ? "free inside Meta's service window" : "per message — Meta bills per conversation",
      calls,
      rappen: free ? 0 : rappenOf(calls * (price ?? 0)),
      unpriced: !free && price === undefined && calls > 0,
    });
  }

  const smsSent = Number(smsRows[0]?.sent ?? 0);
  if (smsSent > 0) {
    lines.push({
      label: "SMS · Twilio",
      detail: "counted — the number's rent is a fixed line",
      calls: smsSent,
      rappen: 0,
      unpriced: false,
    });
  }

  return lines;
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
      // The ledger stores hundredths since B987; this page is read by a
      // person, so it stops being one here.
      const granted = creditsFromUnits(Number(positive?.total ?? 0));
      const net = creditsFromUnits(Number(row.total ?? 0));
      ledger.set(row.owner_id, { granted, spent: granted - net });
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
export type DailySpend = {
  date: string;
  /** Everything spent that day. */
  rappen: number;
  /** The same money split by which feature spent it, biggest first — B996.
   *  Empty on a day nothing happened, which is most days. */
  parts: { operation: string; rappen: number }[];
};

export async function dailyCosts(since: string, days: number): Promise<DailySpend[]> {
  const rows = await usageDailySince(since);
  const costs = loadServerConfig().costs;

  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const priced = priceUsage([{ ...row, calls: 0 }], costs)[0];
    const parts = byDate.get(row.date) ?? new Map<string, number>();
    parts.set(row.operation, (parts.get(row.operation) ?? 0) + priced.rappen);
    byDate.set(row.date, parts);
  }

  // Built from the window rather than from the rows, so the axis is the period
  // the page claims and not merely the days that happened to have traffic.
  const start = new Date(since);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const parts = [...(byDate.get(date) ?? new Map<string, number>())]
      .map(([operation, rappen]) => ({ operation, rappen }))
      .filter((part) => part.rappen > 0)
      .sort((a, b) => b.rappen - a.rappen);
    return { date, rappen: parts.reduce((sum, part) => sum + part.rappen, 0), parts };
  });
}

/**
 * Each journal's metered spend, day by day, for the sparkline on its row — B996.
 *
 * Keyed by username, every array the same length as the window and in the same
 * order, so a row can draw one without knowing which days it holds. A journal
 * that spent nothing is absent rather than carrying an array of zeros; the
 * caller draws nothing for it, which is the honest picture.
 */
export async function journalDaily(
  since: string,
  days: number,
): Promise<Record<string, number[]>> {
  const rows = await usageDailyByOwnerSince(since);
  const costs = loadServerConfig().costs;
  const start = new Date(since);
  const index = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    index.set(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10), i);
  }

  const series: Record<string, number[]> = {};
  for (const row of rows) {
    const at = index.get(row.date);
    if (at === undefined) continue;
    const priced = priceUsage([{ ...row, operation: "", calls: 0 }], costs)[0];
    if (priced.rappen === 0) continue;
    const line = (series[row.owner] ??= Array.from({ length: days }, () => 0));
    line[at] += priced.rappen;
  }
  return series;
}

/**
 * What the model money was spent on, whole-instance — B996 (X1).
 *
 * Pure, and over the totals `dashboard` already fetched, so it costs no query.
 * Operations rather than models: "the helper cost more than writing days" is a
 * sentence about the product, and which model served it is a fact about a
 * price list.
 */
export function byOperation(
  totals: UsageTotal[],
  costs = loadServerConfig().costs,
): { operation: string; rappen: number; calls: number }[] {
  const found = new Map<string, { rappen: number; calls: number }>();
  const priced = priceUsage(totals, costs);
  totals.forEach((total, at) => {
    const row = found.get(total.operation) ?? { rappen: 0, calls: 0 };
    row.rappen += priced[at].rappen;
    row.calls += total.calls;
    found.set(total.operation, row);
  });
  return [...found]
    .map(([operation, row]) => ({ operation, ...row }))
    .sort((a, b) => b.rappen - a.rappen || b.calls - a.calls);
}

export type Dashboard = {
  since: string;
  /** Purchases still waiting for the operator to approve — B774. The queue
   *  this page exists to surface; empty is the normal state. */
  awaiting: Payment[];
  /** Purchases settled in the window, newest first. */
  paid: Payment[];
  /** What those came to, in rappen, with admin grants excluded. */
  takenRappen: number;
  providers: CostLine[];
  /** The same model and speech money, grouped by what it was spent on — B996. */
  operations: { operation: string; rappen: number; calls: number }[];
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
  const [totals, print, sends, journals, awaiting, paid] = await Promise.all([
    usageSince(since),
    printCosts(since),
    sendCounts(since),
    journalRows(since),
    paymentsAwaiting(),
    paymentsPaidSince(since),
  ]);
  const providers = priceUsage(totals);
  const fixed = fixedCosts();
  const totalRappen = [...providers, ...print, ...sends, ...fixed].reduce(
    (sum, line) => sum + line.rappen,
    0,
  );
  return {
    since,
    awaiting,
    paid,
    takenRappen: takings(paid),
    providers,
    operations: byOperation(totals),
    print,
    sends,
    fixed,
    totalRappen,
    journals,
  };
}
