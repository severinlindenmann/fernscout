import "server-only";
import { loadServerConfig } from "@/lib/config";
import type { Attend } from "@/lib/adminConsole";
import {
  fetchStannpBalance,
  listOperatorOrders,
  providersModule,
  stannpKeySet,
  type OperatorOrder,
} from "@paid/printOrder/lib/providers";

/**
 * The operator's Providers section — B1646.
 *
 * **A number appears only where a provider's own API returns one.** Stannp,
 * Twilio and Deepgram have a balance endpoint, and the figure is shown in the
 * currency that endpoint answers in, never converted. Anthropic, Gelato and
 * Meta have none (Gelato charges the card per order, Anthropic's API reports
 * spend rather than credit, Meta's bills live in Business Manager), so each is
 * a row with a link and no figure.
 *
 * **Credentials never leave this module.** The keys are read from the
 * environment here, and what is returned holds a figure, a state and a link —
 * `app/api/admin/providers` and `app/admin` are the only callers, both behind
 * `isInstanceAdmin`.
 *
 * Every client has a dry-run path: with no key, and the capability that would
 * use it in its own dry-run backend, the row says *Simulated* and shows a
 * fixed sample so the section can be developed with no paid account.
 */

type BalanceProvider = "stannp" | "twilio" | "deepgram";
type ProviderId = BalanceProvider | "anthropic" | "gelato" | "meta";

export type ProviderRow = {
  id: ProviderId;
  label: string;
  role: string;
  /** `link`: this provider has no readable balance — the link is where to look. */
  state: "ok" | "simulated" | "not_set_up" | "failed" | "link";
  note: string;
  amount: { value: number; currency: string | null } | null;
  /** When `amount` was read. On `failed` this is the last good read, not this one. */
  readAt: string | null;
  /** The configured threshold, when there is one. */
  lowBelow: number | null;
  /** Judged only when a figure and a threshold both exist. */
  low: boolean | null;
  error: string | null;
  link: { href: string; label: string } | null;
};

export type ProvidersReport = { rows: ProviderRow[]; orders: OperatorOrder[] | null; readAt: string };

/** Four hours: a balance moves slowly and every read is a provider call. */
export const CACHE_MS = 4 * 3_600_000;

const SIMULATED: Record<BalanceProvider, { value: number; currency: string }> = {
  stannp: { value: 12.5, currency: "GBP" },
  twilio: { value: 8.25, currency: "USD" },
  deepgram: { value: 50, currency: "USD" },
};

