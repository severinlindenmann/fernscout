import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminGrant from "./AdminGrant";
import { isInstanceAdmin } from "@/lib/adminGate";
import { creditsEnabled, ledgerFor } from "@/lib/credits";
import { formatChf } from "@/lib/credits/pricing";
import { dashboard, type CostLine } from "@/lib/instanceCosts";

// Reads a session and the database on every request; nothing to prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operator",
  robots: { index: false, follow: false },
};

/** How far back the page looks. Thirty days rather than a calendar month
 *  because a bill is read on whatever day somebody wonders, and "the last
 *  thirty days" needs no explanation of what happens on the 31st. */
const WINDOW_DAYS = 30;

function since(): string {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function Lines({ title, lines, note }: { title: string; lines: CostLine[]; note?: string }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">{title}</h2>
      {note ? <p className="mt-1 text-sm text-navy-700">{note}</p> : null}
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-navy-500">Nothing in this period.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-navy-500">
                <th className="py-1 font-medium">What</th>
                <th className="py-1 font-medium">Consumed</th>
                <th className="py-1 text-right font-medium">Calls</th>
                <th className="py-1 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="text-navy-700">
              {lines.map((line) => (
                <tr key={`${line.label}-${line.detail}`} className="border-t border-navy-200">
                  <td className="py-1.5 pr-3">{line.label}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{line.detail}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{line.calls}</td>
                  <td className="py-1.5 text-right font-mono">
                    {/* An unpriced line shows what it cost us to *say* nothing,
                        rather than a zero that reads as "this was free". */}
                    {line.unpriced ? (
                      <span className="text-navy-500">not priced</span>
                    ) : (
                      formatChf(line.rappen)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * What this instance costs to run — B746.
 *
 * **404 for everybody who is not the operator, including when there is no
 * operator.** `FERNSCOUT_ADMIN_EMAIL` unset means `isInstanceAdmin` is false
 * for every address, so an instance that has not set it behaves exactly as
 * though this page were not in the build — the same promise `lib/admin.ts`
 * makes. `notFound()` rather than a 403: a page that says "forbidden" has
 * told a stranger the operator dashboard is at this address.
 *
 * Every number here is measured. Where a price is missing the line says so
 * rather than showing a zero, and the two groups that cannot honestly be
 * priced at all — WhatsApp, which Meta bills per conversation and per country,
 * and mail, which costs nothing per message — are shown as volumes with the
 * reason beside them. A total that quietly included a guess would be worse
 * than a total that is explicitly a floor.
 */
export default async function AdminPage() {
  if (!(await isInstanceAdmin())) notFound();

  const from = since();
  const data = await dashboard(from);
  const metered = creditsEnabled();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">Operator</h1>
      <p className="mt-3 text-navy-700">
        What this instance has cost over the last {WINDOW_DAYS} days, and what each journal holds.
      </p>

      <p className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-4 text-navy-900">
        <span className="font-display text-2xl font-semibold">{formatChf(data.totalRappen)}</span>
        <span className="mt-1 block text-sm text-navy-700">
          Everything priced below, including the fixed monthly lines. Lines marked{" "}
          <em>not priced</em> are real usage this instance has no price for, so treat this as a
          floor rather than an invoice.
        </span>
      </p>

      <Lines
        title="Models and speech"
        lines={data.providers}
        note="Tokens and audio seconds as the providers measured them, priced from costs in site/config.json."
      />
      <Lines
        title="Print"
        lines={data.print}
        note="What the printer actually charged, taken from the order itself rather than from a price list."
      />
      <Lines
        title="Sent to readers"
        lines={data.sends}
        note="Counted, not priced. WhatsApp is billed by Meta per conversation and per country; email through the mailbox costs nothing per message, and push notifications cost nothing at all."
      />
      <Lines title="Fixed" lines={data.fixed} note="Owed whether anybody writes a day or not." />

      <section className="mt-10 border-t border-navy-200 pt-6">
        <h2 className="font-display text-lg font-semibold text-navy-900">Journals</h2>
        {!metered ? (
          <p className="mt-1 text-sm text-navy-500">
            Credits are switched off on this instance, so there are no balances to show.
          </p>
        ) : null}
        <div className="mt-3 space-y-2">
          {data.journals.map((journal) => (
            <details key={journal.username} className="rounded-2xl border border-navy-200 bg-white">
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                <span className="font-display font-semibold text-navy-900">{journal.username}</span>
                <span className="font-mono text-sm text-navy-700">
                  {journal.balance === null ? "—" : `${journal.balance} credits`}
                </span>
                <span className="font-mono text-xs text-navy-500">
                  {journal.spent} spent of {journal.granted} granted
                </span>
                <span className="ml-auto font-mono text-sm text-navy-700">
                  {formatChf(journal.rappen)}
                </span>
              </summary>
              {/* The ledger, read only when the row is opened — a journal with
                  a long history should not cost anything to *not* look at. */}
              <Ledger username={journal.username} />
            </details>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-navy-200 pt-6">
        <h2 className="font-display text-lg font-semibold text-navy-900">Add credits</h2>
        <p className="mt-1 text-sm text-navy-700">
          This files a request and mails the operator a single-use link. Nothing is added to a
          balance until that link is opened — no request, including this one, can raise a balance
          by itself.
        </p>
        <AdminGrant journals={data.journals.map((journal) => journal.username)} />
      </section>
    </main>
  );
}

/** One journal's transactions, newest first. */
async function Ledger({ username }: { username: string }) {
  const rows = await ledgerFor(username, 50);
  if (rows.length === 0) {
    return <p className="px-4 pb-4 text-sm text-navy-500">No transactions.</p>;
  }
  return (
    <div className="overflow-x-auto px-4 pb-4">
      <table className="w-full min-w-[30rem] text-sm">
        <tbody className="text-navy-700">
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-navy-200">
              <td className="py-1.5 pr-3 font-mono text-xs text-navy-500">
                {row.createdAt.slice(0, 16).replace("T", " ")}
              </td>
              <td className="py-1.5 pr-3">{row.reason}</td>
              <td className="py-1.5 pr-3 font-mono text-xs text-navy-500">{row.ref ?? row.note ?? ""}</td>
              <td className="py-1.5 text-right font-mono">
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
