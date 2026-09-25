/**
 * SVG path data → move/line/cubic/close, in absolute coordinates.
 *
 * The site draws travellers as SVG `d` strings. The printed book draws the
 * same travellers as PDF content-stream operators, and PDF has **no arc and
 * no quadratic** — only `m`, `l`, `c` and `h`. Before B497 the book got round
 * that by carrying a second, hand-converted copy of the path data, which is
 * how it ended up printing one particular couple in trousers on the title page
 * of everybody's journey.
 *
 * So this converts once, here, and both spellings come from one geometry.
 *
 * Everything is reduced to four segment kinds. Quadratics become cubics
 * exactly (the two controls sit two-thirds of the way to the shared control
 * point); arcs become up to four cubics by the decomposition in the SVG
 * implementation notes, which is accurate to well under a printer's dot.
 */

export type Segment =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Z" };

/**
 * Tokenise `d`.
 *
 * The awkward part is that **arc flags may be packed against the number after
 * them**: `a4.6 4.6 0 109.2 0` is `large-arc=1, sweep=0, x=9.2`, not a number
 * `109.2`. A flag is a single character, so the arc case reads its two flags
 * one character at a time and lets everything else fall to the number scanner.
 * A generic tokeniser gets this wrong and bends the hair into a shape nobody
 * notices until it is printed.
 */
function tokenise(d: string): Array<{ cmd: string; args: number[] }> {
  const out: Array<{ cmd: string; args: number[] }> = [];
  const argCount: Record<string, number> = {
    M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
  };
  let i = 0;

  const skip = () => {
    while (i < d.length && (d[i] === " " || d[i] === "," || d[i] === "\n" || d[i] === "\t")) i++;
  };
  const number = (): number => {
    skip();
    const start = i;
    if (d[i] === "+" || d[i] === "-") i++;
    while (i < d.length && d[i] >= "0" && d[i] <= "9") i++;
    if (d[i] === ".") {
      i++;
      while (i < d.length && d[i] >= "0" && d[i] <= "9") i++;
    }
    if (d[i] === "e" || d[i] === "E") {
      i++;
      if (d[i] === "+" || d[i] === "-") i++;
      while (i < d.length && d[i] >= "0" && d[i] <= "9") i++;
    }
    return Number.parseFloat(d.slice(start, i));
  };
  const flag = (): number => {
    skip();
    const c = d[i];
    i++;
    return c === "1" ? 1 : 0;
  };

  let previous = "";
  while (i < d.length) {
    skip();
    if (i >= d.length) break;
    let cmd = d[i];
    if (/[a-zA-Z]/.test(cmd)) {
      i++;
    } else {
      // A repeated command: another set of arguments with no letter. `M`
      // repeats as `L`, which is what "M20.4 23.4 16.8 22.2" means.
      cmd = previous === "M" ? "L" : previous === "m" ? "l" : previous;
      if (!cmd) break;
    }
    previous = cmd;
    const upper = cmd.toUpperCase();
    const n = argCount[upper];
    if (n === undefined) break;

    const args: number[] = [];
    if (upper === "A") {
      args.push(number(), number(), number(), flag(), flag(), number(), number());
    } else {
      for (let k = 0; k < n; k++) args.push(number());
    }
    out.push({ cmd, args });
  }
  return out;
}

/**
 * One elliptical arc as cubic beziers.
 *
 * Endpoint parameterisation in, centre parameterisation out, then one cubic
 * per quadrant or less. Straight from the SVG implementation notes (F.6);
 * the out-of-range-radii correction matters because a scaled figure can ask
 * for an arc its radii cannot reach.
 */
