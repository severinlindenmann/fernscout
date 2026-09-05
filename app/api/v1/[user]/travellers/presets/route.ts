import {
  ACCESSORIES,
  AGES,
  BUILDS,
  CLOTH,
  EYES,
  HAIR,
  HAIR_STYLES,
  MAX_FIGURES,
  SKIN,
} from "@/lib/travellers/vocabulary";
import { STARTING_POINTS } from "@/lib/travellers/presets";
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

  return Response.json({
    user,
    maxFigures: MAX_FIGURES,
    vocabulary: {
      skin: Object.keys(SKIN),
      hair: Object.keys(HAIR),
      eyes: Object.keys(EYES),
      hairStyle: HAIR_STYLES,
      build: BUILDS,
      age: AGES,
      accessories: ACCESSORIES,
      /** `shirt`, `pants`, `pack` and `headscarf` all take these. */
      cloth: Object.keys(CLOTH),
    },
    hex: 'Any colour field also takes a hex code, e.g. "#8b5630".',
    startingPoints: STARTING_POINTS.map((p) => ({ name: p.name, resolve: p.figure })),
    note:
      "A starting point is one common combination out of many, not a rule about anybody — " +
      "expect the person to correct it, and ask. Write the attributes under `resolve`, never " +
      "the name: a preset name in a trip file is a claim about somebody's background that " +
      "stops being true the moment they change the hair. Fields nobody answered are left out " +
      "rather than guessed; say which ones you left at the default.",
  });
}
