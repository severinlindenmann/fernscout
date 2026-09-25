// Fixture manifest exercising the `test` proof kind against
// `test/studio/fixtures/sample.test.ts`, which carries exactly one known
// passing test. Kept out of `conformance.manifest.ts` for the same reason as
// `mixed-cases.manifest.ts`: real proofs only belong in the real manifest.
import type { ManifestItem } from "../../studio/conformance.manifest.ts";

export const manifest: ManifestItem[] = [
  {
    id: "GOOD-TEST",
    claim: "a test proof naming a test that exists and passed is proven",
    proof: { kind: "test", name: "studio-check fixture > this one passes", file: "test/studio/fixtures/sample.test.ts" },
  },
  {
    id: "BAD-TEST-MISSING",
    claim: "a test proof naming a test that does not exist fails",
    proof: { kind: "test", name: "studio-check fixture > this test was never written", file: "test/studio/fixtures/sample.test.ts" },
  },
];
