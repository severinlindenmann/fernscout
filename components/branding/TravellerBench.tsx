"use client";

import { useState } from "react";
import Travelers from "@/components/Travelers";
import { renderFigure } from "@/lib/travellers/render";
import { STARTING_POINTS } from "@/lib/travellers/presets";
import {
  ACCESSORIES,
  AGES,
  BUILDS,
  CLOTH,
  HAIR,
  HAIR_STYLES,
  OUTFITS,
  SKIN,
  type Accessory,
  type Age,
  type Build,
  type ClothColour,
  type Figure,
  type HairColour,
  type HairStyle,
  type Outfit,
  type SkinTone,
} from "@/lib/travellers/vocabulary";

/**
 * Every axis a person can be described along, drawn.
 *
 * The vocabulary is the product here: `describe-a-traveller` asks a handful of
 * questions and `trip.md` records the answers as words, so what a person
 * actually needs to see is *what each word looks like* — there is no other way
 * to find out, and the alternative is somebody guessing at "rich" or "coils"
 * from the name and being disappointed by a rendered figure they cannot easily
 * re-render.
 *
 * Two sections, and the split matters. **One figure** is for choosing: change
 * one attribute at a time and watch the same person change. **Every value** is
 * for checking: each option of each axis, side by side, all other attributes
 * held constant — which is the only arrangement in which a value that renders
 * identically to its neighbour, or not at all, is visible.
 *
 * There are no colours in this file. There are none in `Travelers` either, and
 * the reason is in that component's own comment: they used to be module
 * constants drawn as a likeness of one particular couple, hardcoded into every
 * journal on earth.
 */

/** Held constant everywhere in "Every value", so one axis varies at a time. */
const BASE: Figure = {
  skin: "medium",
  hair: "dark-brown",
  hairStyle: "short",
  eyes: "brown",
  shirt: "sky",
  pants: "slate",
  outfit: "trousers",
  build: "average",
  age: "adult",
};

export default function TravellerBench() {
  return (
    <div className="mx-auto max-w-5xl space-y-16 px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900">
          Travellers
        </h1>
        <p className="mt-3 max-w-2xl text-navy-700">
          Every word the walking figures are described in, and what each one draws. A
          journal records these as attributes in <code className="rounded bg-cream-100 px-1">trip.md</code>{" "}
          — never as a preset name — so this is the reference for what to write.
        </p>
      </header>

      <OneFigure />
      <EveryValue />
      <Presets />
    </div>
  );
}

/* ------------------------------------------------------------------ builder */

