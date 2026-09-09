/**
 * `tz-lookup` ships no declarations and no `@types/tz-lookup` exists. Its
 * whole surface is one function, so the shape is stated here rather than
 * pulling in a wider ambient `any` — see `lib/timezone.ts`, B1090.
 */
declare module "tz-lookup" {
  export default function tzLookup(lat: number, lng: number): string;
}
