import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BRANDING_BENCHES } from "@/lib/docs";

/**
 * `/docs/branding` — the workbenches.
 *
 * Everything this software draws rather than writes ends up here, because a
 * drawing is the one kind of output that cannot be checked by reading it or by
 * a test: the code for an aeroplane whose wings rake the wrong way is exactly
 * as correct as the code for one whose wings do not. Somebody has to look.
 *
 * So each bench does the same two things — **isolate one piece** and **hold it
 * still** — and each says which file it is showing you. That is the whole
 * value: "the travel scene looks wrong" is a day of bisecting, and "the plane
 * in `Vehicle.tsx` looks wrong" is ten minutes.
 *
 * Not indexed. Linked from the foot of `/docs` rather than among its cards,
 * beside `/agent.md` and `/openapi.json` — the slot that page already keeps
 * for things which are not prose for a reader.
 */
export const metadata: Metadata = {
  title: { absolute: "Workbenches · Fernscout" },
  description: "The parts of this software that are drawn rather than written, each on its own.",
  robots: { index: false, follow: false },
};

export default function BrandingHubPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">Workbenches</h1>
      <p className="mt-3 text-lg leading-relaxed text-ink-body">
        The parts of this software that are drawn rather than written. A drawing is the
        one kind of output no test can check — code for an aeroplane whose wings rake
        the wrong way is exactly as correct as code for one whose wings do not — so each
        of these takes one piece out, holds it still, and says which file it came from.
      </p>
      <p className="mt-3 text-ink-secondary">
        Reporting something from a bench is most useful when it names the bench: “the
        travel scene looks wrong” is an afternoon of bisecting, and “the plane in{" "}
        <code className="rounded bg-surface-subtle px-1 text-sm">Vehicle.tsx</code> looks
        wrong” is ten minutes.
      </p>

      <ul className="mt-8 grid gap-3">
        {BRANDING_BENCHES.map((bench) => (
          <li key={bench.href}>
            <Link
              href={bench.href}
              className="group flex h-full items-start gap-3 rounded-xl border border-line-quiet bg-surface-raised px-4 py-4
                         transition-colors hover:border-line-ink
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-semibold text-ink-strong">
                  {bench.title}
                </span>
                <span className="mt-1 block text-sm text-ink-body">{bench.blurb}</span>
                <span className="mt-2 block font-mono text-xs text-ink-muted">{bench.source}</span>
              </span>
              <ArrowRight
                className="mt-1 h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>

      {/*
        What is deliberately not here, said plainly rather than as an empty card
        promising a page nobody has built.
      */}
      <section className="mt-12 border-t border-line-quiet pt-6">
        <h2 className="font-display text-lg font-semibold text-ink-strong">
          What is not benched, and why
        </h2>
        <p className="mt-2 text-sm text-ink-body">
          A <strong>photobook</strong> and a <strong>postcard</strong> already have web
          previews built from the same millimetres the printer gets — they live inside a
          journal at <code className="rounded bg-surface-subtle px-1">/&lt;user&gt;/photobook</code>{" "}
          and <code className="rounded bg-surface-subtle px-1">/&lt;user&gt;/postcards/&lt;id&gt;</code>,
          because both need real photographs, a real trip and an owner. Only their{" "}
          <em>geometry</em> is here, which is the half that has no content in it.
          Locally, <code className="rounded bg-surface-subtle px-1">npm run photobook</code> and{" "}
          <code className="rounded bg-surface-subtle px-1">npm run postcard</code> drive the
          whole pipeline against the dry-run providers and write the files out.
        </p>
      </section>

      <p className="mt-10 border-t border-line-quiet pt-6">
        <Link
          href="/docs"
          className="text-sm font-semibold text-ink-body underline decoration-blue-500 decoration-2 underline-offset-2 hover:text-ink-strong"
        >
          Back to the documentation
        </Link>
      </p>
    </main>
  );
}
