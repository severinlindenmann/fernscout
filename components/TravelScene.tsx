"use client";

import { useEffect, useState } from "react";
import {
  animate,
  cubicBezier,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  Plane,
  TrainFront,
  TrainFrontTunnel,
  TramFront,
  Bus,
  Bike,
  Motorbike,
  Car,
  CarTaxiFront,
  Ship,
  Footprints,
  Cloud,
} from "lucide-react";
import type { DaySummary, TransportMode, TravelSceneVariant } from "@/lib/types";
import type { Figure } from "@/lib/travellers/vocabulary";
import Travelers from "./Travelers";
import { useOptionalSite } from "./SiteProvider";
import { useTrip } from "./TripProvider";
import { partyFor } from "@/lib/travellers/parse";
import Cityscape from "./Cityscape";
import Vehicle from "./travel/Vehicle";
import Ground, { GROUND_HEIGHT, surfaceFor } from "./travel/Ground";
import Skyline from "./travel/Skyline";
import TunnelWall, { TUNNEL_WALL_HEIGHT } from "./travel/TunnelWall";

/**
 * The glyphs, kept for the `quick` variant only.
 *
 * `quick` is a line and a marker crossing it — deliberately a diagram rather
 * than a scene, for a reader on their fortieth identical hop — and a diagram
 * is exactly where an icon belongs. The full scene draws real vehicles; see
 * `components/travel/Vehicle.tsx`.
 */
const VEHICLE_ICON = {
  flight: Plane,
  train: TrainFront,
  // The underground/elevated feel a metro needs and a `TrainFront` does not
  // give it — B1519.
  metro: TrainFrontTunnel,
  tram: TramFront,
  bus: Bus,
  motorbike: Motorbike,
  bicycle: Bike,
  car: Car,
  taxi: CarTaxiFront,
  boat: Ship,
  ferry: Ship,
  walk: Footprints,
} as const;

/**
 * Where things stand on each surface, in px from the bottom of the frame.
 *
 * Two numbers rather than one because a hull and a pair of boots do not sit at
 * the same height in the same water: the party stands *on* a road and *beside*
 * the sea, and a boat rides *in* it. Getting this wrong is the difference
 * between a ferry and a ferry buried to its windows.
 */
/* Where a party's feet go, per surface. Every value but `sky` is a height
 * within the band `Ground` draws; a flight draws no band at all
 * (`GROUND_HEIGHT.sky` is 0), so 26 there stood them in mid-air over the ridge
 * and over the skyline they were meant to be standing in — B705. The ground on
 * a flight leg is where `Hills` and both `Cityscape`s sit, which is the bottom
 * of the frame. */
const STAND_ON = { rail: 30, road: 30, water: 58, sky: 4, path: 26 } as const;
const RIDE_ON = { rail: 8, road: 10, water: 14, sky: 60, path: 0 } as const;

/*
 * The four moments a leg with a vehicle in it has, as fractions of the leg.
 *
 * Before B706 there were none of these: the vehicle crossed the frame on its
 * own clock and the party faded out where they stood, so a bus drove past the
 * people it was meant to be carrying and nobody ever boarded anything. The
 * shape now is stop, board, cross, stop, step off — and the camera pan runs
 * between the two stops, because that is exactly when anyone is moving.
 */
const BOARD = 0.2;   // the vehicle has stopped beside them; they get in
const DEPART = 0.26; // aboard, and pulling away
const ARRIVE = 0.8;  // stopped at the far end
const ALIGHT = 0.88; // out, and standing in the new place

/** Where the vehicle waits at each end, as a share of the frame. The party
 * stands at PARTY_FROM, so the near stop overlaps them a little — the vehicle
 * draws over the party, which is what makes them disappear *into* it. */
const STOP_FROM = "14%";
const STOP_TO = "58%";
const PARTY_FROM = "6%";
const PARTY_TO = "64%";

/** How wide each vehicle is drawn in the full scene. A train is a train
 * because it is long; a motorbike is small because it is. */
