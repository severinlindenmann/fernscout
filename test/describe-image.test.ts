import { expect, test, vi } from "vitest";

/**
 * `describeImage` itself — B1866. The model is scripted at the SDK boundary;
 * what is checked is what was *sent* (one image, a schema the answer has to
 * fit) and what survives coming back (a tag outside the vocabulary dropped,
 * alt text cut to the limit, a malformed answer thrown rather than half-kept).
 */

const { create, recordUsage } = vi.hoisted(() => ({ create: vi.fn(), recordUsage: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock("@/lib/usage", () => ({ recordUsage }));

const LOCALES = ["en", "de"] as const;
const image = { base64: "AA==", mediaType: "image/webp" as const };

function scripted(form: unknown) {
  create.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(form) }],
    usage: { input_tokens: 10, output_tokens: 10 },
  });
}

function wellFormed(over: Record<string, unknown> = {}) {
  return {
    caption: { en: "A cat on a wall", de: "Eine Katze auf einer Mauer" },
    altText: { en: "A cat sits on a stone wall.", de: "Eine Katze sitzt auf einer Mauer." },
    longDescription: { en: null, de: null },
    tags: ["animal"],
    confidence: "high",
    subject: { x: 0.2, y: 0.1, width: 0.5, height: 0.4 },
    people: 1,
    printworthiness: 4,
    ...over,
  };
}

test("one image and one JSON schema go out, with a property per locale", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed());
  await describeImage(image, undefined, LOCALES);

  const [args] = create.mock.calls.at(-1) as [
    {
      messages: { content: { type: string }[] }[];
      output_config: { format: { type: string; schema: Record<string, unknown> } };
      system: string;
    },
  ];
  const images = args.messages[0].content.filter((block) => block.type === "image");
  expect(images).toHaveLength(1);

  expect(args.output_config.format.type).toBe("json_schema");
  const schema = args.output_config.format.schema;
  // Printed so the report can carry the exact schema the API is sent.
  console.log(JSON.stringify(schema, null, 2));
  expect(schema).not.toHaveProperty("$schema");
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(
    expect.arrayContaining([
      "caption",
      "altText",
      "longDescription",
      "tags",
      "confidence",
      "subject",
      "people",
      "printworthiness",
    ]),
  );
  const properties = schema.properties as Record<string, { properties: unknown; required: string[] }>;
  for (const field of ["caption", "altText", "longDescription"]) {
    expect(Object.keys(properties[field].properties as object)).toEqual(["en", "de"]);
    expect(properties[field].required).toEqual(["en", "de"]);
  }

  expect(args.system).toMatch(/only what is visible/i);
  expect(args.system).toMatch(/never identify a person/i);
  expect(args.system).toMatch(/animal/);
});

/**
 * B1890. The two inventions the prompt already forbade — a place, a person —
 * were pinned above; reading a document out loud was not forbidden at all. A
 * photograph of a hotel Wi-Fi card came back naming the network and the
 * password field, and nothing in the prompt had made it stop.
 *
 * Pinned as text because the prompt is the only thing that enforces it: there
 * is no code guard that can tell a transcribed booking reference from a
 * description of a ticket.
 */
test("the prompt forbids transcribing what a document says", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed());
  await describeImage(image, undefined, LOCALES);
  const [args] = create.mock.calls.at(-1) as [{ system: string }];

  expect(args.system).toMatch(/never read a document out loud/i);
  // The kinds of thing a travel journal actually photographs.
  expect(args.system).toMatch(/boarding pass/i);
  expect(args.system).toMatch(/wi-fi card/i);
  // And what may never be copied out of one.
  for (const forbidden of ["password", "reference", "telephone number", "date of birth"]) {
    expect(args.system).toContain(forbidden);
  }
  // The long description is where it would happen, so it is named there too.
  expect(args.system).toMatch(/long description/i);
  // And the field's own instruction must not invite the opposite.
  expect(args.system).not.toMatch(/text worth having/i);
});

/**
 * B1959. The no-place rule named a place, a country, a landmark and a
 * business, and stopped there — so 34 of the 1,269 backfilled blocks carried a
 * regional adjective and about 13 of those were guesses at where the
 * photograph was taken ("Mediterranean coastline", "Alpine", "European").
 * The line is what the frame shows against where the describer thinks it was:
 * "Gothic" is an architectural style and stays.
 */
test("the prompt counts a region, a nationality and a climate as places", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed());
  await describeImage(image, undefined, LOCALES);
  const [args] = create.mock.calls.at(-1) as [{ system: string }];

  expect(args.system).toMatch(/a region, a nationality and a climate are places too/i);
  // And the positive half, which is what keeps "Gothic" allowed: name the
  // thing in the frame rather than the part of the world it suggests.
  expect(args.system).toMatch(/never the part of the world it suggests/i);
});

