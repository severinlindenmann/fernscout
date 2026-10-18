import { z } from "zod";

/**
 * `/api/v2/me/person` — B-3007: the person across the instance, their
 * address and number paired, and the one postal address every journal they
 * gave it to reads.
 */
const field = z.string().max(120).describe("trimmed; longer is cut at 120 characters");

const personAddress = z.strictObject({
  name: field.describe("who the envelope is addressed to"),
  line1: field,
  line2: field,
  postcode: field,
  city: field,
  country: field,
});

export const personDoc = z.strictObject({
  email: z.string().nullable().describe("the person's address, or null when they have only a number"),
  phone: z.string().nullable().describe("the proved number as +<digits>, or null"),
  address: personAddress.nullable().describe("the saved postal address, or null"),
  addresses: z.boolean().describe("whether this server can keep a postal address at all (an encryption key is set)"),
  signedInBy: z
    .enum(["email", "phone"])
    .describe("how this browser signed in; changing the number (B-3010) needs a sign-in by email"),
});

export const personPut = z.strictObject({
  address: personAddress
    .partial()
    .describe(
      "a street (line1), city and country are required; it replaces the address in every journal holding the " +
        "person's own. Every field empty forgets the saved address and changes no journal.",
    ),
});

export const personSaved = z.strictObject({
  ok: z.literal(true),
  journals: z.number().int().min(0).describe("how many journals now carry this address"),
});
