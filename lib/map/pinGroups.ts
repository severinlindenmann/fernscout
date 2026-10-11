/**
 * Greedy screen-distance grouping for photo pins (B-2980): a point joins the
 * first group whose anchor is closer than `minDist` px, else starts one.
 * ponytail: O(n*g), anchor never moves; fine for a trip's few hundred photos.
 */
export function groupByScreen<T extends { x: number; y: number }>(points: readonly T[], minDist: number): T[][] {
  const groups: T[][] = [];
  for (const p of points) {
    const hit = groups.find((g) => Math.hypot(g[0].x - p.x, g[0].y - p.y) < minDist);
    if (hit) hit.push(p);
    else groups.push([p]);
  }
  return groups;
}
