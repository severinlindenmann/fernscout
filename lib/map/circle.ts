/**
 * A rough circle polygon in degrees, for drawing a hidden spot's or a
 * private place's radius on a map — good enough at zone scale (tens of
 * metres to a few km) where the meridian/parallel distortion this ignores is
 * well under a pixel. Shared by `GpsZones.tsx` (private places) and
 * `DayLineMap.tsx` (a day's own hidden-spot picker, B2563 T3) so the two
 * never draw the same shape two different ways.
 * ponytail: equirectangular approximation, not a geodesic circle; revisit if
 * a radius ever grows toward `ZONE_LIMITS.maxRadiusM` at high latitude.
 */
export function circlePolygon(lat: number, lon: number, radiusM: number, steps = 48): GeoJSON.Feature {
  const latDeg = radiusM / 111_320;
  const lonDeg = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    coords.push([lon + lonDeg * Math.cos(angle), lat + latDeg * Math.sin(angle)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}
