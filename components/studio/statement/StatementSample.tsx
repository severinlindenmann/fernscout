"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The four rows of the example statement — the invented bank from
 * `test/helper-statement.test.ts`, signed. `public/examples/statement-example.csv`
 * is these rows, and `test/statement-example.test.ts` holds the two together.
 */
export const STATEMENT_EXAMPLE_ROWS = [
  ["04.03.2026", "Kiosk am Hafen", "-12.40", "EUR"],
  ["04.03.2026", "Fährticket", "-6.00", "EUR"],
  ["05.03.2026", "Pension Seeblick", "-74.00", "EUR"],
  ["06.03.2026", "Bäckerei", "-4.20", "EUR"],
] as const;

export const STATEMENT_EXAMPLE_HREF = "/examples/statement-example.csv";

/**
 * "What the file looks like" — B2143. The two shapes a bank export comes in:
 * one signed amount column, or a debit and a credit column. The second reads
 * with the mapping's "outflows are positive" pointed at the debit column; a
 * credit row has no debit and is left out, which is right — it is not
 * spending (`applyMapping` drops a row whose amount does not parse).
 */
export default function StatementSample() {
  const { t } = useI18n();
  const [shape, setShape] = useState<"signed" | "split">("signed");
  const cell = "px-2 py-1.5 text-left";
  const head = ["studio.statement.sample.date", "studio.statement.sample.text"] as const;
  return (
    <section data-statement-sample className="mt-6 rounded-2xl border border-line-strong bg-surface-subtle p-4">
      <h2 className="font-display text-base font-semibold text-ink-strong">{t("studio.statement.sample.title")}</h2>
      <p className="mt-1 text-sm leading-6 text-ink-secondary">{t("studio.statement.sample.lede")}</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("studio.statement.sample.title")}>
        {(["signed", "split"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shape === s}
            onClick={() => setShape(s)}
            className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${
              shape === s ? "border-action-strong bg-surface-raised text-ink-strong" : "border-line-strong text-ink-secondary"
            }`}
          >
            {t(s === "signed" ? "studio.statement.sample.signed" : "studio.statement.sample.split")}
          </button>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm text-ink-strong">
          <thead className="font-mono text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              {head.map((k) => (
                <th key={k} className={cell}>{t(k)}</th>
              ))}
              {shape === "signed" ? (
                <th className={`${cell} text-right`}>{t("studio.statement.sample.amount")}</th>
              ) : (
                <>
                  <th className={`${cell} text-right`}>{t("studio.statement.sample.debit")}</th>
                  <th className={`${cell} text-right`}>{t("studio.statement.sample.credit")}</th>
                </>
              )}
              <th className={cell}>{t("studio.statement.sample.currency")}</th>
            </tr>
          </thead>
          <tbody>
            {STATEMENT_EXAMPLE_ROWS.map(([date, text, amount, currency]) => (
              <tr key={text} className="border-t border-line-quiet">
                <td className={`${cell} whitespace-nowrap tabular-nums`}>{date}</td>
                <td className={cell}>{text}</td>
                {shape === "signed" ? (
                  <td className={`${cell} text-right tabular-nums`}>{amount}</td>
                ) : (
                  <>
                    <td className={`${cell} text-right tabular-nums`}>{amount.replace("-", "")}</td>
                    <td className={`${cell} text-right`} />
                  </>
                )}
                <td className={cell}>{currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shape === "split" && <p className="mt-2 text-sm leading-6 text-ink-secondary">{t("studio.statement.sample.splitHint")}</p>}
      <a
        href={STATEMENT_EXAMPLE_HREF}
        download
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2"
      >
        {t("studio.statement.sample.download")}
      </a>
    </section>
  );
}
