import type { Figure } from "./vocabulary";

/**
 * Starting points — twelve common combinations, offered so nobody has to mix
 * hex codes to be drawn.
 *
 * ## The one rule about these
 *
 * **A starting point resolves the moment it is chosen, and the name is thrown
 * away.** `resolvePreset("west-african")` hands back plain attributes, and
 * those are what reach `trip.md`: `skin: deep, hair: black, hairStyle: coils`.
 * The string `west-african` is never written to a file under `content/`, and
 * `test/travellers-presets.test.ts` fails if it ever is.
 *
 * Two reasons, and the second is the stronger one. A preset name in a trip
 * file is a sentence about somebody's ethnicity in a file the owner did not
 * think they were writing. And it is *false the moment they correct it* — the
 * whole point of a starting point is that the person then changes the hair,
 * at which point the label describes nobody.
 *
 * ## What they are, and what they are not
 *
 * Each is **one common combination out of many**, not a taxonomy and not a
 * rule about anybody. They are named for regions because that is what makes
 * them findable in a conversation — "shall I start from the south-asian one
 * and change the hair?" — and the skill says in as many words that correcting
 * one is the expected outcome rather than a failure.
 *
 * The list is deliberately longer than the three anybody thinks of first.
 */
export const STARTING_POINTS: ReadonlyArray<{ name: string; figure: Figure }> = [
  { name: "east-asian", figure: { skin: "light-medium", hair: "black", hairStyle: "long", eyes: "dark-brown", shirt: "coral" } },
  { name: "south-asian", figure: { skin: "medium-deep", hair: "black", hairStyle: "braids", eyes: "dark-brown", shirt: "teal" } },
  { name: "southeast-asian", figure: { skin: "medium", hair: "black", hairStyle: "bun", eyes: "dark-brown", shirt: "yellow" } },
  { name: "west-african", figure: { skin: "deep", hair: "black", hairStyle: "coils", eyes: "dark-brown", shirt: "green" } },
  { name: "east-african", figure: { skin: "rich", hair: "black", hairStyle: "buzz", eyes: "dark-brown", shirt: "sky" } },
  { name: "north-african", figure: { skin: "medium-deep", hair: "black", hairStyle: "headscarf", eyes: "brown", shirt: "plum" } },
  { name: "european", figure: { skin: "light", hair: "blond", hairStyle: "short", eyes: "blue", shirt: "blue" } },
  { name: "mediterranean", figure: { skin: "light-medium", hair: "dark-brown", hairStyle: "curly", eyes: "hazel", shirt: "rust" } },
  { name: "middle-eastern", figure: { skin: "medium", hair: "black", hairStyle: "tousled", eyes: "dark-brown", shirt: "slate" } },
  { name: "latin-american", figure: { skin: "medium", hair: "dark-brown", hairStyle: "ponytail", eyes: "brown", shirt: "coral" } },
  { name: "pacific", figure: { skin: "medium-deep", hair: "black", hairStyle: "long", eyes: "dark-brown", shirt: "teal" } },
  { name: "indigenous-american", figure: { skin: "medium", hair: "black", hairStyle: "braids", eyes: "dark-brown", shirt: "sand" } },
];

export const PRESET_NAMES: ReadonlyArray<string> = STARTING_POINTS.map((p) => p.name);

/**
 * A starting point as plain attributes, or `null` if there is no such name.
 *
 * The returned object is a fresh copy: a caller that adjusts the hair must not
 * be editing the shared table for every later caller.
 */
export function resolvePreset(name: string): Figure | null {
  const found = STARTING_POINTS.find((p) => p.name === name);
  return found ? { ...found.figure } : null;
}
