"use client";

import { useEffect, useState } from "react";
import { useMotionValue } from "motion/react";
import Cityscape, { cityScale, floraFor } from "@/components/Cityscape";
import Travelers from "@/components/Travelers";
import TravelScene, { SKIES, type SkyName } from "@/components/TravelScene";
import Vehicle from "@/components/travel/Vehicle";
import Ground, { GROUND_HEIGHT, surfaceFor, type Surface } from "@/components/travel/Ground";
import { STARTING_POINTS } from "@/lib/travellers/presets";
import type { DaySummary, TransportMode, TravelSceneVariant } from "@/lib/types";
import type { Figure } from "@/lib/travellers/vocabulary";

/**
 * Every moving part of the travel scene, on one page, each one on its own.
 *
 * This is a workbench, not a gallery. It exists because of how the bugs in
 * this animation have actually been found: by slowing a six-second scene to
 * forty by hand, screenshotting it, and looking. Every one of them was
 * invisible in the code and obvious in a picture — a wheel spinning off its
 * axle, an aircraft with its wings raked forward, a locomotive pushing its own
 * carriages, a party left standing on open water, a marker that crossed a
 * fortieth of the lane it was meant to cross.
 *
 * So the two things it has to do are: **hold any moment still**, and **take
 * one piece out of the scene and show it alone**. A person can then say which
 * of the two it is — the drawing, or the timing — and an agent reading a
 * report can go to the right file.
 *
 * Nothing here is reachable from the site and nothing here is indexed. It
 * renders the real components with the real props; if it disagrees with the
 * story page, one of them is wrong and it is worth knowing which.
 */

const MODES: TransportMode[] = [
  "flight",
  "train",
  "bus",
  "car",
  "taxi",
  "motorbike",
  "bicycle",
  "boat",
  "walk",
];
const SURFACES: Surface[] = ["rail", "road", "water", "path", "sky"];
const VARIANTS: TravelSceneVariant[] = ["default", "quick", "skip"];
const SKY_NAMES = Object.keys(SKIES) as SkyName[];

/** Enough of a day to draw a leg. Nothing here is a record of anything. */
function fixtureDay(over: Partial<DaySummary>): DaySummary {
  return {
    date: "2024-01-01",
    slug: "fixture",
    location: "Somewhere",
    country: "Nowhere",
    countryCode: "CH",
    lat: 46.8,
    lng: 8.2,
    updates: 1,
    cost: 0,
    ...over,
  };
}

export default function AnimationWorkbench() {
  return (
    <div className="mx-auto max-w-5xl space-y-16 px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900">
          Travel scene workbench
        </h1>
        <p className="mt-3 max-w-2xl text-navy-700">
          Every part of the travel animation, one at a time. Hold a scene still at any
          moment, swap the mode, the sky, the party and the size of either town, and
          look at each vehicle, surface and skyline on its own.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-navy-600">
          Reporting something from here is most useful when it names the section: a
          fault in <em>Vehicles</em> is a drawing in{" "}
          <code className="rounded bg-cream-100 px-1">components/travel/Vehicle.tsx</code>, a
          fault in <em>Whole scene</em> that the parts do not show is timing in{" "}
          <code className="rounded bg-cream-100 px-1">components/TravelScene.tsx</code>.
        </p>
      </header>

      <SceneBench />
      <VehicleBench />
      <SurfaceBench />
      <SkylineBench />
      <PartyBench />
    </div>
  );
}

/* ---------------------------------------------------------------- sections */

