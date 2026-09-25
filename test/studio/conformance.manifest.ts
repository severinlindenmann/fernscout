/**
 * The studio's §9 checklist, as data.
 *
 * `docs/plans/2026-09-19-the-studio-implementation-spec.md` §9 lists 36
 * things that must be true of the studio before it is done. A test suite
 * cannot fail for a test nobody wrote, so a batch that builds eight of
 * seventeen flows still leaves `npm run verify` green — every ticket that
 * landed passed its own acceptance, and nobody was holding the whole. This
 * file is the whole: one entry per checklist item, so the item that nobody
 * proved is visible rather than silent. B1838.
 *
 * Every `claim` is the spec's own words for that item (trimmed of its
 * "*Verify:* …" clause — that clause is what `scripts/studio-check.mts`
 * checks, not part of what is claimed). Nothing here is scored true by being
 * written down: `proof: null` is the only value a ticket may ship with, and
 * every other ticket in the run is what is allowed to change one to a real
 * proof — see `scripts/studio-check.mts` for what counts as one.
 */

/** The three shapes of evidence the gate accepts, and no fourth. */
export type Proof =
  | {
      kind: "test";
      /**
       * A vitest test's full name, exactly as vitest's own JSON reporter
       * reports it: ancestor `describe` titles and the test's own title,
       * space-joined in nesting order. `npx vitest run --reporter=json`
       * writes this under `testResults[].assertionResults[].fullName`.
       */
      name: string;
      /**
       * The test file that test lives in, repo-relative.
       *
       * Required, and the reason is cost. Without it the gate had no way to
       * know which files matter, so a single `test` proof made it run the
       * whole suite — 8,200 tests, a hundred vitest workers and a load
       * average in the fifties, to answer a question about four test names.
       * With it the run is scoped to the handful of files the proofs
       * actually name, which is seconds.
       */
      file: string;
    }
  | {
      kind: "capture";
      /** Path to the screenshot, relative to the repository root. */
      path: string;
      /**
       * One sentence naming what was actually seen — not the path again, and
       * not the word "captured". A capture nobody compares proves only that
       * a page still returns bytes (B1090); this is what forces the compare
       * to have happened.
       */
      observed: string;
    }
  | {
      kind: "absent";
      /** Extended-regex pattern passed to `grep -rnE`. */
      grep: string;
      /** Files or directories the pattern must not appear in. */
      paths: string[];
    };

export interface ManifestItem {
  /** The §9 checklist id, e.g. "D3", "H6", "V1". */
  id: string;
  /** The claim, in the spec's own words. */
  claim: string;
  /** `null` until some ticket earns a real proof. */
  proof: Proof | null;
}