const VEHICLE_WIDTH: Record<TransportMode, number> = {
  train: 210,
  flight: 165,
  bus: 145,
  boat: 150,
  // A ferry is drawn as a full-size boat — see `vehicleBody` in
  // lib/travel/vehicleShapes.ts — so it gets the same width.
  ferry: 150,
  car: 115,
  taxi: 115,
  motorbike: 95,
  bicycle: 84,
  // B1545 — its own shell now (see lib/travel/vehicleShapes.ts). Drawn
  // twice `train`'s own width: a metro leg now stands under a full skyline
  // (`Skyline`), and anything train-sized or smaller read as a toy beside it.
  metro: 420,
  tram: 100,
  walk: 0,
};

/**
 * What the sky is doing.
 *
 * A closed list rather than a class name, because a caller handing this
 * component arbitrary CSS is a caller that can put anything behind somebody's
 * journey. Nothing selects one yet — every leg on the site is `day` — and it
 * is here because the workbench needs to show the scene against more than one
 * ground before anybody commits to deriving it from the date and the latitude,
 * which is the only honest way it could ever be chosen automatically.
 */
export type SkyName = "day" | "overcast" | "dusk" | "night";

export const SKIES: Record<SkyName, string> = {
  day: "bg-gradient-to-b from-sky-300 to-sky-400",
  overcast: "bg-gradient-to-b from-slate-300 to-slate-400",
  dusk: "bg-gradient-to-b from-orange-200 via-rose-300 to-indigo-300",
  night: "bg-gradient-to-b from-indigo-900 to-slate-800",
};

/** Duration when either end of the leg carries no coordinates — the middle
 * of the range below, and what every leg played before duration varied. */
const FALLBACK_DURATION = 6;

/**
 * How a mode's own pace stretches the distance-derived duration.
 *
 * Distance alone is not how long a journey feels. Two days on the Mekong and
 * two hundred kilometres of motorway are the same number on a map and nothing
 * like each other to sit through, and the scene was playing the boat *faster*
 * than the car because the river is shorter. A crossing on foot or by water is
 * the slowest thing in the list; a flight covers the most ground in the least
 * time and is the only one under 1.
 */