function SceneBench() {
  const [mode, setMode] = useState<TransportMode>("train");
  const [variant, setVariant] = useState<TravelSceneVariant>("default");
  const [sky, setSky] = useState<SkyName>("day");
  const [preset, setPreset] = useState("european");
  const [partySize, setPartySize] = useState(2);
  const [fromPop, setFromPop] = useState(120_000);
  const [toPop, setToPop] = useState(2_000_000);
  const [lat, setLat] = useState(46.8);
  const [playing, setPlaying] = useState(true);
  const [at, setAt] = useState(0.35);
  /** Bumped to remount the scene, which is how a played run starts again. */
  const [run, setRun] = useState(0);

  const figure = STARTING_POINTS.find((p) => p.name === preset)?.figure ?? {};
  const party: Figure[] = Array.from({ length: partySize }, () => figure);

  const from = fixtureDay({
    slug: "from",
    location: "Departure",
    lat,
    lng: 8,
    population: fromPop,
  });
  const leg = fixtureDay({
    slug: `to-${run}`,
    location: "Arrival",
    lat,
    lng: 9.5,
    population: toPop,
    travelScene: variant,
    transport: { mode, from: "Departure", to: "Arrival" },
  });

  return (
    <Section
      title="Whole scene"
      note="The component the story page renders, with the same props. `skip` is drawn here for completeness — in the story the pager leaves that leg out entirely, so a reader never reaches it."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Choice label="Mode" value={mode} options={MODES} onChange={setMode} />
        <Choice label="Variant" value={variant} options={VARIANTS} onChange={setVariant} />
        <Choice label="Sky" value={sky} options={SKY_NAMES} onChange={setSky} />
        <Choice
          label="Party figure"
          value={preset}
          options={STARTING_POINTS.map((p) => p.name)}
          onChange={setPreset}
        />
        <Slider label="Party size" value={partySize} min={1} max={6} step={1} onChange={setPartySize} />
        <Slider label="Latitude" value={lat} min={-85} max={85} step={1} onChange={setLat}
          hint={`${floraFor(lat)} — what grows at this line`} />
        <Slider label="Departure population" value={fromPop} min={0} max={12_000_000} step={1000}
          onChange={setFromPop} hint={sizeHint(fromPop)} />
        <Slider label="Arrival population" value={toPop} min={0} max={12_000_000} step={1000}
          onChange={setToPop} hint={sizeHint(toPop)} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setPlaying(true);
            setRun((n) => n + 1);
          }}
          className="min-h-11 rounded-full bg-yellow-400 px-5 font-display text-sm font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
        >
          Play it through
        </button>
        <button
          type="button"
          onClick={() => setPlaying(false)}
          className="min-h-11 rounded-full border border-navy-200 bg-white px-5 font-display text-sm font-semibold text-navy-700 transition-colors hover:border-navy-500"
        >
          Hold at a moment
        </button>
        <div className="min-w-[240px] flex-1">
          <Slider
            label={`Moment — ${Math.round(at * 100)}%`}
            value={at}
            min={0}
            max={1}
            step={0.005}
            disabled={playing}
            onChange={(v) => {
              setPlaying(false);
              setAt(v);
            }}
          />
        </div>
      </div>

      <div className="mt-5">
        <TravelScene
          key={`${mode}-${variant}-${run}-${playing}`}
          leg={leg}
          from={from}
          party={party}
          sky={sky}
          at={playing ? undefined : at}
        />
      </div>
    </Section>
  );
}

function VehicleBench() {
  const [width, setWidth] = useState(180);
  const [surface, setSurface] = useState<Surface | "none">("none");
  return (
    <Section
      title="Vehicles"
      note="Each drawing on its own, at whatever size. Wheels turn here exactly as they do in the scene, so a wheel that leaves its axle is visible standing still. Every one faces right, because every leg crosses left to right — a vehicle pointing the other way is the bug, not the camera."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Slider label="Drawn width" value={width} min={60} max={340} step={5} onChange={setWidth} />
        <Choice
          label="Standing on"
          value={surface}
          options={["none", ...SURFACES] as (Surface | "none")[]}
          onChange={setSurface}
        />
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {MODES.filter((m) => m !== "walk").map((mode) => (
          <figure key={mode} className="overflow-hidden rounded-xl border border-navy-200 bg-sky-200">
            <div className="relative flex h-[150px] items-end justify-center">
              {surface !== "none" && <StaticGround surface={surface} />}
              <div
                className="relative z-10 mb-4"
                style={{ marginBottom: surface === "none" ? 16 : GROUND_HEIGHT[surface] / 2 }}
              >
                <Vehicle mode={mode} width={width} />
              </div>
            </div>
            <figcaption className="border-t border-navy-200 bg-white px-3 py-2 font-display text-xs font-semibold text-navy-700">
              {mode} · rides on {surfaceFor(mode)}
            </figcaption>
          </figure>
        ))}
        <figure className="overflow-hidden rounded-xl border border-navy-200 bg-sky-200">
          <div className="relative flex h-[150px] items-end justify-center">
            {surface !== "none" && <StaticGround surface={surface} />}
            <div className="relative z-10 mb-4">
              <Travelers size={64} available={220} />
            </div>
          </div>
          <figcaption className="border-t border-navy-200 bg-white px-3 py-2 font-display text-xs font-semibold text-navy-700">
            walk · has no vehicle — the party is what crosses
          </figcaption>
        </figure>
      </div>
    </Section>
  );
}