async function readJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function twilioBalance() {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const body = (await readJson(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Balance.json`,
    { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
  )) as { balance?: string; currency?: string };
  const value = Number(body.balance);
  if (!body.balance || !Number.isFinite(value)) throw new Error("no balance in the answer");
  return { value, currency: body.currency ? body.currency.toUpperCase() : null };
}

/** Same host rule as lib/helper/transcribe.ts: EU unless DEEPGRAM_API_URL says otherwise. */
function deepgramOrigin(): string {
  try {
    const url = new URL(process.env.DEEPGRAM_API_URL?.trim() ?? "");
    if (url.protocol === "https:") return url.origin;
  } catch {
    // unset or malformed: the EU default
  }
  return "https://api.eu.deepgram.com";
}

async function deepgramBalance() {
  const headers = { Authorization: `Token ${process.env.DEEPGRAM_API_KEY ?? ""}` };
  const origin = deepgramOrigin();
  const projects = (await readJson(`${origin}/v1/projects`, headers)) as { projects?: { project_id?: string }[] };
  const id = projects.projects?.[0]?.project_id;
  if (!id) throw new Error("no project on this key");
  const body = (await readJson(`${origin}/v1/projects/${encodeURIComponent(id)}/balances`, headers)) as {
    balances?: { amount?: number; units?: string }[];
  };
  const list = body.balances ?? [];
  if (list.length === 0) throw new Error("no balance in the answer");
  // One unit at a time: dollars and hours are never added together.
  const units = list[0].units ?? "";
  const total = list.filter((one) => (one.units ?? "") === units).reduce((sum, one) => sum + Number(one.amount ?? 0), 0);
  if (!Number.isFinite(total)) throw new Error("no balance in the answer");
  return { value: total, currency: units ? units.toUpperCase() : null };
}

const LINKS = {
  stannp: { href: "https://dash.stannp.com/", label: "dash.stannp.com" },
  twilio: { href: "https://console.twilio.com/", label: "console.twilio.com" },
  deepgram: { href: "https://console.deepgram.com/", label: "console.deepgram.com" },
  anthropic: { href: "https://console.anthropic.com/settings/billing", label: "console.anthropic.com → Billing" },
  gelato: { href: "https://dashboard.gelato.com/", label: "dashboard.gelato.com → Billing" },
  meta: { href: "https://business.facebook.com/billing_hub", label: "Open Meta billing" },
} as const;

type Reader = {
  id: BalanceProvider;
  label: string;
  role: string;
  /** Whether the key this client needs is present. */
  keySet: () => boolean;
  /** Whether the capability that would use it is on, in its dry-run backend. */
  dry: () => boolean;
  read: () => Promise<{ value: number; currency: string | null }>;
  /** Absent from the section altogether (the paid module is not here). */
  present: () => boolean;
};

function dryBackend(feature: string): boolean {
  const entry = loadServerConfig().features[feature as "sms"] as { enabled: boolean; backend?: string };
  return entry.enabled && entry.backend === "dry-run";
}

const READERS: Reader[] = [
  {
    id: "stannp",
    label: "Stannp",
    role: "postcards",
    keySet: stannpKeySet,
    dry: () => (loadServerConfig().features.postcards as { enabled: boolean }).enabled,
    read: fetchStannpBalance,
    present: providersModule,
  },
  {
    id: "twilio",
    label: "Twilio",
    role: "SMS, phone codes",
    keySet: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    dry: () => dryBackend("sms"),
    read: twilioBalance,
    present: () => true,
  },
  {
    id: "deepgram",
    label: "Deepgram",
    role: "speech",
    keySet: () => Boolean(process.env.DEEPGRAM_API_KEY),
    dry: () => dryBackend("transcription"),
    read: deepgramBalance,
    present: () => true,
  },
];

const LINK_ROWS: { id: "anthropic" | "gelato" | "meta"; label: string; role: string; note: string; state: "link" }[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    role: "assistant",
    note: "No balance in their API. What this instance spent is under Money.",
    state: "link",
  },
  {
    id: "gelato",
    label: "Gelato",
    role: "photobooks",
    note: "Charged per order to the card on file; no balance in their API.",
    state: "link",
  },
  {
    id: "meta",
    label: "Meta",
    role: "WhatsApp",
    note: "Bills live in Business Manager; no figure is read from here.",
    state: "link",
  },
];

/** The last figure each provider really answered with, kept for a failed read. */
const lastGood = new Map<ProviderId, { amount: { value: number; currency: string | null }; at: string }>();
let cache: { at: number; report: ProvidersReport } | null = null;

/** Forget everything read so far. For tests. */
export function resetProvidersCache(): void {
  cache = null;
  lastGood.clear();
}

function judged(id: BalanceProvider, amount: ProviderRow["amount"]): Pick<ProviderRow, "lowBelow" | "low"> {
  const lowBelow = loadServerConfig().providers[id]?.lowBelow ?? null;
  return { lowBelow, low: amount && lowBelow !== null ? amount.value < lowBelow : null };
}

async function readRow(reader: Reader, now: Date): Promise<ProviderRow> {
  const base = { id: reader.id, label: reader.label, role: reader.role, link: LINKS[reader.id], error: null };
  const row = (state: ProviderRow["state"], amount: ProviderRow["amount"], readAt: string | null, note: string, error: string | null = null): ProviderRow => ({
    ...base, state, amount, readAt, note, error, ...judged(reader.id, amount),
  });

  if (!reader.keySet()) {
    if (reader.dry()) {
      return row("simulated", SIMULATED[reader.id], now.toISOString(), "Dry-run, no key: the figure is a fixed sample.");
    }
    return row("not_set_up", null, null, "No key on this instance.");
  }
  try {
    const amount = await reader.read();
    lastGood.set(reader.id, { amount, at: now.toISOString() });
    return row("ok", amount, now.toISOString(), "");
  } catch (error) {
    const good = lastGood.get(reader.id);
    return row(
      "failed",
      good?.amount ?? null,
      good?.at ?? null,
      good ? "The last good figure and when it was read." : "No figure has been read yet.",
      error instanceof Error ? error.message : "read failed",
    );
  }
}

/**
 * Every provider row and every order, read at most once per four hours.
 * `refresh` bypasses the cache — the Refresh button, nothing else.
 * ponytail: per-process cache; a second server process reads on its own clock.
 */
export async function readProviders(options: { refresh?: boolean; now?: Date } = {}): Promise<ProvidersReport> {
  const now = options.now ?? new Date();
  if (!options.refresh && cache && now.getTime() - cache.at < CACHE_MS) return cache.report;

  const present = READERS.filter((one) => one.present());
  const balances = await Promise.all(present.map((one) => readRow(one, now)));
  const linkRows: ProviderRow[] = LINK_ROWS.map((one) => ({
    ...one, amount: null, readAt: null, lowBelow: null, low: null, error: null, link: LINKS[one.id],
  }));
  const report: ProvidersReport = {
    rows: [...balances, ...linkRows],
    orders: providersModule() ? await listOperatorOrders() : null,
    readAt: now.toISOString(),
  };
  cache = { at: now.getTime(), report };
  return report;
}

/** Overview's "Needs you" entries for what the section found. Pure. */
export function providerAttention(report: ProvidersReport, alreadyRaised: Set<string> = new Set()): Attend[] {
  const found: Attend[] = [];
  for (const row of report.rows) {
    const fig = row.amount ? `${row.amount.currency ?? ""} ${row.amount.value.toFixed(2)}`.trim() : "";
    if (row.state === "failed") {
      found.push({
        id: `provider:${row.id}:read`,
        kind: "provider",
        title: `${row.label} could not be read`,
        detail: `${row.error ?? "The call failed"}${row.amount && row.readAt ? `. Last good figure ${fig}, read ${row.readAt.slice(0, 16).replace("T", " ")} UTC` : ""}.`,
        age: "now",
        level: 0,
      });
    } else if (row.state === "ok" && row.low) {
      found.push({
        id: `provider:${row.id}:low`,
        kind: "provider",
        title: `${row.label} balance is ${fig}, below ${row.lowBelow!.toFixed(2)}`,
        detail: `The ${row.role} will stop working once it runs out.`,
        age: "now",
        // Worse as it falls: an acknowledgement lapses when the gap widens.
        level: Math.round((row.lowBelow! - row.amount!.value) * 100),
      });
    }
  }
  for (const order of report.orders ?? []) {
    // Orders the faults list already raised (a recent refusal) are not raised twice.
    if (!order.attention || alreadyRaised.has(order.id)) continue;
    found.push({
      id: `order:${order.id}`,
      kind: "order",
      title: `${order.owner}'s ${order.kind} was ${order.status.toLowerCase()}`,
      detail: order.attention,
      age: order.createdAt.slice(0, 10),
      level: 0,
    });
  }
  return found;
}
