import type { Metadata } from "next";
import Link from "next/link";
import EntryContent from "@/components/EntryContent";
import { contrast, GROUNDS, lockup, lockups, palette, verdict } from "@/lib/brand";
import { readRepoFile, section } from "@/lib/docs";

/**
 * `/docs/branding/identity` — the mark and the palette, derived.
 *
 * The other four benches take something the *product* draws and hold it still.
 * This one does the same to the identity, and for the same reason: a contrast
 * ratio written into a document is a claim, and a contrast ratio computed from
 * the stylesheet the site actually ships is a measurement.
 *
 * So nothing on this page is typed out. The swatches are parsed from
 * `app/globals.css`, the ratios are computed from those hexes, the lockups are
 * the files in `docs/branding/` rendered as they are, and the prose is
 * `BRAND.md`'s own sections read at request time — the trick
 * `/docs/contributing` already plays on `CONTRIBUTING.md`. Changing a hex is
 * one edit, in one file, and this page follows.
 *
 * B575, and what it deleted: a hex column and a contrast table in `BRAND.md`,
 * a second ratio table in a `globals.css` comment, and a third in the
 * `apply-the-brand` skill.
 */
export const metadata: Metadata = {
  title: "Identity",
  description: "The mark and the palette, read off the files that define them.",
  robots: { index: false, follow: false },
};

/** A lockup, straight from `docs/branding/`, sized to its box rather than to
 * the `width` attribute the file happens to carry. */
function Lockup({ file, ground }: { file: string; ground: string }) {
  return (
    <div
      className={`flex h-32 items-center justify-center rounded-xl p-6 ${ground} [&>svg]:h-full [&>svg]:w-auto [&>svg]:max-w-full`}
      dangerouslySetInnerHTML={{ __html: lockup(file) }}
    />
  );
}

