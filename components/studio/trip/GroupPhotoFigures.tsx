"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { useOnline } from "@/components/studio/useOnline";
import type { FigureDoc } from "@/lib/api/v2/schemas/figures";
import { deriveFigureId, filterPhotoProposal, type PhotoProposal } from "@/lib/figures/creator";
import { cropBox, MAX_MARKERS, openPhoto, type Marker, type OpenedPhoto } from "@/lib/figures/groupPhoto";

type Person = { name: string; email?: string };
type Appearance = Omit<FigureDoc, "id" | "name" | "person">;
type Card = {
  n: number;
  status: "pending" | "done" | "failed";
  look?: Appearance;
  name: string;
  email?: string;
  discarded?: boolean;
  saved?: FigureDoc;
};

/**
 * "Make figures from a photo" (B-2847), the second half of the people sheet.
 * The owner taps who in the photo gets a figure; only a crop around each tap
 * is cropped in the browser and sent to the assistant, one request each. The
 * photo itself is never uploaded or kept. A proposal becomes a figure only
 * once the owner has named it (typed, a contact they picked, or "That's me")
 * or discarded it: nothing is matched by the code.
 */
export default function GroupPhotoFigures({
  username,
  owner,
  contacts,
  existingIds,
  onKept,
  onCancel,
}: {
  username: string;
  owner: Person;
  contacts: { name: string; email: string }[];
  existingIds: string[];
  /** The figures that were created and the people the owner named. */
  onKept: (docs: FigureDoc[], named: Person[]) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const online = useOnline();
  const photo = useRef<OpenedPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => photo.current?.close(), []);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      photo.current?.close();
      photo.current = await openPhoto(file);
      setPhotoUrl(photo.current.url);
      setMarkers([]);
      setCards(null);
    } catch {
      setError(t("studio.tripPeople.photo.unreadable"));
    }
  }

  function tap(e: React.MouseEvent<HTMLDivElement>) {
    if (markers.length >= MAX_MARKERS) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const n = Math.max(0, ...markers.map((m) => m.n)) + 1;
    setMarkers([...markers, { n, x, y }]);
  }

  const patch = (n: number, change: Partial<Card>) =>
    setCards((prev) => prev && prev.map((c) => (c.n === n ? { ...c, ...change } : c)));

  /** One crop, one request. Only the crop is in the body. */
  async function describe(m: Marker) {
    const p = photo.current;
    if (!p) return;
    patch(m.n, { status: "pending" });
    try {
      const blob = await p.crop(cropBox(m, p.width, p.height));
      const form = new FormData();
      form.append("photo", blob, `person-${m.n}.jpg`);
      // no-refresh: a proposal from one crop, nothing is written
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/figures/from-photo`, { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as { ok?: true; figures?: PhotoProposal[] } | null;
      const first = json?.figures?.[0];
      if (!res.ok || !json?.ok || !first) {
        patch(m.n, { status: "failed" });
        return;
      }
      patch(m.n, { status: "done", look: filterPhotoProposal(first).figure as Appearance });
    } catch {
      patch(m.n, { status: "failed" });
    }
  }

  function startDescribing() {
    setCards(markers.map((m) => ({ n: m.n, status: "pending", name: "" })));
    markers.forEach((m) => void describe(m));
  }

  const live = (cards ?? []).filter((c) => !c.discarded);
  const ready = live.length > 0 && live.every((c) => c.status === "done" && c.name.trim());

  async function keep() {
    if (!cards) return;
    setSaving(true);
    setError(null);
    const used = [...existingIds];
    const docs: FigureDoc[] = [];
    try {
      for (const c of live) {
        let doc = c.saved;
        if (!doc) {
          const id = deriveFigureId(c.name, used);
          // no-refresh: onKept (the sheet's keepFigures) refreshes once for all
          const res = await fetch(`/api/web/${encodeURIComponent(username)}/figures/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...c.look, id, name: c.name.trim(), ...(c.email ? { person: c.email } : {}) }),
          });
          const json = (await res.json().catch(() => null)) as FigureDoc | null;
          if (!res.ok || !json || "error" in json) throw new Error("save");
          doc = json;
          patch(c.n, { saved: doc });
        }
        used.push(doc.id);
        docs.push(doc);
      }
    } catch {
      setError(t("studio.tripPeople.error"));
      setSaving(false);
      return;
    }
    const named = live
      .filter((c) => !(c.name.trim() === owner.name && c.email === owner.email))
      .map((c) => ({ name: c.name.trim(), ...(c.email ? { email: c.email } : {}) }));
    onKept(docs, named);
  }

  const btn = "min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong disabled:opacity-50";

  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.tripPeople.photo.title")}</h2>
      {!online && <p className="mt-2 text-sm text-ink-secondary">{t("studio.tripPeople.photo.offline")}</p>}
      {!photoUrl && (
        <>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.tripPeople.photo.consent")}</p>
          <label className={`${btn} mt-3 inline-flex items-center`}>
            {t("studio.tripPeople.photo.choose")}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
          </label>
        </>
      )}
      {photoUrl && !cards && (
        <>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.tripPeople.photo.tapHint")}</p>
          <div
            onClick={tap}
            data-testid="group-photo"
            className="relative mt-3 cursor-crosshair select-none overflow-hidden rounded-lg"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt={t("studio.tripPeople.photo.alt")} className="block w-full" draggable={false} />
            {markers.map((m) => (
              <button
                key={m.n}
                type="button"
                aria-label={t("studio.tripPeople.photo.markerRemove", { n: String(m.n) })}
                onClick={(e) => {
                  e.stopPropagation();
                  setMarkers(markers.filter((x) => x !== m));
                }}
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
                className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-yellow-400 text-sm font-bold text-yellow-950 shadow"
              >
                {m.n}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={markers.length === 0 || !online}
              onClick={startDescribing}
              className="min-h-11 rounded-full bg-yellow-400 px-5 font-semibold text-yellow-950 hover:bg-yellow-300 disabled:opacity-50"
            >
              {t("studio.tripPeople.photo.describe", { count: String(markers.length) })}
            </button>
            <label className={`${btn} inline-flex items-center`}>
              {t("studio.tripPeople.photo.another")}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
            </label>
          </div>
        </>
      )}
      {cards && (
        <>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.tripPeople.photo.nameHint")}</p>
          <ul className="mt-3 divide-y divide-line-quiet">
            {cards.map((c) =>
              c.discarded ? null : (
                <li key={c.n} className="py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-yellow-400 text-sm font-bold text-yellow-950">
                      {c.n}
                    </span>
                    <span className="flex h-12 w-8 flex-none items-center justify-center">
                      {c.look && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/v2/${encodeURIComponent(username)}/figures/preview?figure=${encodeURIComponent(JSON.stringify(c.look))}&size=96`}
                          alt=""
                          width={28}
                          height={45}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-ink-secondary" role="status">
                      {c.status === "pending" && t("studio.tripPeople.photo.pending")}
                      {c.status === "failed" && t("studio.tripPeople.photo.failed")}
                    </span>
                    {c.status === "failed" && (
                      <button
                        type="button"
                        className="min-h-11 shrink-0 px-2 text-sm font-semibold text-ink-strong underline underline-offset-2"
                        onClick={() => void describe(markers.find((m) => m.n === c.n)!)}
                      >
                        {t("studio.tripPeople.photo.retry")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="min-h-11 shrink-0 px-2 text-sm text-ink-secondary underline underline-offset-2"
                      onClick={() => patch(c.n, { discarded: true })}
                    >
                      {t("studio.tripPeople.photo.discard")}
                    </button>
                  </div>
                  {c.status === "done" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        aria-label={t("studio.tripPeople.photo.nameLabel", { n: String(c.n) })}
                        value={c.name}
                        onChange={(e) => patch(c.n, { name: e.target.value, email: undefined })}
                        autoComplete="off"
                        className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-base px-3 text-ink-strong"
                      />
                      <select
                        aria-label={t("studio.tripPeople.photo.pickLabel", { n: String(c.n) })}
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "@me") patch(c.n, { name: owner.name, email: owner.email });
                          else {
                            const k = contacts.find((x) => x.email === v);
                            if (k) patch(c.n, { name: k.name, email: k.email });
                          }
                        }}
                        className="min-h-11 rounded-lg border border-line-strong bg-surface-base px-2 text-ink-strong"
                      >
                        <option value="">{t("studio.tripPeople.photo.pick")}</option>
                        <option value="@me">{t("studio.tripPeople.photo.me")}</option>
                        {contacts
                          .filter((k) => k.email !== owner.email)
                          .map((k) => (
                            <option key={k.email} value={k.email}>
                              {k.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-coral-600">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btn}>
          {t("studio.tripPeople.photo.back")}
        </button>
        {cards && (
          <button
            type="button"
            disabled={!ready || saving}
            onClick={() => void keep()}
            className="min-h-11 rounded-full bg-yellow-400 px-5 font-semibold text-yellow-950 hover:bg-yellow-300 disabled:opacity-50"
          >
            {t("studio.tripPeople.photo.keep", { count: String(live.length) })}
          </button>
        )}
      </div>
    </div>
  );
}
