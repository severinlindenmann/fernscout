import type { DayWeather as Reading } from "@/lib/weather";
import { SOURCE_CREDIT, weatherGroup, type WeatherGroup } from "@/lib/weather";

/**
 * What the weather actually was, in the day's own furniture — B325.
 *
 * Three rules this component exists to keep, and each of them is a line in
 * the ticket rather than a taste:
 *
 * **It is never inside the prose.** It renders in `DayCard`'s meta line,
 * beside the date and the flag, so a reader can see at a glance that the site
 * is speaking and not the author. That placement is the visible half of the
 * labelling the whole feature rests on.
 *
 * **It always says where it came from.** The `title` carries the source and
 * the instant, and the source is also written out beside the reading. A
 * number in somebody's journal with no provenance is a number their family
 * will eventually take for something they wrote.
 *
 * **It ships no JavaScript.** The animation is CSS keyframes on inline SVG —
 * see `app/globals.css` — because a trip page draws forty of these at once
 * and because `prefers-reduced-motion` is then a media query rather than a
 * hook. There is no state here, no effect, and nothing to hydrate.
 */

/** Cream on navy is not the palette here: these sit on white, inside a meta
 * line, at 12px. Colours are the brand's, resolved through the theme. */
const SUN = "var(--color-yellow-400)";
const CLOUD = "var(--color-navy-200)";
const CLOUD_DARK = "var(--color-navy-500)";
const RAIN = "var(--color-sky-500)";
const SNOW = "var(--color-sky-300)";
const BOLT = "var(--color-coral-400)";

/**
 * One glyph per group, 24×24, drawn rather than pulled from an icon set.
 *
 * lucide has weather icons and they are already a dependency, but a lucide
 * icon is a single-stroke path with no parts to move independently — and the
 * whole request was for something that animates. A cloud that drifts while
 * its rain falls needs the cloud and the rain to be separate elements, which
 * is a drawing, not an icon.
 */
function Glyph({ group }: { group: WeatherGroup }) {
  const cloud = (fill: string) => (
    <path
      className="fs-weather-drift"
      d="M7.5 17h9a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.6 9.2 3.9 3.9 0 0 0 7.5 17Z"
      fill={fill}
    />
  );

  switch (group) {
    case "clear":
      return (
        <>
          <g className="fs-weather-spin" style={{ transformOrigin: "12px 12px" }}>
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
              <line
                key={deg}
                x1="12"
                y1="2.5"
                x2="12"
                y2="5"
                stroke={SUN}
                strokeWidth="1.8"
                strokeLinecap="round"
                transform={`rotate(${deg} 12 12)`}
              />
            ))}
          </g>
          <circle cx="12" cy="12" r="4.6" fill={SUN} />
        </>
      );
    case "partly":
      return (
        <>
          <circle className="fs-weather-pulse" cx="9" cy="8.5" r="4" fill={SUN} />
          {cloud(CLOUD)}
        </>
      );
    case "cloudy":
      return (
        <>
          <path
            className="fs-weather-drift-slow"
            d="M5 13h7a2.8 2.8 0 0 0 .2-5.6A4 4 0 0 0 5.1 6.7 3.1 3.1 0 0 0 5 13Z"
            fill={CLOUD}
          />
          {cloud(CLOUD_DARK)}
        </>
      );
    case "fog":
      return (
        <>
          {cloud(CLOUD)}
          {[19, 21.5].map((y, i) => (
            <line
              key={y}
              className={i === 0 ? "fs-weather-drift" : "fs-weather-drift-slow"}
              x1="4.5"
              y1={y}
              x2="19.5"
              y2={y}
              stroke={CLOUD_DARK}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ))}
        </>
      );
    case "rain":
      return (
        <>
          {cloud(CLOUD_DARK)}
          {[8, 12, 16].map((x, i) => (
            <line
              key={x}
              className="fs-weather-fall"
              style={{ animationDelay: `${i * 0.28}s` }}
              x1={x}
              y1="19"
              x2={x - 1}
              y2="22"
              stroke={RAIN}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ))}
        </>
      );
    case "snow":
      return (
        <>
          {cloud(CLOUD_DARK)}
          {[8, 12, 16].map((x, i) => (
            <circle
              key={x}
              className="fs-weather-fall"
              style={{ animationDelay: `${i * 0.4}s` }}
              cx={x}
              cy="20"
              r="1.3"
              fill={SNOW}
            />
          ))}
        </>
      );
    case "thunder":
      return (
        <>
          {cloud(CLOUD_DARK)}
          <path
            className="fs-weather-flash"
            d="M13 18h-3l1.4 5 4.6-6h-3l1-4Z"
            fill={BOLT}
          />
        </>
      );
  }
}

/**
 * `12 – 19°C`, or whichever half of it there is.
 *
 * The minus is U+2212 and not a hyphen. It matters here more than it usually
 * does: the range separator is an en dash, so a cold day rendered with hyphens
 * reads `-4° – -2°C` — three near-identical dashes doing two different jobs,
 * at 12px.
 */
function temperature(reading: Reading): string | undefined {
  const { tempMin, tempMax } = reading;
  const deg = (n: number) => `${String(Math.round(n)).replace("-", "−")}°`;
  if (tempMin !== undefined && tempMax !== undefined) {
    return tempMin === tempMax ? `${deg(tempMax)}C` : `${deg(tempMin)} – ${deg(tempMax)}C`;
  }
  const one = tempMax ?? tempMin;
  return one === undefined ? undefined : `${deg(one)}C`;
}

export default function DayWeather({
  weather,
  labels,
}: {
  /** Absent for a day that never asked, a day without coordinates, and every
   * day in a journal with the capability off — in each case this renders
   * nothing at all, and reserves no space for itself. */
  weather?: Reading;
  /** Translated, because this component is used inside a client tree that
   * already has the dictionary and a second one here would be a second thing
   * to keep in step. `group` is looked up by the caller for the same reason. */
  labels: { description: string; via: string };
}) {
  if (!weather) return null;
  const credit = SOURCE_CREDIT[weather.source];

  const group = weatherGroup(weather.code);
  const temp = temperature(weather);
  const rain = weather.precipitation;

  // A reading with a code we cannot draw and no numbers to print would be an
  // empty element with a tooltip. Nothing is better.
  if (!group && temp === undefined && !rain) return null;

  // The credit is a link for an archive and plain text for a person's own
  // reading — CC BY is a licence condition rather than a courtesy, and the
  // difference is also what tells a reader which kind of reading this is.
  const Wrapper = credit ? "a" : "span";
  const linkProps = credit
    ? { href: credit.href, target: "_blank", rel: "noreferrer nofollow" }
    : {};

  return (
    <Wrapper
      className={`inline-flex items-center gap-1${credit ? " hover:text-navy-900" : ""}`}
      title={labels.via}
      {...linkProps}
    >
      {group && (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden
          className="shrink-0 overflow-visible"
        >
          <Glyph group={group} />
        </svg>
      )}
      <span className="sr-only">{labels.description}</span>
      <span aria-hidden className="tabular-nums">
        {temp}
        {temp !== undefined && rain ? " · " : ""}
        {rain ? `${rain} mm` : ""}
      </span>
    </Wrapper>
  );
}