export default function IdentityBenchPage() {
  const brand = readRepoFile("docs/branding/BRAND.md");
  const swatches = palette();
  const files = lockups(brand);
  const hex = Object.fromEntries(swatches.map((s) => [s.token, s.hex]));

  return (
    <main id="main" className="min-h-screen bg-cream-50">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">Identity</h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-navy-700">
          The mark and the palette, read off the files that define them — the lockups
          from <code className="rounded bg-cream-100 px-1 text-base">docs/branding/</code>,
          the colours from{" "}
          <code className="rounded bg-cream-100 px-1 text-base">app/globals.css</code>, the
          contrast computed rather than claimed. Nothing here is a second copy, so
          changing a hex changes this page and nothing else needs editing.
        </p>

        {/* ── The lockups ─────────────────────────────────────────────── */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-navy-900">The lockups</h2>
        <p className="mt-2 max-w-2xl text-navy-700">
          Never redraw these. Reference the file, or copy its paths verbatim — the
          geometry is tested, and a re-typed lozenge is always slightly wrong.
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {files.map(({ file, slot }) => (
            <li key={file} className="rounded-xl border border-navy-200 bg-white p-3">
              <Lockup
                file={file}
                ground={file.includes("inverse") ? "bg-navy-900" : "bg-cream-50 text-navy-900"}
              />
              <p className="mt-3 font-mono text-xs text-navy-600">{file}</p>
              <p className="text-sm text-navy-700">{slot}</p>
            </li>
          ))}
        </ul>

        {/*
          The check that has to be made by eye and cannot be made by scaling an
          SVG up in a viewer: a browser tab is 16 real pixels, and interior
          detail dies there. `favicon-check.mjs` rasterises properly; this is
          the glance that tells you whether to bother running it.
        */}
        <h3 className="mt-10 font-display text-lg font-semibold text-navy-900">
          At the sizes a browser tab uses
        </h3>
        <p className="mt-2 max-w-2xl text-sm text-navy-700">
          Rendered from the same file, at 16, 24 and 32 CSS pixels. A mark that reads at
          64 can dissolve into noise here. For a true raster —{" "}
          <code className="rounded bg-cream-100 px-1">
            node .claude/skills/apply-the-brand/favicon-check.mjs
          </code>
          .
        </p>
        <div className="mt-4 flex items-end gap-6 rounded-xl border border-navy-200 bg-white p-6">
          {[16, 24, 32].map((size) => (
            <figure key={size} className="text-center">
              <div
                style={{ width: size, height: size }}
                className="[&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: lockup("icon-waymark.svg") }}
              />
              <figcaption className="mt-2 font-mono text-xs text-navy-600">{size}</figcaption>
            </figure>
          ))}
        </div>

        {/* ── The palette ─────────────────────────────────────────────── */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-navy-900">The palette</h2>
        <div className="mt-4 max-w-2xl">
          <EntryContent markdown={section(brand, "4. Colour")} />
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {swatches.map(({ token, hex: value }) => (
            <li key={token} className="overflow-hidden rounded-xl border border-navy-200 bg-white">
              <div className="h-16" style={{ background: value }} />
              <div className="px-3 py-2">
                <p className="font-mono text-xs font-semibold text-navy-900">{token}</p>
                <p className="font-mono text-xs text-navy-600">{value}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* ── Contrast ────────────────────────────────────────────────── */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-navy-900">
          What may carry words
        </h2>
        <p className="mt-2 max-w-2xl text-navy-700">
          Every token against every ground text is ever set on, computed from the hexes
          above. The verdict is the number, not an opinion about it: AAA is 7:1, AA is
          4.5:1, and below 3:1 a colour is a fill and nothing else — which is where{" "}
          <code className="rounded bg-cream-100 px-1">yellow-600</code> and{" "}
          <code className="rounded bg-cream-100 px-1">green-500</code> land, despite what
          their names suggest.
        </p>
        <div className="mt-6 overflow-x-auto rounded-xl border border-navy-200 bg-white">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-navy-200 text-left">
                <th className="px-3 py-2 font-display text-navy-900">Token</th>
                {GROUNDS.map((ground) => (
                  <th key={ground} className="px-3 py-2 font-display text-navy-900">
                    on {ground}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {swatches.map(({ token, hex: value }) => (
                <tr key={token} className="border-b border-navy-200 last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-mono text-xs text-navy-900">
                    {token}
                  </th>
                  {GROUNDS.map((ground) => {
                    const ratio = contrast(value, hex[ground]);
                    return (
                      <td key={ground} className="px-3 py-2">
                        <span
                          className="rounded px-2 py-1 font-mono text-xs"
                          style={{ background: hex[ground], color: value }}
                        >
                          {ratio.toFixed(2)}
                        </span>
                        <span className="ml-2 text-xs text-navy-600">{verdict(ratio)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── The manual, from the manual ─────────────────────────────── */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-navy-900">
          What is already settled
        </h2>
        <p className="mt-2 max-w-2xl text-navy-700">
          Rendered from{" "}
          <code className="rounded bg-cream-100 px-1">docs/branding/BRAND.md</code> at
          request time, so the manual and this page cannot disagree.
        </p>
        <div className="mt-6 max-w-2xl">
          {["1. The name", "2. The mark", "3. Lockups", "5. Typography", "6. Iconography", "7. Motion", "8. Voice", "9. Trademark"].map(
            (heading) => (
              <section key={heading} className="mt-8">
                <h3 className="font-display text-lg font-semibold text-navy-900">
                  {heading.replace(/^\d+\.\s/, "")}
                </h3>
                <div className="mt-2">
                  <EntryContent markdown={section(brand, heading)} />
                </div>
              </section>
            ),
          )}
        </div>

        <p className="mt-12 border-t border-navy-200 pt-6">
          <Link
            href="/docs/branding"
            className="text-sm font-semibold text-navy-700 underline decoration-blue-500 decoration-2 underline-offset-2 hover:text-navy-900"
          >
            Back to the workbenches
          </Link>
        </p>
      </div>
    </main>
  );
}
