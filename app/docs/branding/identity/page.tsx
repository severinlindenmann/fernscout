import type { Metadata } from "next";
import Link from "next/link";
import EntryContent from "@/components/EntryContent";
import { contrast, darkHues, GROUNDS, lockup, lockups, palette, screenPalette, verdict } from "@/lib/brand";
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
  const screenThemes = (["light", "dark"] as const).map((theme) => ({
    theme,
    roles: screenPalette(theme),
  }));
  const files = lockups(brand);
  const hex = Object.fromEntries(swatches.map((s) => [s.token, s.hex]));
  const dark = darkHues();
  const darkHex = Object.fromEntries(dark.map((s) => [s.token, s.hex]));
  const darkRoles = screenThemes.find((s) => s.theme === "dark")?.roles ?? [];
  const darkRoleHex = Object.fromEntries(darkRoles.map(({ token, hex: value }) => [token, value]));
  // The dark grounds a hue's text is actually checked on: the page/card
  // surfaces every component above renders on, plus the light fills that
  // flip alongside the two hues that sit on them (B1798).
  const DARK_GROUNDS = ["surface-base", "surface-raised", "surface-subtle"] as const;

  return (
    <main id="main" className="min-h-screen bg-surface-base">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">Identity</h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-body">
          The mark and the palette, read off the files that define them — the lockups
          from <code className="rounded bg-surface-subtle px-1 text-base">docs/branding/</code>,
          the colours from{" "}
          <code className="rounded bg-surface-subtle px-1 text-base">app/globals.css</code>, the
          contrast computed rather than claimed. Nothing here is a second copy, so
          changing a hex changes this page and nothing else needs editing.
        </p>

        {/* ── The lockups ─────────────────────────────────────────────── */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-ink-strong">The lockups</h2>
        <p className="mt-2 max-w-2xl text-ink-body">
          Never redraw these. Reference the file, or copy its paths verbatim — the
          geometry is tested, and a re-typed lozenge is always slightly wrong.
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {files.map(({ file, slot }) => (
            <li key={file} className="rounded-xl border border-line-quiet bg-surface-raised p-3">
              <Lockup
                file={file}
                ground={file.includes("inverse") ? "bg-navy-900" : "bg-surface-base text-ink-strong"}
              />
              <p className="mt-3 font-mono text-xs text-ink-secondary">{file}</p>
              <p className="text-sm text-ink-body">{slot}</p>
            </li>
          ))}
        </ul>

        {/*
          The check that has to be made by eye and cannot be made by scaling an
          SVG up in a viewer: a browser tab is 16 real pixels, and interior
          detail dies there. `favicon-check.mjs` rasterises properly; this is
          the glance that tells you whether to bother running it.
        */}
        <h3 className="mt-10 font-display text-lg font-semibold text-ink-strong">
          At the sizes a browser tab uses
        </h3>
        <p className="mt-2 max-w-2xl text-sm text-ink-body">
          Rendered from the same file, at 16, 24 and 32 CSS pixels. A mark that reads at
          64 can dissolve into noise here. For a true raster —{" "}
          <code className="rounded bg-surface-subtle px-1">
            node .claude/skills/apply-the-brand/favicon-check.mjs
          </code>
          .
        </p>
        <div className="mt-4 flex items-end gap-6 rounded-xl border border-line-quiet bg-surface-raised p-6">
          {[16, 24, 32].map((size) => (
            <figure key={size} className="text-center">
              <div
                style={{ width: size, height: size }}
                className="[&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: lockup("icon-waymark.svg") }}
              />
              <figcaption className="mt-2 font-mono text-xs text-ink-secondary">{size}</figcaption>
            </figure>
          ))}
        </div>

        {/* ── The palette ─────────────────────────────────────────────── */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-ink-strong">The palette</h2>
        <div className="mt-4 max-w-2xl">
          <EntryContent markdown={section(brand, "4. Colour")} />
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {swatches.map(({ token, hex: value }) => (
            <li key={token} className="overflow-hidden rounded-xl border border-line-quiet bg-surface-raised">
              <div className="h-16" style={{ background: value }} />
              <div className="px-3 py-2">
                <p className="font-mono text-xs font-semibold text-ink-strong">{token}</p>
                <p className="font-mono text-xs text-ink-secondary">{value}</p>
              </div>
            </li>
          ))}
        </ul>

        <h3 className="mt-10 font-display text-lg font-semibold text-ink-strong">
          Screen roles in both themes
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-body">
          Components use these job names. The brand hues above stay literal; only the
          screen role changes with the reader&apos;s appearance.
        </p>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {screenThemes.map(({ theme, roles }) => {
            const roleHex = Object.fromEntries(roles.map(({ token, hex: value }) => [token, value]));
            return (
              <section
                key={theme}
                data-theme={theme}
                className="rounded-xl border border-line-quiet bg-surface-base p-4 text-ink-strong"
              >
                <h4 className="font-display text-base font-semibold capitalize">{theme}</h4>
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {roles.map(({ token, hex: value }) => (
                    <li
                      key={token}
                      className="overflow-hidden rounded-lg border border-line-quiet bg-surface-raised"
                    >
                      <div className="h-10" style={{ background: value }} />
                      <div className="px-2 py-1.5">
                        <p className="truncate font-mono text-[10px] text-ink-strong">{token}</p>
                        <p className="font-mono text-[10px] text-ink-muted">{value}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <ul className="mt-4 space-y-1 font-mono text-[10px] text-ink-muted">
                  {["ink-strong", "ink-body", "ink-secondary"].flatMap((ink) =>
                    ["surface-base", "surface-raised", "surface-subtle"].map((surface) => {
                      const ratio = contrast(roleHex[ink], roleHex[surface]);
                      return (
                        <li key={`${ink}-${surface}`}>
                          {ink} on {surface}: {ratio.toFixed(2)} {verdict(ratio)}
                        </li>
                      );
                    }),
                  )}
                </ul>
              </section>
            );
          })}
        </div>

        {/* ── Contrast ────────────────────────────────────────────────── */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-ink-strong">
          What may carry words
        </h2>
        <p className="mt-2 max-w-2xl text-ink-body">
          Every token against every ground text is ever set on, computed from the hexes
          above. The verdict is the number, not an opinion about it: AAA is 7:1, AA is
          4.5:1, and below 3:1 a colour is a fill and nothing else — which is where{" "}
          <code className="rounded bg-surface-subtle px-1">yellow-600</code> and{" "}
          <code className="rounded bg-surface-subtle px-1">green-500</code> land, despite what
          their names suggest.
        </p>
        <div className="mt-6 overflow-x-auto rounded-xl border border-line-quiet bg-surface-raised">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line-quiet text-left">
                <th className="px-3 py-2 font-display text-ink-strong">Token</th>
                {GROUNDS.map((ground) => (
                  <th key={ground} className="px-3 py-2 font-display text-ink-strong">
                    on {ground}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {swatches.map(({ token, hex: value }) => (
                <tr key={token} className="border-b border-line-quiet last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-mono text-xs text-ink-strong">
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
                        <span className="ml-2 text-xs text-ink-secondary">{verdict(ratio)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/*
          The table above is a light-theme claim: its grounds are cream and
          the inverse navy card, and a hue with no dark override (everything
          except the two below) carries the same one number into dark mode
          too. `green-700` and `coral-600` do not — they, and the light fills
          they sit on in a badge, get their own dark value (B1798) — so the
          figure that matters on `#171d29` is a different one and belongs on
          its own bench rather than folded into the table above.
        */}
        <h3 className="mt-10 font-display text-lg font-semibold text-ink-strong">
          What may carry words, in the dark
        </h3>
        <p className="mt-2 max-w-2xl text-ink-body">
          Only the hues declared under <code className="rounded bg-surface-subtle px-1">
            :root[data-theme=&quot;dark&quot;]
          </code>{" "}
          have a value of their own here; everything else repeats its light-theme hex and,
          being unused as text in dark mode, is left off this table.
        </p>
        <div className="mt-6 overflow-x-auto rounded-xl border border-line-quiet bg-surface-raised">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line-quiet text-left">
                <th className="px-3 py-2 font-display text-ink-strong">Token (dark value)</th>
                {DARK_GROUNDS.map((ground) => (
                  <th key={ground} className="px-3 py-2 font-display text-ink-strong">
                    on {ground}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dark
                .filter(({ token }) => token === "green-700" || token === "coral-600")
                .map(({ token, hex: value }) => (
                  <tr key={token} className="border-b border-line-quiet last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-mono text-xs text-ink-strong">
                      {token} <span className="text-ink-secondary">{value}</span>
                    </th>
                    {DARK_GROUNDS.map((ground) => {
                      const ratio = contrast(value, darkRoleHex[ground]);
                      return (
                        <td key={ground} className="px-3 py-2">
                          <span
                            className="rounded px-2 py-1 font-mono text-xs"
                            style={{ background: darkRoleHex[ground], color: value }}
                          >
                            {ratio.toFixed(2)}
                          </span>
                          <span className="ml-2 text-xs text-ink-secondary">{verdict(ratio)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              {(
                [
                  ["green-700", "green-100"],
                  ["coral-600", "coral-50"],
                  ["coral-600", "coral-100"],
                ] as const
              ).map(([textToken, fillToken]) => {
                const fillHex = darkHex[fillToken];
                if (!fillHex) return null;
                const ratio = contrast(darkHex[textToken], fillHex);
                return (
                  <tr key={`${textToken}-on-${fillToken}`} className="border-b border-line-quiet last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-mono text-xs text-ink-strong">
                      {textToken} <span className="text-ink-secondary">on {fillToken} {fillHex}</span>
                    </th>
                    <td className="px-3 py-2" colSpan={DARK_GROUNDS.length}>
                      <span
                        className="rounded px-2 py-1 font-mono text-xs"
                        style={{ background: fillHex, color: darkHex[textToken] }}
                      >
                        {ratio.toFixed(2)}
                      </span>
                      <span className="ml-2 text-xs text-ink-secondary">
                        {verdict(ratio)} — the badge fill these hues sit on in dark mode
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── The manual, from the manual ─────────────────────────────── */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-ink-strong">
          What is already settled
        </h2>
        <p className="mt-2 max-w-2xl text-ink-body">
          Rendered from{" "}
          <code className="rounded bg-surface-subtle px-1">docs/branding/BRAND.md</code> at
          request time, so the manual and this page cannot disagree.
        </p>
        <div className="mt-6 max-w-2xl">
          {["1. The name", "2. The mark", "3. Lockups", "5. Typography", "6. Iconography", "7. Motion", "8. Voice", "9. Trademark"].map(
            (heading) => (
              <section key={heading} className="mt-8">
                <h3 className="font-display text-lg font-semibold text-ink-strong">
                  {heading.replace(/^\d+\.\s/, "")}
                </h3>
                <div className="mt-2">
                  <EntryContent markdown={section(brand, heading)} />
                </div>
              </section>
            ),
          )}
        </div>

        <p className="mt-12 border-t border-line-quiet pt-6">
          <Link
            href="/docs/branding"
            className="text-sm font-semibold text-ink-body underline decoration-blue-500 decoration-2 underline-offset-2 hover:text-ink-strong"
          >
            Back to the workbenches
          </Link>
        </p>
      </div>
    </main>
  );
}
