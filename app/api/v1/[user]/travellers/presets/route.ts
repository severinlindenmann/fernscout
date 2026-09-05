import {
  ACCESSORIES,
  AGES,
  BUILDS,
  CLOTH,
  EYES,
  HAIR,
  HAIR_STYLES,
  MAX_FIGURES,
  OUTFITS,
  SKIN,
} from "@/lib/travellers/vocabulary";
import { STARTING_POINTS } from "@/lib/travellers/presets";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/<user>/travellers/presets` — every word a figure may be
 * described in, and twelve places to start from.
 *
 * This exists so an agent **offers what exists instead of inventing a hex
 * code**. Asked "how would you like to be drawn?", somebody answers in
 * ordinary words; the agent needs to know that `coils` and `braids` are both
 * real and that `afro` is not, without guessing.
 *
 * Open to anyone who can see the journal: it is a vocabulary, not anybody's
 * data. There is nothing here about a particular person.
 *
 * ## The starting points, and the thing to say about them
 *
 * Each is **one common combination out of many**, not a taxonomy and not a
 * rule about anybody. They are named for regions only because that is what
 * makes them findable in a conversation.
 *
 * The response says so in `note`, and it says the other half too: a starting
 * point is `resolve`d into plain attributes at the moment somebody picks it,
 * and **the name is never written to a file**. What lands in `trip.md` is
 * `skin: deep, hair: black`; what never lands there is `preset: west-african`,
 * which would be a sentence about somebody's ethnicity in a file the owner did
 * not think they were writing — and false anyway the moment they change the
 * hair. `POST …/trips` refuses a `preset` key by name for the same reason.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/v1/[user]/travellers/presets">,
) {
  const { user } = await params;
  if (!getUser(user)) {
    return Response.json(
      { error: "no_such_journal", message: `No journal called "${user}".` },
      { status: 404 },
    );
  }

  const base = serverSite().url;

  return Response.json({
    user,
    maxFigures: MAX_FIGURES,
    vocabulary: {
      skin: Object.keys(SKIN),
      hair: Object.keys(HAIR),
      eyes: Object.keys(EYES),
      hairStyle: HAIR_STYLES,
      outfit: OUTFITS,
      build: BUILDS,
      age: AGES,
      accessories: ACCESSORIES,
      /** `shirt`, `pants`, `pack` and `headscarf` all take these. */
      cloth: Object.keys(CLOTH),
    },
    /**
     * What each field is *for*. The value lists above answer "what may I
     * say"; without this the response never answers "what am I building", and
     * an agent that has read the whole thing still has to guess at the shape
     * of the object it is meant to send.
     */
    fields: {
      for: "Optional. An address in the trip's people: block, tying this figure to a name. It grants nothing — nothing in this block can change who may write to the trip.",
      skin: "A tone. Ordinal, from light to rich; it says how light or deep, and nothing about where anybody is from.",
      hair: "Hair colour. grey and white are colours like any other — nothing greys on its own with age.",
      hairStyle: "How the hair is worn. headscarf lives here rather than under accessories because it replaces the hair rather than resting on it.",
      eyes: "Eye colour. Two pixels wide at hero size, so it reads in the preview and the photobook and nowhere else — do not spend a question on it.",
      shirt: "The top. Also the colour of a dress or a robe, which are the top.",
      pants: "The lower garment: trousers, shorts or a skirt. Ignored for a dress or a robe.",
      outfit: "What they wear below the shoulders. Whatever covers the torso takes shirt (dress, robe); a separate lower garment takes pants (trousers, shorts, skirt). Absent is trousers.",
      pack: 'Backpack colour, or "none" for no pack at all.',
      headscarf: "The colour of a headscarf. Ignored for every other hairStyle; absent uses the shirt colour, so it reads as fabric rather than as hair.",
      build: "The silhouette.",
      age: "A height multiplier and nothing else. Children and teenagers are also drawn in the front rank, so they are not hidden behind an adult.",
      accessories: "A list. Drawn last, over everything else.",
    },
    /** The shape to send. Every field is optional; absent means the default. */
    example: {
      for: "ana@example.test",
      skin: "medium-deep",
      hair: "black",
      hairStyle: "braids",
      shirt: "coral",
      outfit: "skirt",
      pants: "plum",
      accessories: ["glasses"],
    },
    hex: 'Any colour field also takes a hex code, e.g. "#8b5630".',
    preview: `${base}/api/v1/${user}/travellers/preview?figure={…} draws one, ?party=[{…},{…}] draws the group as the hero will arrange it. Show somebody their figure before writing it down — a person cannot confirm a description they cannot see.`,
    startingPoints: STARTING_POINTS.map((p) => ({ name: p.name, resolve: p.figure })),
    note:
      "A starting point is one common combination out of many, not a rule about anybody — " +
      "expect the person to correct it, and ask. Write the attributes under `resolve`, never " +
      "the name: a preset name in a trip file is a claim about somebody's background that " +
      "stops being true the moment they change the hair. Fields nobody answered are left out " +
      "rather than guessed; say which ones you left at the default.",
  });
}
