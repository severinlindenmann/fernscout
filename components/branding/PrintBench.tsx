"use client";

import { backLayout } from "@/lib/postcard/preview";
import { A6_LANDSCAPE } from "@/lib/postcard/spec";
import { contentBoxMm, defaultSpec, type BookSpec, type PageSide } from "@/lib/photobook/spec";

/**
 * Where the guillotine falls.
 *
 * Everything else in `/docs/branding` is drawn on a screen and can be judged
 * on a screen. These two are drawn on paper, cut, and posted — and the cost of
 * being a few millimetres wrong is a box of cards with somebody's address in
 * the sorting machine's blind spot, or a book with a face in the gutter.
 *
 * So this bench shows only the **geometry**: bleed, trim, safe area, gutter,
 * and the postal blocks whose position is specification rather than taste. No
 * photographs and no message, because content is what the previews inside a
 * journal are for — `/<user>/photobook` and `/<user>/postcards/<id>` — and
 * both of those need a real trip, real pictures and an owner.
 *
 * Every rectangle here comes from the same constants the renderer draws from,
 * expressed as a percentage. Two layout engines drift, and the one that drifts
 * is always the one nobody printed.
 */

/** The bands, in the order they stack. Colour carries the meaning here, so
 * each one is named beside the drawing rather than only in a legend. */
const INK = {
  bleed: "#f0bd2e",
  trim: "#37475f",
  safe: "#3aa76d",
  block: "#f06a8a",
};

export default function PrintBench() {
  return (
    <div className="mx-auto max-w-4xl space-y-14 px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900">
          Print geometry
        </h1>
        <p className="mt-3 max-w-2xl text-navy-700">
          The millimetres a printer works to, drawn from the same constants the renderers
          use. Nothing here has content in it: a photograph in the wrong place is a
          question for the previews inside a journal, and a <em>margin</em> in the wrong
          place is a question for this page.
        </p>
        <Legend />
      </header>

      <Postcard />
      <Spread />
    </div>
  );
}

function Legend() {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-navy-700">
      {[
        ["bleed", INK.bleed, "artwork runs to here and is cut away"],
        ["trim", INK.trim, "the finished edge"],
        ["safe", INK.safe, "nothing that matters goes outside this"],
        ["postal", INK.block, "position is specification, not taste"],
      ].map(([label, colour, note]) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: colour as string }}
            aria-hidden
          />
          <span className="font-display font-semibold text-navy-900">{label}</span>
          <span className="text-navy-500">{note}</span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------- postcard */

function Postcard() {
  const spec = A6_LANDSCAPE;
  const l = backLayout(spec);

  return (
    <Section
      title="Postcard, back"
      note={`A6 landscape · ${spec.trimWidthMm} × ${spec.trimHeightMm} mm trim · ${spec.bleedMm} mm bleed · ${spec.dpi} dpi`}
      source="lib/postcard/spec.ts · lib/postcard/preview.ts"
    >
      <div
        className="relative w-full overflow-hidden rounded-lg border-2 bg-cream-50"
        style={{ aspectRatio: l.aspect, borderColor: INK.bleed }}
      >
        <Box box={l.trim} colour={INK.trim} label="trim" />
        <Box box={l.message} colour={INK.safe} label="message" />
        <Box box={l.address} colour={INK.block} label="address" />
        <Box box={l.stamp} colour={INK.block} label="stamp" />
        <div
          className="absolute inset-y-0 w-px"
          style={{ left: l.dividerLeft, background: INK.trim }}
          aria-hidden
        />
      </div>
      <p className="mt-3 text-sm text-navy-600">
        The address block and the stamp area are where the sorting machine looks. Their
        position is a postal specification — moving them to balance the card is the one
        change on this page that would be rejected by a machine rather than by a person.
      </p>
    </Section>
  );
}

/* -------------------------------------------------------------- photobook */

function Spread() {
  // The shipped default — `specFor` layers a chosen size on top of this, and
  // the margins, which are what this drawing is about, are the same either way.
  const spec = defaultSpec();
  return (
    <Section
      title="Photobook, one spread"
      note={`${spec.size.trimWidthMm} × ${spec.size.trimHeightMm} mm trim · ${spec.bleedMm} mm bleed · ${spec.safeMm} mm safe · ${spec.gutterMm} mm gutter · ${spec.dpi} dpi`}
      source="lib/photobook/spec.ts"
    >
      <div className="flex justify-center gap-1 rounded-lg border border-navy-200 bg-cream-100 p-4">
        <Page spec={spec} side="left" />
        <Page spec={spec} side="right" />
      </div>
      <p className="mt-3 text-sm text-navy-600">
        The inner margin is wider than the outer one, and that asymmetry is the whole
        point of drawing both pages: the gutter is where the binding swallows the paper,
        so a face centred on the page is a face half in the spine.
      </p>
    </Section>
  );
}

function Page({ spec, side }: { spec: BookSpec; side: PageSide }) {
  const content = contentBoxMm(spec, side);
  const w = spec.size.trimWidthMm;
  const h = spec.size.trimHeightMm;
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;

  return (
    <div className="flex-1">
      <div
        className="relative w-full border-2 bg-white"
        style={{ aspectRatio: `${w} / ${h}`, borderColor: INK.trim }}
      >
        <div
          className="absolute border-2 border-dashed"
          style={{
            left: pct(content.x, w),
            top: pct(content.y, h),
            width: pct(content.width, w),
            height: pct(content.height, h),
            borderColor: INK.safe,
          }}
        >
          <span className="absolute left-1 top-1 font-mono text-[10px] text-navy-600">
            content
          </span>
        </div>
      </div>
      <p className="mt-1 text-center font-mono text-[11px] text-navy-600">
        {side} page · gutter {side === "right" ? "left" : "right"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Box({
  box,
  colour,
  label,
}: {
  box: { left: string; top: string; width: string; height: string };
  colour: string;
  label: string;
}) {
  return (
    <div
      className="absolute border-2 border-dashed"
      style={{ ...box, borderColor: colour }}
    >
      <span className="absolute left-1 top-0.5 font-mono text-[10px] text-navy-700">
        {label}
      </span>
    </div>
  );
}

function Section({
  title,
  note,
  source,
  children,
}: {
  title: string;
  note: string;
  source: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold tracking-tight text-navy-900">{title}</h2>
      <p className="mt-1 font-mono text-xs text-navy-600">{note}</p>
      <p className="font-mono text-xs text-navy-500">{source}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