function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotation: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): Segment[] {
  if (rx === 0 || ry === 0) return [{ op: "L", x: x2, y: y2 }];
  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Radii too small to span the chord are scaled up until they just fit.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));

  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let sweepAngle = angleOf(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (sweep === 0 && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep === 1 && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  // One cubic per quadrant at most: the error of a bezier approximation grows
  // quickly past 90°, and quarters are what every reference implementation
  // settles on.
  const count = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
  const delta = sweepAngle / count;
  const t = (4 / 3) * Math.tan(delta / 4);

  const out: Segment[] = [];
  let angle = theta;
  for (let k = 0; k < count; k++) {
    const next = angle + delta;
    const cos1 = Math.cos(angle);
    const sin1 = Math.sin(angle);
    const cos2 = Math.cos(next);
    const sin2 = Math.sin(next);

    const p1x = cosPhi * rx * cos1 - sinPhi * ry * sin1 + cx;
    const p1y = sinPhi * rx * cos1 + cosPhi * ry * sin1 + cy;
    const p2x = cosPhi * rx * cos2 - sinPhi * ry * sin2 + cx;
    const p2y = sinPhi * rx * cos2 + cosPhi * ry * sin2 + cy;

    const d1x = cosPhi * -rx * sin1 - sinPhi * ry * cos1;
    const d1y = sinPhi * -rx * sin1 + cosPhi * ry * cos1;
    const d2x = cosPhi * -rx * sin2 - sinPhi * ry * cos2;
    const d2y = sinPhi * -rx * sin2 + cosPhi * ry * cos2;

    out.push({
      op: "C",
      x1: p1x + t * d1x,
      y1: p1y + t * d1y,
      x2: p2x - t * d2x,
      y2: p2y - t * d2y,
      x: p2x,
      y: p2y,
    });
    angle = next;
  }
  return out;
}

/** Parse SVG path data into absolute move/line/cubic/close segments. */
export function parsePath(d: string): Segment[] {
  const out: Segment[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The reflected control point that `S` and `T` need.
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;

  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
    out.push({ op: "C", x1, y1, x2, y2, x: ex, y: ey });
    lastCubic = [x2, y2];
    lastQuad = null;
    x = ex;
    y = ey;
  };
  /** A quadratic is a cubic whose controls sit two-thirds of the way to the
   *  shared control point. Exact, not an approximation. */
  const quad = (qx: number, qy: number, ex: number, ey: number) => {
    const x1 = x + (2 / 3) * (qx - x);
    const y1 = y + (2 / 3) * (qy - y);
    const x2 = ex + (2 / 3) * (qx - ex);
    const y2 = ey + (2 / 3) * (qy - ey);
    out.push({ op: "C", x1, y1, x2, y2, x: ex, y: ey });
    lastQuad = [qx, qy];
    lastCubic = null;
    x = ex;
    y = ey;
  };

  for (const { cmd, args } of tokenise(d)) {
    const rel = cmd === cmd.toLowerCase() && cmd !== "Z";
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;

    switch (cmd.toUpperCase()) {
      case "M":
        x = args[0] + ox;
        y = args[1] + oy;
        startX = x;
        startY = y;
        out.push({ op: "M", x, y });
        lastCubic = lastQuad = null;
        break;
      case "L":
        x = args[0] + ox;
        y = args[1] + oy;
        out.push({ op: "L", x, y });
        lastCubic = lastQuad = null;
        break;
      case "H":
        x = args[0] + ox;
        out.push({ op: "L", x, y });
        lastCubic = lastQuad = null;
        break;
      case "V":
        y = args[0] + oy;
        out.push({ op: "L", x, y });
        lastCubic = lastQuad = null;
        break;
      case "C":
        cubic(args[0] + ox, args[1] + oy, args[2] + ox, args[3] + oy, args[4] + ox, args[5] + oy);
        break;
      case "S": {
        const [rx, ry] = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
        cubic(rx, ry, args[0] + ox, args[1] + oy, args[2] + ox, args[3] + oy);
        break;
      }
      case "Q":
        quad(args[0] + ox, args[1] + oy, args[2] + ox, args[3] + oy);
        break;
      case "T": {
        const [rx, ry] = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
        quad(rx, ry, args[0] + ox, args[1] + oy);
        break;
      }
      case "A": {
        const ex = args[5] + ox;
        const ey = args[6] + oy;
        out.push(...arcToCubics(x, y, args[0], args[1], args[2], args[3], args[4], ex, ey));
        x = ex;
        y = ey;
        lastCubic = lastQuad = null;
        break;
      }
      case "Z":
        out.push({ op: "Z" });
        x = startX;
        y = startY;
        lastCubic = lastQuad = null;
        break;
    }
  }
  return out;
}
