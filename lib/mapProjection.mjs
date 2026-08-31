// Equirectangular projection over the whole world. Shared by the one-off
// land-path build script (scripts/build-world-map.mjs) and the runtime map
// component, so baked paths and live markers always line up.
export const MAP_VIEWBOX = { width: 1000, height: 500 };

export function project(lat, lng) {
  const x = ((lng + 180) / 360) * MAP_VIEWBOX.width;
  const y = ((90 - lat) / 180) * MAP_VIEWBOX.height;
  return [x, y];
}