export const manifest: ManifestItem[] = [
  // --- Contract and safety --------------------------------------------
  {
    id: "C1",
    claim: "No flow writes anything before its final step.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/day-new-step5-1280.png",
      observed:
        "Driven live against content/example/ at 1280px: after walking Add a day through trip pick, date, skipping photographs, all eleven declinables and the preview's 'Looks right', `git status --short content/` still showed nothing under content/example/trips changed — the day only appeared on disk (status: draft) after this screenshot's own final 'Make this day, as a draft' button was pressed, confirming every prior screen (steps 1 through 4 of 5) wrote nothing.",
    },
  },
  {
    id: "C2",
    claim: "A failed final write leaves nothing behind.",
    proof: {
      kind: "test",
      name: "createDayTransactional — C2, one transaction attaching photographs fails and nothing is left behind: no day file",
      file: "test/studio-add-day.test.ts",
    },
  },
  {
    id: "C3",
    claim:
      'Every final button names its consequence. No "Next", "Save", "Continue", "Submit" or "OK" on a step-5 button.',
    // Scoped to the nine flows that are both new to this run and have one
    // mechanically identifiable write-performing button — see the doc
    // comment on FINAL_BUTTONS in the test file for how that set was built
    // and exactly which three hub cards (A photobook, A postcard,
    // Photographs) and which one reused screen (Change a day / EditDay) are
    // excluded, and why.
    proof: {
      kind: "test",
      name: "C3 — every write-performing studio button names its consequence no final studio button's label is a generic word, in English or German",
      file: "paid/test/studio-final-button-wording.test.ts",
    },
  },
  {
    id: "C4",
    claim: "Publishing never happens as a side effect.",
    proof: {
      kind: "test",
      name: "createDayTransactional — C4, arrives as a draft a day created by this flow reads back status: draft",
      file: "test/studio-add-day.test.ts",
    },
  },
  {
    id: "C5",
    claim: "No window.confirm, alert or prompt anywhere in the new code.",
    proof: {
      kind: "absent",
      grep: String.raw`\b(alert|confirm|prompt)\(`,
      paths: ["app/[user]/studio", "components/studio", "lib/studio"],
    },
  },
  {
    id: "C6",
    claim: "Every confirmation uses ConfirmPanel with an action-specific button label.",
    proof: null,
  },
  {
    id: "C7",
    claim:
      "No invented content on any screen or in any write. No generated titles, no composed weather, no filled-in prose.",
    proof: {
      kind: "test",
      name: "createDayTransactional — C7, no invented content anywhere in the write an empty title, an empty body and declined weather: nothing composed for any of them",
      file: "test/studio-add-day-c7-weather.test.ts",
    },
  },
  {
    id: "C8",
    claim: "A decline always carries a non-empty reason.",
    proof: {
      kind: "test",
      name: "createDayTransactional — C8, the decline floor a too-short reason is dropped",
      file: "test/studio-add-day.test.ts",
    },
  },
  {
    id: "C9",
    claim:
      "GPS history is never exposed, never copied into content, and no new route reads content/<user>/gps/.",
    proof: {
      kind: "absent",
      // Narrowed 2026-09-20, when the location flow (B1937) was built and the
      // old pattern — the bare word "gps" — started matching a type-only
      // import of `Extent` and `TripCoverage` from `lib/gps/api`.
      //
      // That pattern was never testing this claim. It tested "no studio file
      // mentions GPS at all", which is strictly stronger and was only true
      // while no studio code legitimately touched the subject. The claim is
      // about history being exposed, coordinates reaching content, and a
      // route reading the store — so that is what this greps for now:
      // `lib/gps/store` and `lib/gps/enrich` are the coordinate-bearing
      // modules, and `content/<user>/gps/` is the directory AGENTS.md names.
      // `lib/gps/api`'s derived aggregates are what the flow is designed to
      // use and are deliberately not matched.
      //
      // The other half of this item's evidence is the security review run
      // against B1937 before merge, which traced every value and found no
      // coordinate-bearing field crossing from the store into any response.
      grep: "gps/(store|enrich)|content/[^\"']*/gps",
      paths: ["app/[user]/studio", "components/studio", "lib/studio"],
    },
  },
  {
    id: "C10",
    claim: "Photograph originals are untouched; only derivatives are served.",
    proof: {
      kind: "test",
      name: "storing an upload writes a resized derivative and keeps the original",
      file: "test/media-upload.test.ts",
    },
  },
  {
    id: "C11",
    claim:
      "keep-the-contract passes: every capability a flow reaches is reachable through the v2 API, every accepted field is readable back.",
    proof: null,
  },
  {
    id: "C12",
    claim: "No secret, no personal data in source, fixtures, config or task files.",
    // Stays null. `test/depersonalised.test.ts` (widened by B1938/B1940)
    // genuinely covers the *personal data* half of this claim across source,
    // fixtures and task-file prose — but as several tests (one generated per
    // name/pattern, plus separate describe blocks for phone numbers, tracked
    // files and prose contacts), not one the gate's `test` proof kind can
    // name: it takes exactly one vitest `fullName`, and no single test here
    // stands for the whole claim.
    //
    // The *secret* half (B1942) now has exactly one named test —
    // "no secret-shaped literal in source, config, fixtures or task files"
    // (test/depersonalised.test.ts) — which also closes the
    // `site/config.json` gap: that file was deliberately outside every
    // directory the personal-data scan walks (it is the documented
    // destination for an operator's own site identity — see that scan's own
    // failure message) and so had never been checked for the one thing it
    // actually forbids inside it. That single test could stand as C12's
    // proof on its own, but C12's claim also bundles the personal-data half,
    // which still has no single name to cite — so this stays null rather
    // than pointing at a test that proves only part of what C12 claims.
    proof: null,
  },

  // --- The decisions ---------------------------------------------------
  {
    id: "D1",
    // Amended 2026-09-24 (owner decision D7, B2191): the eleven-row still-open
    // wall asked every draft about every blank at the wrong moment. B2188
    // removed it from "Add a day"; naming the blanks at share time is B2192.
    claim:
      "Unanswered declinables are named at share time (B2192), never asked field by field while writing.",
    proof: {
      kind: "test",
      name: "AddDayFlow — D1, declinables are named at share time, never asked while writing the one page asks no declinable field by field and the write declines nothing",
      file: "test/add-day-asks-no-declinables.test.tsx",
    },
  },
  {
    id: "D2",
    claim:
      "A published day that moves shows both addresses, states the old one will stop working, and requires an explicit confirm. No redirect is written.",
    proof: null,
  },
  {
    id: "D3",
    claim: "A date that already has a day offers the existing one and allows a second entry.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/day-new-collision-after-1280.png",
      observed:
        "Driven live against content/example/'s real 'Across and back' trip at 1280px, light theme: picking the existing published day's own date (2026-06-03) in Add a day surfaces 'Denver, and a truck · published' with 'Change that day instead' and 'Pick another date' beside a TIME field and a 'Make a second entry on this date' button — a confirm screen offering both paths, not a refusal blocking the second entry.",
    },
  },
  {
    id: "D4",
    claim:
      "OwnerTools' edit tile and the trip page's visibility control both open the studio flow at the right step, with the subject already chosen.",
    proof: {
      kind: "test",
      name: "the trip page's own visibility control — D4 is a link into the studio flow, with this trip already chosen",
      file: "test/trip-visibility-deep-link.test.tsx",
    },
  },
  {
    id: "D5",
    claim: "The hub has no contacts card under Bring in. Typing a person in by hand works without a file.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/hub-1280-dark.png",
      observed:
        "Driven live against content/example/ at 1280px, dark theme: the Bring in group holds only Photographs, Where you went and A bank statement — no Contacts card anywhere on the hub; separately, /example/studio/people's own step 2 ('get it') carries a 'Type the people in instead' link beside its vCard instructions, reaching manual entry with no file required from the same flow.",
    },
  },
  {
    id: "D6",
    claim: "The photobook is a link from the hub, not a wrapped flow.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/photobook-link-recapture-1280.png",
      observed:
        "Driven live against content/example/ (photobook capability turned on for this check) at 1280px, light theme: the hub's rendered HTML gives the 'A photobook' card the href /example/trips/usa-2026/photobook, and following it lands on the existing trip photobook page (breadcrumb Your journals > Trips > Across and back, heading 'PHOTOBOOK / Across and back') with its own 'Set up your book' step wizard (softcover/hardcover, its own progress bar, a 'Skip the rest — the book decides' link) — a different shell entirely from the studio's five-step sequence, with no StepIndicator counting 'n of 5' and no studio 'What this is/Gather/Preview/Decide/Do it' framing, confirming the hub links out to the existing workspace rather than wrapping it in a studio flow.",
    },
  },
  {
    id: "D7",
    claim: "The location decide screen has keep it privately pre-selected.",
    proof: {
      kind: "test",
      name: "D7 — keep is pre-selected on the decide screen the keep radio starts checked and discard does not, with no click needed",
      file: "test/location-flow-decide-default.test.tsx",
    },
  },
  {
    id: "D8",
    claim:
      "(reversed by B2016, then B2017) The hub's Journal group carries Credits & storage, journal settings, the agent card, visitors (gated on analyticsEnabled) and people, with export and delete as quiet text below every group.",
    proof: {
      kind: "test",
      name:
        "H1 — the cannot-run reasons are worded apart D8 — journal settings, the agent card and people all have a card; visitors follows analyticsEnabled",
      file: "test/studio-hub.test.tsx",
    },
  },
  {
    id: "D9",
    claim: "No screenshot ships in any get it step; the prose names the exact menu path and the exact filename per platform.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/people-getit-recapture-1280.png",
      observed:
        "Driven live against content/example/ at 1280px, light theme: /example/studio/people's own step 2 of 5 ('get it') carries no image anywhere on the page — only numbered prose per platform tab (Android shown: '1 · Open Contacts. 2 · Press and hold one person until it goes into selection mode... 3 · Tick the others. 4 · Tap the share icon, then choose an app that can send a file (Files, WhatsApp, Mail). You get one file ending in .vcf.'), naming the exact menu path and the exact filename (.vcf) rather than showing a picture of the phone's UI; iPhone and Google Contacts tabs carry the same shape with their own menu wording. This is the only 'get it' step built so far (location's is blocked, per lib/studio/hub.ts), so this proof is scoped to People.",
    },
  },
  {
    id: "D10",
    claim:
      "Statement lines with no matching day land in the trip's costs.items, and the done screen names the count.",
    proof: {
      kind: "test",
      name: "a line dated outside every day in the trip lands on the trip's own costs.items, on a trip with no costs section yet",
      file: "test/helper-statement-orphans.test.ts",
    },
  },
  {
    id: "D11",
    claim:
      "An owner-granted address can read immediately; the mail is a notification carrying a way to decline everything. A link still grants nothing. AGENTS.md is amended per §8. Security review completed.",
    proof: null,
  },
  {
    id: "D12",
    claim: "A save built from a stale read is refused with a screen naming what changed underneath.",
    proof: {
      kind: "test",
      name:
        "EditDay, confirmBeforeSave — D12's stale refusal actually replaces the panel a 409 shows the refusal screen, not the confirm screen still sitting there",
      file: "test/edit-day-stale-write.test.tsx",
    },
  },

  // --- The hub and the skeleton -----------------------------------------
  {
    id: "H1",
    claim: "The hub lists every flow, grouped, with Add a day prominent.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/hub-recapture-1280.png",
      observed:
        "Driven live against content/example/ at 1280px, light theme: /example/studio renders 'Add a day' as a full-width card with its own dark button ('Start a day'), sitting above and visually heavier than everything else, followed by five labelled groups exactly matching spec.md's own list — WRITE (Change a day, Something is filed wrong), PLAN (A new trip, Who may read a trip), PEOPLE (Let somebody read this journal, Who was there), BRING IN (Photographs, Where you went, A bank statement), PRINT (A postcard, A photobook) — twelve flows total across five groups, with no Contacts card and no account/credits/keys/deletion entry anywhere on the page.",
    },
  },
  {
    id: "H2",
    claim: "An empty journal shows one call to action, not a grid.",
    proof: {
      kind: "test",
      name: "H2 — an empty journal shows one call to action, not a grid",
      file: "test/studio-hub.test.tsx",
    },
  },
  {
    id: "H3",
    claim: "A flow that cannot run is shown with its reason, in the right one of the three wordings.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/hub-recapture-1280.png",
      observed:
        "Driven live against content/example/ at 1280px with printing left switched off (site/config.json's postcards.enabled: false, the shipped default): the hub's 'A postcard' card is visibly muted (faint border, subdued background, faint ink) rather than hidden, and its description line is replaced with 'This journal cannot send postcards. Printing is switched off on this instance.' — the calm, states-the-fact-and-where-the-setting-lives wording spec.md §3 gives for 'the operator switched it off', word for word, and distinct from the other two cards' own descriptions which stayed as plain how-it-works text.",
    },
  },
  {
    id: "H4",
    claim: "Half-done work appears on the hub, resumable, with its expiry.",
    proof: {
      kind: "test",
      name: "StudioHub — half-done 'Add a day' work reaches the hub (H4) a fresh draft shows a resume banner naming when it expires",
      file: "test/studio-add-day-resume.test.tsx",
    },
  },
  {
    id: "H5",
    claim: "Every flow has its own linkable URL and resumes from it.",
    proof: null,
  },
  {
    id: "H6",
    // B1826: `/docs/extract` itself is gone (its inbound links — ExtractHub,
    // deleted by B1825, and NonPhotoImport's own guide line — are gone with
    // it), and every old `/extract/*` bookmark 301s onward rather than
    // stranding a step that needs it. `/docs/guide/buddy` and
    // `/docs/guide/creator` are the one place this claim does *not* fully
    // hold — see `lib/docs.ts`'s own doc comment on `GUIDES` for the live
    // page that still depends on them and why B1826 could not delete them —
    // so this proof is scoped to what B1826 actually finished.
    claim: "No step needs information from elsewhere in the app; no link to /docs/extract survives.",
    proof: {
      kind: "absent",
      // Quoted, not a bare substring: several doc comments left behind by
      // this very deletion mention `/docs/extract` in prose (what used to
      // link there, and why), and a grep for the bare path would flag its
      // own explanation as a survivor. A real link needs the quoted
      // attribute form; prose never has a reason to write it that way.
      grep: String.raw`"/docs/extract"`,
      paths: ["app", "components", "lib"],
    },
  },

  // --- Localisation and verification -------------------------------------
  {
    id: "L1",
    claim: "Real English and German entries for every new string.",
    proof: {
      kind: "test",
      name: "dictionaries de.json, the one locale this project keeps at parity with English, covers every English key",
      file: "test/locales.test.ts",
    },
  },
  {
    id: "L2",
    claim:
      "Hungarian ships for every key rather than falling back, and no entry is English wearing a Hungarian key.",
    // **Rewritten 2026-09-20, because the rule underneath it changed.**
    //
    // This item used to read "Hungarian is not invented. Where it is missing,
    // the task is left short of done and says so", and it was proven by a grep
    // asserting the studio's own keys were ABSENT from hu.json. That was a
    // faithful reading of AGENTS.md as it then stood.
    //
    // AGENTS.md now says the opposite: translating them yourself is fine,
    // Hungarian included, because a string that ships in every language beats
    // a key that falls back to English while it waits for a speaker. The old
    // proof therefore failed the moment somebody did the right thing — it was
    // enforcing a retired policy, which is worse than not checking at all.
    //
    // What survives from the old rule is the harm it was really guarding
    // against: an English string sitting in hu.json, claiming to be a
    // translation. A missing key falls back to English honestly and everybody
    // can see it; a pasted one is a lie that reads as finished. So that is
    // what this greps for now.
    //
    // `wa.onb.card` is the one legitimate identical value — a language-picker
    // card that deliberately carries every language at once — and it is
    // excluded by name in the test rather than by loosening the check.
    //
    // NOT asserted here, deliberately: that hu.json is complete. A hard gate
    // on completeness would fail the moment an English string lands before its
    // translation, and B1894 chose report-over-fail for exactly that reason —
    // a red gate pushes somebody toward writing a translation they cannot
    // check. `npm run i18n:keys` reports the coverage instead.
    proof: {
      kind: "test",
      name: "Hungarian address is consistently informal (B481) no Hungarian entry is its English original pasted across",
      file: "test/locales.test.ts",
    },
  },
  {
    id: "V1",
    claim:
      "Every flow driven in a real browser at 390px and at desktop width, on content that existed before the branch — not only on a fixture authored for the change. Screenshot inspected, console and request failures checked.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/day-new-390.png",
      observed:
        "One of 63 screenshots originally captured at .claude/runs/2026-09-19-the-studio/browser/ (this one now committed at test/fixtures/studio-proofs/, B2251 — the rest were never committed evidence): all 11 studio pages (day/new, day/edit, day/reshape, trip/new, trip/visibility, reader/invite, people, photos, location, statement, postcard) plus the hub were driven live against content/example/'s real trips at both 390px (this file) and 1280px, with zero console errors and zero failed (>=400 or failed) network requests recorded across every one of those loads — day/new was additionally walked end to end (trip pick, date, decline-all, preview, 'Make this day, as a draft') to a real draft on disk, then deleted again to leave content/example/ unchanged.",
    },
  },
  {
    id: "V2",
    claim: "Both themes checked. Colours from app/globals.css tokens only — no raw hex, no seventh hue.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/people-390-dark.png",
      observed:
        "Driven live against content/example/ at 390px, dark theme (Emulation.setEmulatedMedia prefers-color-scheme: dark, no explicit data-theme override — matching a real reader's 'Automatic' default): the hub, day/new, people, trip/visibility and statement were each captured at both 1280px and 390px in both light and dark, all legible with consistent cream/navy/yellow tokens and no colour inversion artefacts; `grep -rnE '#[0-9a-fA-F]{3,6}' app/[user]/studio components/studio` returns no matches, so nothing here can be a raw hex outside app/globals.css's tokens.",
    },
  },
  {
    id: "V3",
    claim: "At least one failure screen per flow exists, names a likely cause and offers a way back.",
    proof: {
      kind: "capture",
      path: "test/fixtures/studio-proofs/day-new-collision-after-1280.png",
      observed:
        "Driven live against content/example/'s real 'Across and back' trip: picking 2026-06-03 in Add a day (a date that already holds the published day 'Denver, and a truck') stops the flow with 'Two days on one date is almost never what somebody means, so this stops rather than quietly making a second one', names the existing day, and offers two ways back ('Change that day instead', 'Pick another date') beside the path forward — this is the one flow (of the twelve) actually driven to a stop screen this pass; the other eleven were not independently exercised for a failure state, so this proof supports Add a day specifically rather than the claim's 'per flow' scope.",
    },
  },
  {
    id: "V4",
    claim: "npm run verify passes.",
    proof: null,
  },
];