/**
 * B1962. The no-place rule already named "a business", but two descriptions
 * against the amended prompt still named a company — "Coca-Cola signage",
 * "a Swiss airline label" — because nothing said a brand or a marque was the
 * same kind of guess. Neither of those is a place, and this pins the clause
 * that says what the thing is rather than whose it is, and that the rule
 * refuses the name even where it is plainly the photograph's subject (a
 * shopfront, a logo) rather than trying to tell that apart from a can on a
 * table.
 */
test("the prompt forbids naming a business, a brand or a marque", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed());
  await describeImage(image, undefined, LOCALES);
  const [args] = create.mock.calls.at(-1) as [{ system: string }];

  expect(args.system).toMatch(/a business, a brand and a marque are not the photograph either/i);
  expect(args.system).toMatch(/name what the thing is[^.]*never whose it is/i);
  // The edge it refuses to try to resolve: a name that is plainly the
  // subject still gets no name.
  expect(args.system).toMatch(/shopfront that is plainly the subject/i);
  expect(args.system).toMatch(/refuse it there rather than guess/i);
});

/**
 * B1960. `document` and `screenshot` were the only tags for a thing with
 * printing on it, so medicine boxes and blister packs came back `document` —
 * the tag B1956 will read to mean "paper with words, do not spread two of
 * these" — and an aircraft seat pocket came back `screenshot`.
 */
test("the prompt says where the edge of document and screenshot is", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed());
  await describeImage(image, undefined, LOCALES);
  const [args] = create.mock.calls.at(-1) as [{ system: string }];

  // The gloss rides inside the list, where the choice is made.
  expect(args.system).toMatch(
    /document \(paper somebody is meant to read: [^)]*\. Never packaging, never a screen\)/i,
  );
  expect(args.system).toMatch(/packaging \(a box, a blister pack, a wrapper[^)]*\)/i);
  expect(args.system).toMatch(/screenshot \(an image of a screen\. Never a photograph of something printed\)/i);
});

/**
 * B1961, and the other half of B1890 above: the prohibition read as "say
 * nothing", and three of the four photographs the backfill failed to describe
 * at all were documents. Under B1923 an empty caption is refused, so a skipped
 * document stays pending and is re-asked and re-charged on every pass.
 */
test("the prompt says a document is described rather than skipped", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed());
  await describeImage(image, undefined, LOCALES);
  const [args] = create.mock.calls.at(-1) as [{ system: string }];

  expect(args.system).toMatch(/a document is described, never skipped/i);
  expect(args.system).toMatch(/not the photograph out of the book/i);
  // Described in the caption and the alt text — and only there. The long
  // description is where a transcription actually happens, and the measured
  // cost of inviting one was station names, times and a price.
  expect(args.system).toMatch(/return null for its long description/i);
  expect(args.system).toMatch(/never for a document/i);
  // Said beside the prohibition, not somewhere else in the prompt: the two
  // rules are a pair and a describer reading one must read the other.
  const prohibition = args.system.indexOf("NEVER READ A DOCUMENT OUT LOUD");
  const positive = args.system.search(/a document is described, never skipped/i);
  expect(prohibition).toBeGreaterThanOrEqual(0);
  expect(positive).toBeGreaterThan(prohibition);
  expect(args.system.slice(prohibition, positive)).not.toContain("\n\n");
});

test("the prompt asks for a subject box, a people count and a print score", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed({ printworthiness: 11, people: 3.9 }));
  const form = await describeImage(image, undefined, LOCALES);
  const [args] = create.mock.calls.at(-1) as [{ system: string }];
  expect(args.system).toMatch(/subject — where the thing/);
  expect(args.system).toMatch(/count, never identify/i);
  expect(form.printworthiness).toBe(5);
  expect(form.people).toBe(3);
});

test("a well-formed answer parses", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed({ longDescription: { en: "A cat. A wall. More wall.", de: null } }));
  const result = await describeImage(image, undefined, LOCALES);
  expect(result.caption.de).toBe("Eine Katze auf einer Mauer");
  expect(result.longDescription.en).toBe("A cat. A wall. More wall.");
  expect(result.longDescription.de).toBeNull();
  expect(result.confidence).toBe("high");
});

test("a tag outside the vocabulary is dropped, not written", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted(wellFormed({ tags: ["animal", "lisbon", "birthday-party"] }));
  const result = await describeImage(image, undefined, LOCALES);
  expect(result.tags).toEqual(["animal"]);
});