const PACE: Record<TransportMode, number> = {
  walk: 1.7,
  boat: 1.6,
  ferry: 1.6,
  train: 1.15,
  bus: 1.15,
  metro: 1.15,
  tram: 1.15,
  car: 1,
  taxi: 1,
  motorbike: 1,
  bicycle: 1.5,
  flight: 0.85,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** 0 below `from`, 1 above `to`, linear between — `useTransform`'s range
 * mapping, for the places that need to combine two of them. */
function ramp(v: number, from: number, to: number): number {
  return clamp((v - from) / (to - from), 0, 1);
}

/**
 * Great-circle distance in km. The same formula as `haversineKm` in
 * lib/plan.ts and `distanceKm` in lib/ingest/geo.ts, kept as its own copy
 * here rather than imported: both of those pull in `server-only` or
 * `node:fs`, and this component runs in the browser.
 */
function greatCircleKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The distance a leg covered, or `null` when either end has no coordinates
 * to measure from — a hand-written entry without `lat`/`lng` is common
 * enough that this has to be a real case, not an edge one.
 */
export function legDistanceKm(from: DaySummary | undefined, leg: DaySummary): number | null {
  if (!from) return null;
  const coords = [from.lat, from.lng, leg.lat, leg.lng];
  if (coords.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  return greatCircleKm({ lat: from.lat, lng: from.lng }, { lat: leg.lat, lng: leg.lng });
}

/**
 * How long one leg takes to play, in seconds.
 *
 * Every leg used to take the same `FALLBACK_DURATION` regardless of what it
 * actually crossed — a night bus and a transoceanic flight played the
 * identical six seconds. `"quick"` compresses the same idea into a couple of
 * seconds for a reader who has already sat through the full scene many
 * times; `"skip"` never reaches this at all, because `buildSteps` leaves it
 * out of the pager. Unknown distance falls back to the middle of each range,
 * not the top or the bottom, since it is not evidence either way.
 */
export function sceneDurationSeconds(
  variant: TravelSceneVariant,
  km: number | null,
  mode: TransportMode = "car",
): number {
  const pace = PACE[mode] ?? 1;
  if (variant === "quick") {
    // `quick` exists to be short, so the pace barely touches it — a reader who
    // asked for the compressed scene did not ask for a slower compressed one.
    return clamp((km === null ? 1.8 : 1.2 + Math.sqrt(km) / 40) * (1 + (pace - 1) / 3), 1.2, 3);
  }
  const base = km === null ? FALLBACK_DURATION : 3 + Math.sqrt(km) / 10;
  return clamp(base * pace, 3, 11);
}

/**
 * One leg of the trip, played on its own screen: the travellers head off, the
 * vehicle crosses (arcing up and back down for flights), and the destination
 * rises into view.
 *
 * This used to be scroll-driven. It isn't any more — the story is paged, so
 * the leg simply plays, and the reader either waits for it or skips ahead.
 *
 * **Variants.** `leg.travelScene` picks the treatment: `"default"` (or
 * absent) is the scene above, timed to the distance actually crossed;
 * `"quick"` compresses to an icon crossing a line, for a trip whose every
 * leg looks the same by day thirty; `"skip"` is handled one level up, by
 * `buildSteps` leaving the leg out of the pager entirely, so it never
 * reaches this component in practice. It is still handled defensively here —
 * rendered as the default scene but collapsed to the same near-zero duration
 * as reduced motion — so a caller that renders one directly never hangs.
 */
export default function TravelScene({
  leg,
  from,
  onDone,
  at,
  party: partyOverride,
  sky = "day",
}: {
  /** The day arrived at. A leg is entirely described by where it went and
   * how, both of which the story's day index already carries — so a travel
   * scene never waits on the day's content to load. */
  leg: DaySummary;
  /** The day travelled from, in the same index — enough to measure the
   * distance this leg covers. Absent plays the fallback duration. */
  from?: DaySummary;
  onDone?: () => void;
  /**
   * Hold the scene at one instant, 0→1, instead of playing it.
   *
   * Nothing on the site passes this. It is the seam `/docs/branding/animation`
   * needs, and the reason it exists is that half the bugs in this component
   * were only ever visible at a particular moment of a six-second animation —
   * a wheel spinning off its axle, a party standing on open water, an aircraft
   * whose wings raked forward. Each was found by slowing the whole thing to
   * forty seconds by hand and screenshotting it, which is a thing a person
   * should be able to do with a slider.
   *
   * `onDone` never fires while it is set: a held scene has not finished.
   */
  at?: number;
  /** Draw these figures rather than the trip's. Workbench only. */
  party?: Figure[];
  /** Which sky. Nothing selects one yet — the story always gets `day` — and
   * it is a closed list rather than a class name so that whatever does choose
   * one later has a vocabulary to choose from. */
  sky?: SkyName;
}) {
  const p = useMotionValue(0);
  /** How far a *playing* scene has got. A held one is not playing, and its
   * progress is the prop — keeping it in state as well would mean writing to
   * state from inside an effect for a value already in hand. */
  const [played, setPlayed] = useState(0);
  const held = at !== undefined;
  const progress = at ?? played;

  /*
   * The same party the hero draws.
   *
   * `useTrip` is null outside a trip's story and `useOptionalSite` answers
   * null above a journal — neither is true on the site, where this only ever
   * renders inside both. The fallbacks cost two `?.` and are what let the
   * component be rendered on its own by the workbench, which is a page under
   * `/docs` and therefore has neither provider over it.
   */
  const site = useOptionalSite();
  const active = useTrip();
  const party =
    partyOverride ?? partyFor(active?.trip.travellers ?? [], site?.travellerFigures ?? []);

  const variant: TravelSceneVariant = leg.travelScene ?? "default";
  const km = legDistanceKm(from, leg);
  // Declared before the effect below, which needs it to time the leg.
  const mode: TransportMode = leg.transport?.mode ?? "walk";

  useEffect(() => {
    // Held: show that instant and do not play. `onDone` stays silent, because
    // a scene somebody is holding at 40% has not arrived anywhere.
    if (at !== undefined) {
      p.set(at);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // One effect, one `animate` call, for every variant — reduced motion and
    // a directly-rendered "skip" both collapse to the same near-zero
    // duration, so there is exactly one place `onDone` can fire from and no
    // per-variant branch to keep in sync.
    const duration =
      reduce || variant === "skip" ? 0.01 : sceneDurationSeconds(variant, km, mode);
    const controls = animate(p, 1, {
      duration,
      ease: "linear",
      onUpdate: setPlayed,
      onComplete: () => onDone?.(),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg.slug, at]);

  const Icon = VEHICLE_ICON[mode] ?? Plane;
  const isFlight = mode === "flight";
  const onFoot = mode === "walk";
  const quick = variant === "quick";
  const surface = surfaceFor(mode);
  const groundH = GROUND_HEIGHT[surface];
  // B1545 — `metro` is the one rail mode that actually runs underground.
  // `tram` stays street-level and keeps the plain rail band.
  const underground = mode === "metro";
  // Where a named city's own skyline stands — the tunnel's roof when one
  // exists, or the ground otherwise. Shared with `Skyline` so all three
  // skylines (departure, arrival, the generic one between them) stand on the
  // same line.
  const cityBottom = underground ? groundH + TUNNEL_WALL_HEIGHT - 6 : groundH - 6;

  /*
   * One camera, and everything else hangs off it.
   *
   * The first version of this gave every layer its own linear ramp across the
   * whole leg, which is what made it feel out of time with itself: the road
   * was already rushing past under a party still standing beside it, the
   * departure town began sliding away before anyone had left, and the world
   * was still moving after the vehicle had arrived.
   *
   * It also mixed two incompatible ideas of where the viewer is standing. A
   * scrolling world says the camera travels *with* the vehicle; a vehicle
   * crossing the frame says the camera is nailed down. Both at once reads as
   * two animations playing over each other, because that is what it is.
   *
   * So: the camera is still while they are still, pans with them once they
   * leave, and comes to rest as they arrive. `travel` is that pan — one eased
   * 0→1 — and the ground, the ridge, the clouds and both towns are each just
   * this curve times their own distance. Nearer means further, which is the
   * parallax; sharing the curve is what keeps them one world.
   */
  /*
   * The pan runs between the two stops and nowhere else — see BOARD/ALIGHT
   * above. On foot there is nothing to stop, so it runs the old bracket.
   */
  const travel = useTransform(p, onFoot ? [0.16, 0.9] : [DEPART, ARRIVE], [0, 1], {
    // Eased at both ends rather than clamped-linear: a world that starts
    // moving at full speed on one frame is the single most mechanical thing
    // an animation like this can do.
    ease: cubicBezier(0.45, 0, 0.3, 1),
    clamp: true,
  });

  const cloudsX = useTransform(travel, [0, 1], ["2%", "-9%"]);
  const hillsX = useTransform(travel, [0, 1], ["0%", "-22%"]);

  /*
   * Both ends of the leg, not just the arrival, and both carried by the same
   * pan — the origin leaves at the speed the destination arrives, because
   * they are the same distance apart in the same world.
   *
   * Before this the origin was an empty green field: the party set off from
   * nowhere towards a city that rose out of the ground.
   */
  const originX = useTransform(travel, [0, 1], ["0%", "-260%"]);
  const originOpacity = useTransform(travel, [0, 0.35, 0.6], [1, 1, 0]);
  const destX = useTransform(travel, [0, 1], ["190%", "0%"]);
  const destOpacity = useTransform(travel, [0.4, 0.62], [0, 1]);

  /*
   * The vehicle is the one thing that moves *against* the camera rather than
   * with it: it comes in from the left, settles near the middle for as long
   * as the world is going past, and carries on out to the right as the
   * destination arrives. Held near the centre rather than swept straight
   * across because that is what a camera panning alongside actually shows.
   *
   * The percentages are of the *frame*, which is why the wrapper below is
   * `inset-x-0` rather than sitting at `left-0`. They used to be percentages
   * of the vehicle's own width, so a 115px car crossed 144px of a 710px frame
   * and then vanished — it never reached the far side at all.
   */
  const vehicleX = useTransform(
    p,
    [0.04, BOARD, DEPART, 0.42, 0.7, ARRIVE, ALIGHT, 1],
    ["-32%", STOP_FROM, STOP_FROM, "34%", "44%", STOP_TO, STOP_TO, "124%"],
    {
      // Eased per segment, because the two stops are the point: it decelerates
      // into the near one, holds, accelerates away, and settles into the far
      // one. Linear throughout and it slides to a halt like a puck.
      ease: [
        cubicBezier(0.2, 0, 0.2, 1), // in, and braking
        cubicBezier(0, 0, 1, 1), // stopped
        cubicBezier(0.5, 0, 0.6, 1), // pulling away
        cubicBezier(0, 0, 1, 1),
        cubicBezier(0.4, 0, 0.2, 1), // braking again
        cubicBezier(0, 0, 1, 1), // stopped
        cubicBezier(0.5, 0, 0.5, 1), // and gone
      ],
      clamp: true,
    },
  );
  /* A flight is on the ground at both stops — 50 against `RIDE_ON.sky` of 60
   * puts it beside the party rather than ten metres over their heads — and
   * climbs only between them. */
  const vehicleY = useTransform(
    p,
    [BOARD, 0.42, 0.7, ARRIVE],
    isFlight ? [50, -70, -70, 50] : [0, 0, 0, 0],
  );
  const vehicleRotate = useTransform(
    p,
    [BOARD, DEPART, 0.4, 0.72, ARRIVE],
    isFlight ? [0, -7, -13, 9, 0] : [0, 0, 0, 0, 0],
  );
  // It arrives before it stops and leaves after it goes, so both ends of the
  // fade are off in the wings rather than over the party.
  const vehicleOpacity = useTransform(p, [0.02, 0.1, 0.96, 1], [0, 1, 1, 0]);
  // A hull has no wheels; the swell is what carries it. Small and slow — a
  // boat that bobs like a cork reads as a toy.
  const hullY = useTransform(
    p,
    [0, 0.25, 0.5, 0.75, 1],
    mode === "boat" ? [0, -4, 1, -3, 0] : [0, 0, 0, 0, 0],
  );

  /*
   * The party stands, boards, and steps off — they no longer leave under
   * their own steam at all.
   *
   * On foot there is no vehicle, so they are what the camera follows: they
   * hold near the middle of the frame for the whole crossing while the path
   * goes past under them, which is the same treatment every other mode gives
   * its vehicle.
   *
   * Otherwise they wait at PARTY_FROM for the vehicle to pull up, go as it
   * pulls away, and are standing at PARTY_TO when it stops at the far end.
   * Two earlier versions had them walking rightwards out of frame while the
   * world scrolled the other way (two directions of travel at once), and then
   * drifting left with the town they were standing in — which was in time
   * with the world but meant nobody ever got on board anything. B706.
   */
  const peopleX = useTransform(
    p,
    onFoot ? [0.16, 0.34, 0.76, 0.97] : [0, BOARD, ARRIVE, 1],
    onFoot
      ? ["6%", "34%", "44%", "104%"]
      : // They stand where they stand until they board, and are back on their
        // feet at the far stop. The move between the two happens while they
        // are inside the vehicle and invisible, which is why it can be a
        // straight interpolation and not a walk.
        [PARTY_FROM, PARTY_FROM, PARTY_TO, PARTY_TO],
  );
  /*
   * One clock now, and it is the leg's own: every moment the party has is a
   * moment the vehicle also has, so both read from `p`. It used to fade them
   * out on the pan instead, which was the right answer while leaving *was*
   * the pan and is the wrong one now that boarding is.
   */
  const peopleOpacity = useTransform(p, (leg: number) => {
    if (onFoot) return ramp(leg, 0, 0.08) * (1 - ramp(leg, 0.9, 1));
    // Standing there from the first frame, gone once the doors are shut, back
    // on the pavement at the far end and staying — a leg that has arrived is
    // the party in the new place, not an empty street.
    const before = ramp(leg, 0.01, 0.08) * (1 - ramp(leg, BOARD, DEPART));
    const after = ramp(leg, ARRIVE + 0.02, ALIGHT);
    return Math.max(before, after);
  });

  /*
   * The quick scene's marker crosses a plain lane, edge to edge.
   *
   * Two things were wrong with it and both made the scene look broken rather
   * than brief. The percentage was of the marker's own width, so a 40px chip
   * travelled 40px of the lane and stopped; and it faded to nothing at the
   * end, so a leg that had finished was an empty line with a caption over it —
   * which is what "the train does not render" looks like. It arrives now, and
   * stays arrived.
   */
  const quickX = useTransform(p, [0.06, 0.94], ["-2%", "92%"]);
  const quickOpacity = useTransform(p, [0, 0.08], [0, 1]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border border-navy-200 shadow-sm ${
        quick ? "h-[110px] bg-navy-50" : `h-[280px] sm:h-[340px] ${SKIES[sky] ?? SKIES.day}`
      }`}
    >
      {quick ? (
        <div className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-navy-200">
          {/* The lane behind the marker, filled in as far as it has got. */}
          <motion.div
            style={{ scaleX: p }}
            className="absolute inset-0 origin-left rounded-full bg-yellow-400"
          />
          {/* `inset-x-0` so the offset above is a share of the lane, not of
              the marker. Motion writes `transform`, so the centring cannot be
              a `-translate-x-1/2` utility — it would be overwritten. */}
          <motion.div
            style={{ x: quickX, opacity: quickOpacity }}
            className="absolute inset-x-0 -top-5"
          >
            <div className="w-fit rounded-full bg-white p-2 shadow-md shadow-navy-900/15">
              <Icon className="h-5 w-5 text-navy-900" strokeWidth={1.75} />
            </div>
          </motion.div>
        </div>
      ) : (
        <>
          {/* Sky, slowest. A flight gets more of it, because for the length of
              a flight the sky is the whole world. */}
          <motion.div style={{ x: cloudsX }} className="pointer-events-none absolute inset-0">
            <Cloud className="absolute left-[12%] top-6 h-10 w-10 fill-white text-white opacity-90" />
            <Cloud className="absolute left-[56%] top-10 h-7 w-7 fill-white text-white opacity-75" />
            <Cloud className="absolute left-[84%] top-5 h-8 w-8 fill-white text-white opacity-80" />
            {isFlight && (
              <>
                <Cloud className="absolute left-[30%] top-24 h-12 w-12 fill-white text-white opacity-70" />
                <Cloud className="absolute left-[70%] top-32 h-9 w-9 fill-white text-white opacity-60" />
              </>
            )}
          </motion.div>

          {/* Distant hills — the layer between the clouds and the skylines,
              and the thing that stopped the frame being two thirds empty sky
              on a leg between two small places. Drawn from the arrival's name
              so a leg looks the same every time it plays. A crossing by sea
              has no hills in the middle of it. */}
          {surface !== "water" && (
            <motion.div style={{ x: hillsX }} className="pointer-events-none absolute inset-0">
              <Hills seed={leg.location} bottom={groundH - 4} />
            </motion.div>
          )}

          {/* The city a metro leg runs under — full width, generic (there is
              no third place name to draw it from), standing on the tunnel's
              own roof rather than on the actual ground, so the towers start
              clear of the wall instead of being half-buried in it. B1545. */}
          {underground && (
            <Skyline seed={leg.location} scroll={travel} bottom={groundH + TUNNEL_WALL_HEIGHT} />
          )}

          {/* Middle distance: where they left, and where they are going. Both
              ends are in the day index already, so drawing both costs nothing
              and waits on nothing. Underground, these stand on the tunnel's
              roof beside `Skyline` rather than at ground level — otherwise
              the wall buries most of each one, leaving only a sliver of a
              named city peeking out from behind it. */}
          <div className="pointer-events-none absolute inset-0">
            {from && (
              <motion.div
                style={{ x: originX, opacity: originOpacity, bottom: cityBottom }}
                className="absolute left-2"
              >
                <Cityscape
                  name={from.location}
                  population={from.population}
                  lat={from.lat}
                  airport={isFlight}
                  width={230}
                  height={130}
                />
              </motion.div>
            )}

            <motion.div
              style={{ x: destX, opacity: destOpacity, bottom: cityBottom }}
              className="absolute right-2"
            >
              <Cityscape
                name={leg.location}
                population={leg.population}
                lat={leg.lat}
                airport={isFlight}
                width={250}
                height={150}
              />
            </motion.div>
          </div>

          {/* A metro leg spends its crossing below ground — the wall sits in
              front of the lower half of the cityscape above (so the skyline
              still shows above it) and just above Ground's own rail band. */}
          {underground && <TunnelWall scroll={travel} bottom={groundH} />}

          {/* Nearest layer, and therefore the fastest. Driven by the same pan
              as everything else, so the road is not already moving under a
              party who have not left yet. */}
          <Ground surface={surface} scroll={travel} dark={underground} />

          {/* `inset-x-0` so the percentages above are of the frame. At
              `left-8` they were percentages of the party's own width, which is
              why nobody ever got very far. */}
          <motion.div
            style={{ x: peopleX, opacity: peopleOpacity, bottom: STAND_ON[surface] }}
            className="absolute inset-x-0"
          >
            <div className="w-fit">
              <Travelers figures={party} size={58} available={200} />
            </div>
          </motion.div>

          {/* Nothing crosses on a leg made on foot — the party above is the
              whole of it. */}
          {!onFoot && (
            <motion.div
              style={{ x: vehicleX, y: vehicleY, bottom: RIDE_ON[surface] }}
              className="absolute inset-x-0"
            >
              {/* Rotation and the swell belong to the vehicle, not to the
                  full-width track it slides along — rotating the track would
                  swing it about the frame's centre. */}
              <motion.div
                style={{ rotate: vehicleRotate, y: hullY, opacity: vehicleOpacity }}
                className="w-fit origin-bottom"
              >
                <Vehicle mode={mode} width={VEHICLE_WIDTH[mode]} />
              </motion.div>
            </motion.div>
          )}
        </>
      )}

      <Caption leg={leg} progress={p} />

      {/* How far through the leg we are. */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
        <div
          // The easing is for a scene that is playing. Held on a slider it
          // would lag a hundred milliseconds behind the hand dragging it.
          className={`h-full bg-yellow-400 ${held ? "" : "transition-[width] duration-100 ease-linear"}`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * A ridge line across the back of the scene.
 *
 * Two overlapping bands rather than one, because a single silhouette reads as
 * a paper cut-out; the paler one behind is what gives the distance. Derived
 * from the arrival's name so the same leg draws the same hills every time,
 * the way `Cityscape` does — and deliberately *not* from anything real, since
 * nothing in a day's frontmatter says what the horizon looked like. They are
 * scenery, at the size and opacity of scenery.
 */
function Hills({ seed, bottom }: { seed: string; bottom: number }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const pick = (i: number, lo: number, hi: number) =>
    lo + (((Math.abs(h) >> (i * 3)) % 100) / 100) * (hi - lo);

  const ridge = (peaks: number[]) => {
    const step = 100 / (peaks.length - 1);
    // Anchored past both edges so the ridge still fills the frame once the
    // parallax has slid it, and closed along the bottom rather than at the
    // peaks — a ridge that ends mid-air reads as a torn piece of paper.
    return `M-20,120 ${peaks.map((y, i) => `L${i * step},${y}`).join(" ")} L120,120 Z`;
  };

  return (
    <svg
      // `width` matters: an <svg> with only a viewBox takes its intrinsic size
      // from it, so `inset-x-0` left this 100px wide at the far left of the
      // frame and the hills appeared to be part of the departure town.
      // The extra 30% and the offset are the room the parallax slides into.
      className="absolute"
      style={{ bottom, height: 120, left: "-15%", width: "130%" }}
      viewBox="0 0 100 120"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* Hazy blue for the far ridge and a green-grey for the near one. They
          were white at a fifth opacity for one iteration, which on a sky this
          pale is invisible — distance in a flat illustration is a shift in hue
          towards the sky, not a fade to nothing. */}
      <path
        d={ridge([100, pick(0, 46, 74), pick(1, 62, 86), pick(2, 40, 70), pick(3, 66, 90), 104])}
        fill="#9ed3e4"
      />
      <path
        d={ridge([108, pick(4, 72, 96), pick(5, 58, 84), pick(6, 80, 102), pick(7, 66, 92), 96])}
        fill="#8cc4ae"
      />
    </svg>
  );
}

function Caption({ leg, progress }: { leg: DaySummary; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0.04, 0.16], [0, 1]);
  const y = useTransform(progress, [0.04, 0.16], [10, 0]);
  if (!leg.transport) return null;
  return (
    <motion.div
      style={{ opacity, y }}
      className="pointer-events-none absolute left-5 top-5 rounded-xl bg-white/90 px-3.5 py-2 shadow-sm backdrop-blur-sm"
    >
      <div className="font-display text-sm font-semibold text-navy-900">
        {leg.transport.from} → {leg.transport.to}
      </div>
      <div className="text-xs capitalize text-navy-600">by {leg.transport.mode}</div>
    </motion.div>
  );
}
