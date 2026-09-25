"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { useOnline } from "@/components/studio/useOnline";
import { formatCredits } from "@/lib/creditsFormat";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import StepBody from "@/components/studio/StepBody";
import { useStep } from "@/lib/studio/useStep";
import type { FigureDoc } from "@/lib/api/v2/schemas/figures";
import {
  ACCESSORIES,
  AGES,
  BUILDS,
  CLOTH,
  EYES,
  HAIR,
  HAIR_STYLES,
  OUTFITS,
  SKIN,
  type Accessory,
} from "@/lib/travellers/vocabulary";
import { STARTING_POINTS } from "@/lib/travellers/presets";
import {
  applyPreset,
  deriveFigureId,
  filterPhotoProposal,
  presetTileLabel,
  type PhotoProposal,
} from "@/lib/figures/creator";

/** The creator's screens, in `?figure=` (B2136) — its own parameter, since
 *  "Who was there" draws it while already owning `?step=`. Reshaping an
 *  existing figure opens on "shape", so that is its first screen. */
const SCREENS = ["start", "photo", "shape"] as const;
const RESHAPE_SCREENS = ["shape", "start", "photo"] as const;
type StartMode = "look" | "photo" | "plain";
/** Which colour axis has its palette open — one at a time, the others
 *  always closed, per the spec: "tapping it opens that axis's palette in
 *  place; the others stay closed." */
type ColourAxis = "skin" | "hair" | "eyes" | "shirt";

/** Every field a figure may carry, minus the three that name it (`id`,
 *  `name`, `person`) — those are decided once, from `person`, not by
 *  anything a chip sets. */
type Appearance = Omit<FigureDoc, "id" | "name" | "person">;

const APPEARANCE_KEYS: (keyof Appearance)[] = [
  "hairStyle",
  "outfit",
  "build",
  "age",
  "skin",
  "hair",
  "eyes",
  "shirt",
  "pants",
  "pack",
  "headscarf",
  "accessories",
];

/** What the renderer itself draws for an axis nobody has chosen yet
 *  (`lib/travellers/shapes.ts`'s own `colour(figure.x, X, fallback)` calls)
 *  — shown as the axis chip's own swatch so a person sees, and can change,
 *  the colour they are already being drawn in rather than an empty box. */
const AXIS_DEFAULT: Record<ColourAxis, string> = {
  skin: "medium",
  hair: "dark-brown",
  eyes: "brown",
  shirt: "sky",
};

const AXIS_MAP: Record<ColourAxis, Record<string, string>> = {
  skin: SKIN,
  hair: HAIR,
  eyes: EYES,
  shirt: CLOTH,
};

/** "Plain" clears every appearance axis back to the renderer's own default —
 *  the neutral figure `GET .../figures/preview` draws for an empty object. */
function stripAppearance(): Appearance {
  return {};
}

/** "long-hair" → "long hair" — the vocabulary is written as hyphenated
 *  tokens (`lib/travellers/vocabulary.ts`); a chip reads better as words. */
function label(token: string): string {
  return token.replace(/-/g, " ");
}

function swatchClass(active: boolean): string {
  return `flex min-h-11 min-w-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${
    active ? "border-ink-strong ring-2 ring-ink-strong" : "border-line-strong"
  }`;
}

function previewSrc(username: string, figure: Appearance, size: number): string {
  return `/api/v2/${encodeURIComponent(username)}/figures/preview?figure=${encodeURIComponent(
    JSON.stringify(figure),
  )}&size=${size}`;
}

type CandidateProposal = PhotoProposal & { position: number };

/**
 * The figure creator — B2021. Start from a look, a photo, or plain; shape
 * every axis with chips against a live preview from the real renderer; save.
 *
 * Standalone on purpose: `PeopleFlow`'s "draw them?" pass and the new-trip
 * step's "who is coming" both open this with a different `person` and a
 * different `onSaved`, and neither owns any of its state.
 */