function OneFigure() {
  const [figure, setFigure] = useState<Figure>({ ...BASE });
  const [size, setSize] = useState(150);

  const set = <K extends keyof Figure>(key: K, value: Figure[K]) =>
    setFigure((f) => ({ ...f, [key]: value }));

  const toggleAccessory = (a: Accessory) =>
    setFigure((f) => {
      const have = f.accessories ?? [];
      return {
        ...f,
        accessories: have.includes(a) ? have.filter((x) => x !== a) : [...have, a],
      };
    });

  return (
    <Section
      title="One figure"
      note="Change one thing at a time and watch the same person change. The block on the right is what goes in the file."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Pick label="Skin" value={figure.skin ?? "medium"} options={Object.keys(SKIN) as SkinTone[]} onChange={(v) => set("skin", v)} />
          <Pick label="Hair colour" value={figure.hair ?? "dark-brown"} options={Object.keys(HAIR) as HairColour[]} onChange={(v) => set("hair", v)} />
          <Pick label="Hair style" value={figure.hairStyle ?? "short"} options={HAIR_STYLES as readonly HairStyle[]} onChange={(v) => set("hairStyle", v)} />
          <Pick label="Outfit" value={figure.outfit ?? "trousers"} options={OUTFITS as readonly Outfit[]} onChange={(v) => set("outfit", v)} />
          <Pick label="Shirt" value={figure.shirt ?? "sky"} options={Object.keys(CLOTH) as ClothColour[]} onChange={(v) => set("shirt", v)} />
          <Pick label="Pants" value={figure.pants ?? "slate"} options={Object.keys(CLOTH) as ClothColour[]} onChange={(v) => set("pants", v)} />
          <Pick label="Build" value={figure.build ?? "average"} options={BUILDS as readonly Build[]} onChange={(v) => set("build", v)} />
          <Pick label="Age" value={figure.age ?? "adult"} options={AGES as readonly Age[]} onChange={(v) => set("age", v)} />
          <fieldset className="sm:col-span-2">
            <legend className="font-display text-xs font-semibold uppercase tracking-wide text-navy-600">
              Accessories
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ACCESSORIES.map((a) => {
                const on = (figure.accessories ?? []).includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleAccessory(a)}
                    className={`min-h-11 rounded-full border px-3.5 font-display text-sm font-semibold transition-colors ${
                      on
                        ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                        : "border-navy-200 bg-white text-navy-700 hover:border-navy-500"
                    }`}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="sm:col-span-2 block">
            <span className="font-display text-xs font-semibold uppercase tracking-wide text-navy-600">
              Drawn at {size}px
            </span>
            <input
              type="range"
              min={48}
              max={260}
              step={2}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="mt-2 w-full accent-yellow-400"
            />
          </label>
        </div>

        <div>
          <div className="flex min-h-[300px] items-end justify-center rounded-xl border border-navy-200 bg-sky-200 p-4">
            <Figurine figure={figure} width={size} />
          </div>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-navy-200 bg-white p-3 font-mono text-xs text-navy-800">
            {toYaml(figure)}
          </pre>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ tables */

function EveryValue() {
  return (
    <Section
      title="Every value"
      note="Each option of each axis, everything else held constant. A value that draws the same as its neighbour, or draws nothing, is only visible in a row like this."
    >
      <div className="space-y-8">
        <Row axis="skin" values={Object.keys(SKIN) as SkinTone[]} make={(v) => ({ ...BASE, skin: v })} />
        <Row axis="hair" values={Object.keys(HAIR) as HairColour[]} make={(v) => ({ ...BASE, hair: v })} />
        <Row axis="hairStyle" values={HAIR_STYLES as readonly HairStyle[]} make={(v) => ({ ...BASE, hairStyle: v })} />
        <Row axis="outfit" values={OUTFITS as readonly Outfit[]} make={(v) => ({ ...BASE, outfit: v })} />
        <Row axis="shirt" values={Object.keys(CLOTH) as ClothColour[]} make={(v) => ({ ...BASE, shirt: v })} />
        <Row axis="build" values={BUILDS as readonly Build[]} make={(v) => ({ ...BASE, build: v })} />
        <Row axis="age" values={AGES as readonly Age[]} make={(v) => ({ ...BASE, age: v })} />
        <Row
          axis="accessories"
          values={ACCESSORIES as readonly Accessory[]}
          make={(v) => ({ ...BASE, accessories: [v] })}
        />
      </div>
    </Section>
  );
}

function Row<T extends string>({
  axis,
  values,
  make,
}: {
  axis: string;
  values: readonly T[];
  make: (v: T) => Figure;
}) {
  return (
    <div>
      <h3 className="font-display text-sm font-semibold text-navy-900">
        {axis}{" "}
        <span className="font-sans font-normal text-navy-500">· {values.length} values</span>
      </h3>
      <div className="mt-3 flex flex-wrap gap-3">
        {values.map((v) => (
          <figure key={v} className="w-[104px] overflow-hidden rounded-lg border border-navy-200">
            <div className="flex h-[130px] items-end justify-center bg-sky-200 pb-1">
              <Figurine figure={make(v)} width={92} />
            </div>
            <figcaption className="bg-white px-2 py-1.5 text-center font-mono text-[11px] text-navy-700">
              {v}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function Presets() {
  return (
    <Section
      title="Starting points"
      note="Twelve common combinations, offered so nobody has to mix hex codes to be drawn. A name resolves to attributes the moment it is picked and is never written to a file — see lib/travellers/presets.ts for why that rule exists."
    >
      <div className="flex flex-wrap gap-3">
        {STARTING_POINTS.map((p) => (
          <figure key={p.name} className="w-[124px] overflow-hidden rounded-lg border border-navy-200">
            <div className="flex h-[150px] items-end justify-center bg-sky-200 pb-1">
              <Figurine figure={p.figure} width={104} />
            </div>
            <figcaption className="bg-white px-2 py-1.5 text-center font-mono text-[11px] text-navy-700">
              {p.name}
            </figcaption>
          </figure>
        ))}
      </div>

      <h3 className="mt-8 font-display text-sm font-semibold text-navy-900">
        A party, walking
      </h3>
      <p className="mt-1 text-sm text-navy-600">
        The arrangement the hero and the travel scene use — figures shrink together
        rather than the party overflowing.
      </p>
      <div className="mt-3 flex min-h-[170px] items-end rounded-xl border border-navy-200 bg-sky-200 p-4">
        <Travelers figures={STARTING_POINTS.slice(0, 5).map((p) => p.figure)} size={80} available={820} />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * One still figure.
 *
 * `renderFigure` returns a complete `<svg>` as a string — it has to, because
 * the same function answers the preview route and the photobook sheet, neither
 * of which has React. `Travelers` does exactly this too; this is the same
 * escape hatch without the gait, because a bench comparing forty figures that
 * all bob is a bench nobody can read.
 *
 * Not an injection surface, and the reason is the vocabulary rather than any
 * escaping here: every value reaching `renderFigure` on this page comes from a
 * `<select>` whose options are the closed lists in `vocabulary.ts`, and the
 * renderer itself maps a name to a hex constant and drops anything it does not
 * know. There is no path from a URL, a request or a file to this string.
 */
function Figurine({ figure, width }: { figure: Figure; width: number }) {
  return (
    <div
      dangerouslySetInnerHTML={{ __html: renderFigure(figure, { width, decorative: true }) }}
    />
  );
}

/** The block as it would be written under `travellers:`, so it can be copied. */
function toYaml(figure: Figure): string {
  const lines = Object.entries(figure)
    .filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`);
  return `travellers:\n  -${lines.join("\n").slice(3)}`;
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold tracking-tight text-navy-900">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm text-navy-600">{note}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      <span className="block font-display text-xs font-semibold uppercase tracking-wide text-navy-600">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 min-h-11 w-full rounded-lg border border-navy-200 bg-white px-3 text-sm text-navy-900"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