test("document is settled against packaging and a screen, in code", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  const { settleDocumentTag } = await import("@/lib/photos/described");

  // The two shapes measured on the owner's own photographs: a blister pack
  // that came back "document, packaging", and a phone screen "screenshot,
  // document". Neither is paper somebody is meant to read.
  scripted(wellFormed({ tags: ["document", "packaging"] }));
  expect((await describeImage(image, undefined, LOCALES)).tags).toEqual(["packaging"]);
  scripted(wellFormed({ tags: ["screenshot", "document"] }));
  expect((await describeImage(image, undefined, LOCALES)).tags).toEqual(["screenshot"]);

  // A document on its own is untouched, and so is everything else.
  expect(settleDocumentTag(["document", "detail"])).toEqual(["document", "detail"]);
  expect(settleDocumentTag(["food", "interior"])).toEqual(["food", "interior"]);
});

test("alt text past the limit is cut rather than kept whole", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  const { ALT_TEXT_LIMIT } = await import("@/lib/photos/described");
  scripted(wellFormed({ altText: { en: "x".repeat(400), de: "kurz" } }));
  const result = await describeImage(image, undefined, LOCALES);
  expect(result.altText.en).toHaveLength(ALT_TEXT_LIMIT);
  expect(result.altText.de).toBe("kurz");
});

test("a malformed answer throws rather than returning half a form", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  scripted({ caption: { en: "A cat" }, tags: [] });
  await expect(describeImage(image, undefined, LOCALES)).rejects.toThrow();
});

/**
 * B1923. A well-formed answer whose caption is empty is still not an answer,
 * and a written block is cached against the photograph's content hash
 * forever — so a photograph described as nothing would never be asked about
 * again, on a page that believes it has alt text. Refused at the boundary,
 * like a malformed answer, whatever the confidence says.
 */
test("an answer with an empty caption is refused, at high confidence or low", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  const { captionIsEmpty } = await import("@/lib/photos/described");

  scripted(wellFormed({ caption: { en: "", de: "" }, altText: { en: "", de: "" }, tags: [] }));
  await expect(describeImage(image, undefined, LOCALES)).rejects.toThrow(/nothing/);

  // The measured shape: caption gone, and the model not even unsure of it.
  scripted(wellFormed({ caption: { en: "", de: "" }, confidence: "low" }));
  await expect(describeImage(image, undefined, LOCALES)).rejects.toThrow(/nothing/);

  // A journal in two languages with a caption in one has it in neither.
  scripted(wellFormed({ caption: { en: "A cat on a wall", de: "   " } }));
  await expect(describeImage(image, undefined, LOCALES)).rejects.toThrow(/nothing/);

  // The predicate itself, which is what `scripts/describe-backfill.mts`
  // applies at its own door before writing a sidecar.
  expect(captionIsEmpty(wellFormed() as never)).toBe(false);
  expect(captionIsEmpty(wellFormed({ caption: { en: "", de: "" } }) as never)).toBe(true);
  expect(captionIsEmpty(wellFormed({ caption: { en: "ok", de: "" } }) as never)).toBe(true);
});

test("usage is booked against the operation this replaces, never a new one", async () => {
  const { describeImage } = await import("@/lib/helper/model");
  recordUsage.mockClear();
  scripted(wellFormed());
  await describeImage(image, "someone", LOCALES);
  expect(recordUsage).toHaveBeenCalledTimes(1);
  expect(recordUsage.mock.calls[0][0]).toMatchObject({
    owner: "someone",
    provider: "anthropic",
    operation: "describe_photos",
  });
});

test("parseDescribed reads a whole block back and refuses anything less", async () => {
  const { parseDescribed, DESCRIBED_SCHEMA_VERSION } = await import("@/lib/photos/described");
  const block = {
    ...wellFormed(),
    at: "2026-09-19T00:00:00Z",
    model: "claude-haiku-4-5",
    schemaVersion: DESCRIBED_SCHEMA_VERSION,
    contentHash: "abc123",
  };
  expect(parseDescribed(block, LOCALES)).toMatchObject({ contentHash: "abc123" });

  const missingHash: Record<string, unknown> = { ...block };
  delete missingHash.contentHash;
  expect(parseDescribed(missingHash, LOCALES)).toBeNull();
  expect(parseDescribed({ nonsense: true }, LOCALES)).toBeNull();
  expect(parseDescribed("a string", LOCALES)).toBeNull();
  expect(parseDescribed(null, LOCALES)).toBeNull();
  // A block written for one set of locales is not an answer for another.
  expect(parseDescribed(block, ["en", "de", "hu"])).toBeNull();
});