function SurfaceBench() {
  const [at, setAt] = useState(0.3);
  return (
    <Section
      title="Surfaces"
      note="What each mode crosses. These scroll on the leg's own camera, so dragging the slider is the same motion the scene makes — a tile that seams or jitters does it here too."
    >
      <Slider label={`Camera — ${Math.round(at * 100)}%`} value={at} min={0} max={1} step={0.005} onChange={setAt} />
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {SURFACES.map((surface) => (
          <figure key={surface} className="overflow-hidden rounded-xl border border-navy-200">
            <div className="relative h-[120px] bg-sky-300">
              <ScrubbedGround surface={surface} at={at} />
            </div>
            <figcaption className="border-t border-navy-200 bg-white px-3 py-2 font-display text-xs font-semibold text-navy-700">
              {surface}
              {surface === "sky" && " · draws nothing, on purpose"}
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

/** Population steps a person can hold in their head, rather than a slider. */
const POPULATIONS = [
  { label: "unknown", value: undefined },
  { label: "1 200", value: 1_200 },
  { label: "18 000", value: 18_000 },
  { label: "240 000", value: 240_000 },
  { label: "2.1 m", value: 2_100_000 },
  { label: "11 m", value: 11_000_000 },
];

const LATITUDES = [
  { label: "1° — tropics", lat: 1 },
  { label: "34° — temperate", lat: 34 },
  { label: "56° — northern", lat: 56 },
  { label: "78° — past the treeline", lat: 78 },
];

function SkylineBench() {
  return (
    <Section
      title="Skylines"
      note="Down the page, how big a place is — from the GeoNames population on the day, never from the name. Across it, what grows there — from the latitude. Both were once a hash and two palm trees, which is how Reykjavík got palms."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-2">
          <thead>
            <tr>
              <th className="w-24" />
              {LATITUDES.map((l) => (
                <th key={l.lat} className="text-left font-display text-xs font-semibold text-navy-700">
                  {l.label} · {floraFor(l.lat)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {POPULATIONS.map((pop) => (
              <tr key={pop.label}>
                <th scope="row" className="align-bottom text-left font-display text-xs font-semibold text-navy-700">
                  {pop.label}
                  <span className="block font-sans font-normal text-navy-500">
                    scale {cityScale(pop.value).toFixed(2)}
                  </span>
                </th>
                {LATITUDES.map((l) => (
                  <td key={l.lat} className="align-bottom">
                    <div className="flex h-[150px] items-end overflow-hidden rounded-lg bg-sky-300 px-2">
                      <Cityscape
                        name={`${pop.label}-${l.lat}`}
                        population={pop.value}
                        lat={l.lat}
                        width={200}
                        height={130}
                      />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function PartyBench() {
  const [size, setSize] = useState(72);
  const [count, setCount] = useState(3);
  const [preset, setPreset] = useState("east-african");
  const figure = STARTING_POINTS.find((p) => p.name === preset)?.figure ?? {};

  return (
    <Section
      title="Travellers"
      note="The figures the scene walks, drawn by lib/travellers/render.ts. There are no colours in this component and none here either — a party is described by attributes, and the starting points below resolve to attributes the moment they are picked."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Choice label="Starting point" value={preset} options={STARTING_POINTS.map((p) => p.name)} onChange={setPreset} />
        <Slider label="Figure size" value={size} min={32} max={140} step={2} onChange={setSize} />
        <Slider label="How many" value={count} min={1} max={10} step={1} onChange={setCount} />
      </div>
      <div className="mt-5 flex min-h-[190px] items-end rounded-xl border border-navy-200 bg-sky-200 p-4">
        <Travelers figures={Array.from({ length: count }, () => figure)} size={size} available={860} />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ pieces */

/** `Ground` at rest — it takes a motion value, and a static swatch has none. */
function StaticGround({ surface }: { surface: Surface }) {
  return <ScrubbedGround surface={surface} at={0} />;
}

function ScrubbedGround({ surface, at }: { surface: Surface; at: number }) {
  // `Ground` takes a motion value because in the scene it is driven by one.
  // Here the driver is a slider, so this is the adapter: a value seeded once
  // and written on every change, rather than re-created — re-creating it would
  // hand `Ground` a new object each render and lose the subscription.
  const scroll = useMotionValue(at);
  useEffect(() => {
    scroll.set(at);
  }, [at, scroll]);
  return <Ground surface={surface} scroll={scroll} />;
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
    <section className="scroll-mt-8" id={title.toLowerCase().replace(/\s+/g, "-")}>
      <h2 className="font-display text-xl font-semibold tracking-tight text-navy-900">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm text-navy-600">{note}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Choice<T extends string>({
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

function Slider({
  label,
  value,
  min,
  max,
  step,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block font-display text-xs font-semibold uppercase tracking-wide text-navy-600">
        {label}
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-yellow-400 disabled:opacity-50"
      />
      <span className="block text-xs text-navy-500">{hint ?? value.toLocaleString("en")}</span>
    </label>
  );
}

function sizeHint(pop: number): string {
  return `${pop.toLocaleString("en")} — scale ${cityScale(pop || undefined).toFixed(2)}`;
}
