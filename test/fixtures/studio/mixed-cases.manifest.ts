// Fixture manifest for `test/studio/conformance.test.ts` — one item per case
// the `capture` and `absent` proof kinds must accept or reject. Kept
// separate from `conformance.manifest.ts` so the real 36-item manifest never
// has to carry throwaway proofs just to exercise the reader.
import type { ManifestItem } from "../../studio/conformance.manifest.ts";

export const manifest: ManifestItem[] = [
  {
    id: "GOOD-CAPTURE",
    claim: "a capture proof with a real sentence and an existing screenshot is proven",
    proof: {
      kind: "capture",
      path: "test/studio/fixtures/screenshot.png",
      observed: "the delete button is now disabled while the request is in flight",
    },
  },
  {
    id: "BAD-CAPTURE-PATH-REPEATED",
    claim: "a capture whose sentence is the path itself is rejected",
    proof: {
      kind: "capture",
      path: "test/studio/fixtures/screenshot.png",
      observed: "test/studio/fixtures/screenshot.png",
    },
  },
  {
    id: "BAD-CAPTURE-CAPTURED",
    claim: 'a capture whose sentence is the word "captured" is rejected',
    proof: {
      kind: "capture",
      path: "test/studio/fixtures/screenshot.png",
      observed: "captured",
    },
  },
  {
    id: "BAD-CAPTURE-MISSING-FILE",
    claim: "a capture whose screenshot does not exist is rejected",
    proof: {
      kind: "capture",
      path: "test/studio/fixtures/does-not-exist.png",
      observed: "the delete button is now disabled while the request is in flight",
    },
  },
  {
    id: "GOOD-ABSENT",
    claim: "an absent proof whose grep truly returns nothing is proven",
    proof: {
      kind: "absent",
      grep: "window\\.confirm",
      paths: ["test/studio/fixtures/grep-clean.txt"],
    },
  },
  {
    id: "BAD-ABSENT-MATCHES",
    claim: "an absent proof whose grep returns a line fails",
    proof: {
      kind: "absent",
      grep: "window\\.confirm",
      paths: ["test/studio/fixtures/grep-dirty.txt"],
    },
  },
];