export default function FigureCreator({
  username,
  initial,
  person,
  photoConsent,
  photoCredits,
  existingIds,
  onSaved,
  onCancel,
}: {
  username: string;
  /** An existing figure to reshape, or `null` to start a new one. */
  initial: FigureDoc | null;
  /** Who this figure is for — a name, and, when known, the address
   *  `figureDoc.person` takes. `email` absent draws a decorative figure with
   *  a name but no linked person ("winter me", "the dog") — B2022's own
   *  library names one before it is ever drawn. `null` altogether falls
   *  back to whatever `initial` already carries, which is how "change how
   *  X looks" reopens this component without resetting the name or person
   *  it is already saved under. */
  person: { name: string; email?: string } | null;
  /** Gates the whole "from a photo" door — absent from the DOM with this
   *  false, not merely disabled (the ticket's own acceptance line). */
  photoConsent: boolean;
  /** What "Describe and propose" costs, named before it runs. */
  photoCredits: number;
  /** Every id already in this journal's library, so a new figure never
   *  collides with one already saved. */
  existingIds: string[];
  onSaved: (figure: FigureDoc) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  // Back inside the creator is the screen before; saving or cancelling
  // clears `?figure=` so the page it sits on is left as it was.
  const { step: screen, go: setScreen, reset } = useStep<(typeof SCREENS)[number]>(initial ? RESHAPE_SCREENS : SCREENS, {
    flowId: "figure",
    param: "figure",
  });
  const online = useOnline();
  const [startMode, setStartMode] = useState<StartMode>("look");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [openAxis, setOpenAxis] = useState<ColourAxis | null>(null);
  const [figure, setFigure] = useState<Appearance>(() => {
    if (!initial) return {};
    const copy: Appearance = {};
    for (const key of APPEARANCE_KEYS) {
      const value = initial[key];
      if (value !== undefined) (copy as Record<string, unknown>)[key] = value;
    }
    return copy;
  });

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateProposal[] | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // "A coarse pointer or the capture attribute is supported" (the ticket's
  // own words) — a viewport breakpoint (`lg:hidden`) answered a question
  // about window width, not about whether a camera makes sense, so a
  // desktop browser narrowed to phone width showed it too. Neither half is
  // knowable before the first client render, so this starts false (no
  // camera button, the safe default) and corrects itself once mounted.
  const [cameraPlausible, setCameraPlausible] = useState(false);
  useEffect(() => {
    let plausible = false;
    try {
      plausible = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    } catch {
      plausible = false;
    }
    if (!plausible) {
      try {
        plausible = "capture" in document.createElement("input");
      } catch {
        plausible = false;
      }
    }
    // A capability probe with no event to subscribe to; see the comment above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCameraPlausible(plausible);
  }, []);

  // The one place `photoUrl` is ever set — an object URL has to be revoked
  // when the file it was made from is replaced, so this stays an effect
  // rather than a `useMemo` even though nothing here subscribes to
  // anything external.
  useEffect(() => {
    if (!photoFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const preview = useMemo(() => previewSrc(username, figure, 140), [username, figure]);

  function setField<K extends keyof Appearance>(key: K, value: Appearance[K] | undefined) {
    setFigure((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function chooseColour(axis: ColourAxis, name: string) {
    setField(axis, name);
    setOpenAxis(null);
  }

  function toggleAccessory(item: Accessory) {
    setFigure((prev) => {
      const current = prev.accessories ?? [];
      const has = current.includes(item);
      const accessories = has ? current.filter((a) => a !== item) : [...current, item];
      return { ...prev, accessories: accessories.length > 0 ? accessories : undefined };
    });
  }

  function choosePreset(name: string) {
    setSelectedPreset(name);
    setFigure((prev) => applyPreset(prev, name) as Appearance);
  }

  function continueFromStart() {
    if (startMode === "photo") {
      setScreen("photo");
      return;
    }
    if (startMode === "plain") {
      setFigure(stripAppearance());
    }
    setScreen("shape");
  }

  async function proposeFromPhoto() {
    if (!photoFile) return;
    setPhotoBusy(true);
    setPhotoError(null);
    setPhotoNote(null);
    try {
      const form = new FormData();
      form.append("photo", photoFile, photoFile.name);
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/figures/from-photo`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: true;
        figures?: { position: number; figure: Appearance; unanswerable: string[] }[];
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        setPhotoError(t("studio.figures.photo.error"));
        return;
      }
      const found = json.figures ?? [];
      if (found.length === 0) {
        setPhotoNote(t("studio.figures.photo.noFace"));
        return;
      }
      if (found.length === 1) {
        applyCandidate(found[0]);
        return;
      }
      setCandidates(found as CandidateProposal[]);
    } finally {
      setPhotoBusy(false);
    }
  }

  // The safeguard the review asked for: the server already drops
  // build/age/pants/outfit (`filterPhotoProposal`, `lib/figures/creator.ts`)
  // before this ever reaches the browser, but this runs the exact same
  // filter again rather than trusting the network response's shape — the
  // same reasoning AGENTS.md gives for checking a claim against the turn,
  // not against what a caller was merely asked to send.
  function applyCandidate(candidate: { figure: Appearance; unanswerable: string[] }) {
    const filtered = filterPhotoProposal(candidate as PhotoProposal);
    setFigure((prev) => ({ ...prev, ...filtered.figure }));
    setCandidates(null);
    setScreen("shape");
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const id = initial?.id ?? deriveFigureId(person?.name ?? "figure", existingIds);
      const body: Record<string, unknown> = {
        ...figure,
        id,
        name: person?.name ?? initial?.name,
        // An empty/absent `email` on `person` (a decorative figure, named
        // but tied to nobody) must not become the literal empty string on
        // the wire — `figureDoc.person` is `z.email().optional()`, which
        // refuses "" outright.
        person: person?.email || initial?.person,
      };
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/figures/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          // Overwrite unconditionally when this is a known figure — see
          // `ifMatchStale`: a wildcard never counts as stale. A brand-new id
          // sends no header at all, which is the door's own create path.
          ...(initial ? { "if-match": "*" } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as FigureDoc | { error?: string } | null;
      if (!res.ok || !json || "error" in json) {
        setSaveError(t("studio.figures.shape.error"));
        return;
      }
      reset();
      onSaved(json as FigureDoc);
    } catch {
      setSaveError(t("studio.figures.shape.error"));
    } finally {
      setSaving(false);
    }
  }

  const chipClass = (active: boolean) =>
    `min-h-11 rounded-full border px-3 text-sm font-semibold ${
      active ? "border-ink-strong bg-ink-strong text-on-action" : "border-line-strong text-ink-secondary"
    }`;

  const secondaryButtonClass =
    "min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle";

  return (
    <StepBody step={screen}>
      <div className="mt-4">
      {person && screen !== "shape" && (
        <p className="mb-2 text-sm font-semibold text-ink-secondary">{person.name}</p>
      )}

      {screen === "start" && (
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-strong">
            {t("studio.figures.start.heading")}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setStartMode("look")} aria-pressed={startMode === "look"} className={chipClass(startMode === "look")}>
              {t("studio.figures.start.look")}
            </button>
            {photoConsent && (
              <button
                type="button"
                onClick={() => setStartMode("photo")}
                aria-pressed={startMode === "photo"} className={chipClass(startMode === "photo")}
              >
                {t("studio.figures.start.photo")}
              </button>
            )}
            <button type="button" onClick={() => setStartMode("plain")} aria-pressed={startMode === "plain"} className={chipClass(startMode === "plain")}>
              {t("studio.figures.start.plain")}
            </button>
          </div>

          {startMode === "look" && (
            <div className="mt-3">
              <div className="flex flex-wrap gap-2">
                {STARTING_POINTS.map((preset) => {
                  const tileLabel = presetTileLabel(preset.figure);
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => choosePreset(preset.name)}
                      className={`flex min-h-11 flex-col items-center gap-1 rounded-xl border px-2 py-2 ${
                        selectedPreset === preset.name ? "border-ink-strong bg-surface-subtle" : "border-line-strong"
                      }`}
                    >
                      {/* A fixed-size frame around the image, not just the
                       *  image itself: an SVG preview is a network round
                       *  trip like any other, and without this the tile
                       *  reads as broken for the instant before it resolves
                       *  rather than as a picture that is merely loading. */}
                      <span className="flex h-[54px] w-[34px] items-center justify-center rounded bg-surface-subtle">
                        <img
                          src={previewSrc(username, preset.figure, 64)}
                          alt={t("studio.figures.start.tileAlt", { label: tileLabel })}
                          width={34}
                          height={54}
                          className="pointer-events-none"
                        />
                      </span>
                      <span className="text-xs text-ink-secondary">
                        {tileLabel}
                        {selectedPreset === preset.name ? " ✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-ink-secondary">{t("studio.figures.start.lookNote")}</p>
            </div>
          )}

          {startMode === "photo" && photoConsent && (
            <p className="mt-3 text-sm text-ink-body">{t("studio.figures.start.photoNote")}</p>
          )}

          {startMode === "plain" && (
            <p className="mt-3 text-sm text-ink-body">{t("studio.figures.start.plainNote")}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <StepPrimary
              disabled={startMode === "look" && !selectedPreset}
              onClick={continueFromStart}
              label={t("studio.figures.start.next")}
            />
            <button
              type="button"
              onClick={() => {
                reset();
                onCancel();
              }}
              className={secondaryButtonClass}
            >
              {t("studio.figures.start.cancel")}
            </button>
          </div>
        </div>
      )}

      {screen === "photo" && (
        <div>
          {!candidates && (
            <>
              <div className="flex flex-wrap gap-2">
                <input
                  id="figure-creator-photo-choose"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    setPhotoNote(null);
                    setPhotoFile(e.target.files?.[0] ?? null);
                  }}
                  className="peer sr-only"
                />
                <label
                  htmlFor="figure-creator-photo-choose"
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-strong"
                >
                  {t("studio.figures.photo.choose")}
                </label>
                {/* A capability check, not a viewport check — a browser
                 *  window narrowed to phone width has a fine pointer like
                 *  any other desktop session, and must not gain a camera
                 *  button just because it got narrow (the review's own
                 *  finding). See the `cameraPlausible` effect above. */}
                {cameraPlausible && (
                  <>
                    <input
                      id="figure-creator-photo-camera"
                      type="file"
                      accept="image/*"
                      capture="user"
                      onChange={(e) => {
                        setPhotoNote(null);
                        setPhotoFile(e.target.files?.[0] ?? null);
                      }}
                      className="peer sr-only"
                    />
                    <label
                      htmlFor="figure-creator-photo-camera"
                      className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-strong"
                    >
                      {t("studio.figures.photo.takeOne")}
                    </label>
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-secondary">{t("studio.figures.photo.hint")}</p>

              {photoUrl && (
                <img
                  src={photoUrl}
                  alt={t("studio.figures.photo.chosenAlt")}
                  className="mt-3 h-20 w-20 rounded-lg object-cover"
                />
              )}

              <div className="mt-3">
                <StepPrimary
                  busy={photoBusy}
                  busyLabel={t("studio.figures.photo.busy")}
                  disabled={!photoFile || !online}
                  onClick={() => void proposeFromPhoto()}
                  label={t("studio.figures.photo.propose", { credits: formatCredits(photoCredits) })}
                />
                {/* B2330 — needs a live model call; greyed (via `disabled`
                    above) with one line why, rather than a tap that only
                    fails once it reaches the network. */}
                {!online && <p className="mt-2 text-sm text-ink-secondary">{t("studio.figures.photo.offline")}</p>}
              </div>
              {photoNote && <p className="mt-2 text-sm text-ink-secondary">{photoNote}</p>}
              <SubmitError message={photoError} />
            </>
          )}

          {candidates && (
            <div>
              <h3 className="font-display text-base font-semibold text-ink-strong">
                {t("studio.figures.photo.pickOne")}
              </h3>
              <p className="mt-1 text-sm text-ink-secondary">{t("studio.figures.photo.pickOneHint")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {candidates.map((candidate, i) => {
                  const faceLabel = t("studio.figures.photo.face", { n: String(i + 1) });
                  return (
                    <button
                      key={candidate.position}
                      type="button"
                      onClick={() => applyCandidate(candidate)}
                      className="flex min-h-11 flex-col items-center gap-1 rounded-xl border border-line-strong px-2 py-2"
                    >
                      <img src={previewSrc(username, candidate.figure, 64)} alt={faceLabel} width={34} height={54} />
                      <span className="text-xs text-ink-secondary">{faceLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setCandidates(null);
              setScreen("start");
            }}
            className={`mt-3 ${secondaryButtonClass}`}
          >
            {t("studio.figures.photo.back")}
          </button>
        </div>
      )}

      {screen === "shape" && (
        <div>
          <div className="sticky top-0 z-10 flex flex-col items-center rounded-xl bg-ink-strong px-3 py-3">
            <img
              src={preview}
              alt={person ? t("studio.figures.shape.previewAlt", { name: person.name }) : t("studio.figures.shape.previewAltGeneric")}
              width={70}
              height={112}
            />
            {person && <span className="mt-1 text-sm font-semibold text-on-action">{person.name}</span>}
          </div>

          <ChipGroup label={t("studio.figures.axis.hairStyle")}>
            {HAIR_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setField("hairStyle", figure.hairStyle === style ? undefined : style)}
                aria-pressed={figure.hairStyle === style} className={chipClass(figure.hairStyle === style)}
              >
                {label(style)}
              </button>
            ))}
          </ChipGroup>

          <ColourAxisGroup
            axis="skin"
            heading={t("studio.figures.axis.skin")}
            value={figure.skin}
            open={openAxis === "skin"}
            onToggle={() => setOpenAxis((prev) => (prev === "skin" ? null : "skin"))}
            onSelect={(name) => chooseColour("skin", name)}
          />
          <ColourAxisGroup
            axis="hair"
            heading={t("studio.figures.axis.hair")}
            value={figure.hair}
            open={openAxis === "hair"}
            onToggle={() => setOpenAxis((prev) => (prev === "hair" ? null : "hair"))}
            onSelect={(name) => chooseColour("hair", name)}
          />
          <ColourAxisGroup
            axis="eyes"
            heading={t("studio.figures.axis.eyes")}
            value={figure.eyes}
            open={openAxis === "eyes"}
            onToggle={() => setOpenAxis((prev) => (prev === "eyes" ? null : "eyes"))}
            onSelect={(name) => chooseColour("eyes", name)}
          />
          <ColourAxisGroup
            axis="shirt"
            heading={t("studio.figures.axis.shirt")}
            value={figure.shirt}
            open={openAxis === "shirt"}
            onToggle={() => setOpenAxis((prev) => (prev === "shirt" ? null : "shirt"))}
            onSelect={(name) => chooseColour("shirt", name)}
          />

          <ChipGroup label={t("studio.figures.axis.outfit")}>
            {OUTFITS.map((outfit) => (
              <button
                key={outfit}
                type="button"
                onClick={() => setField("outfit", figure.outfit === outfit ? undefined : outfit)}
                aria-pressed={figure.outfit === outfit} className={chipClass(figure.outfit === outfit)}
              >
                {label(outfit)}
              </button>
            ))}
          </ChipGroup>

          <ChipGroup label={t("studio.figures.axis.accessories")}>
            {ACCESSORIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => toggleAccessory(item)}
                aria-pressed={(figure.accessories ?? []).includes(item)} className={chipClass((figure.accessories ?? []).includes(item))}
              >
                {label(item)}
              </button>
            ))}
          </ChipGroup>

          <ChipGroup label={t("studio.figures.axis.build")}>
            {BUILDS.map((b) => {
              const isDefault = b === "average";
              const active = figure.build ? figure.build === b : isDefault;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setField("build", b)}
                  aria-pressed={active} className={chipClass(active)}
                >
                  {label(b)}
                  {isDefault && !figure.build ? ` (${t("studio.figures.default")})` : ""}
                </button>
              );
            })}
          </ChipGroup>

          <ChipGroup label={t("studio.figures.axis.age")}>
            {AGES.map((a) => {
              const isDefault = a === "adult";
              const active = figure.age ? figure.age === a : isDefault;
              return (
                <button key={a} type="button" onClick={() => setField("age", a)} aria-pressed={active} className={chipClass(active)}>
                  {label(a)}
                  {isDefault && !figure.age ? ` (${t("studio.figures.default")})` : ""}
                </button>
              );
            })}
          </ChipGroup>

          <div className="mt-4 flex flex-wrap gap-2">
            <StepPrimary
              busy={saving}
              busyLabel={t("studio.figures.shape.busy")}
              onClick={() => void save()}
              label={
                person
                  ? t("studio.figures.shape.save", { name: person.name })
                  : t("studio.figures.shape.saveGeneric")
              }
              tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
            />
            <button type="button" onClick={() => setScreen("start")} className={secondaryButtonClass}>
              {t("studio.figures.shape.startOver")}
            </button>
          </div>
          <SubmitError message={saveError} />
        </div>
      )}
      </div>
    </StepBody>
  );
}

/** One full-width group of chips, labelled — the ticket's own rule: "each
 *  control group is full width", never side by side with the preview. */
function ChipGroup({ label: heading, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{heading}</h3>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * One colour axis, collapsed to a single chip showing its current swatch
 * and name — "never a free colour picker" (the ticket) applies to what a
 * chip opens, not to how many are open at once: twelve-plus named colours
 * across four axes, all expanded together, is what made the shape screen
 * roughly 1800px tall. Tapping the chip opens this axis's palette in place;
 * picking a colour closes it back down to the summary.
 */
function ColourAxisGroup({
  axis,
  heading,
  value,
  open,
  onToggle,
  onSelect,
}: {
  axis: ColourAxis;
  heading: string;
  value: string | undefined;
  open: boolean;
  onToggle: () => void;
  onSelect: (name: string) => void;
}) {
  const map = AXIS_MAP[axis];
  const current = value ?? AXIS_DEFAULT[axis];
  const hex = map[current] ?? map[AXIS_DEFAULT[axis]];
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{heading}</h3>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mt-2 flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-body"
      >
        <span className="inline-block h-5 w-5 rounded-full border border-line-strong" style={{ background: hex }} />
        {label(current)}
        <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(map).map(([name, swatchHex]) => (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(name)}
              className={swatchClass(current === name)}
            >
              <span
                className="inline-block h-5 w-5 rounded-full border border-line-strong"
                style={{ background: swatchHex }}
              />
              {label(name)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
