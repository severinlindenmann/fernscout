"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import type { MediaTile } from "@/lib/types";

/**
 * Composing a postcard from a photograph the owner is already looking at —
 * B441.
 *
 * B434 built the order and the preview page and left no way into either from
 * the site: an agent had to make one. This is the way in, and it deliberately
 * stops in the same place the agent does. **It creates a draft order and
 * redirects to the preview page. It never sends.** Sending is one button, on
 * that page, and it is the only thing anywhere that spends credits at a
 * printer — see `app/[user]/postcards/[id]/send/route.ts`.
 *
 * ## It calls the endpoints that already existed
 *
 * No route was added for this. `GET …/postcards/recipients` and
 * `POST …/postcards` both authenticate through `isOwner(user, request)`, which
 * accepts the owner's session cookie as readily as an agent's bearer token —
 * so the browser is simply another owner, and every guard those routes carry
 * applies here unchanged. That is also why this component can be wrong about
 * who is allowed to see it without being dangerous: the server does not take
 * its word for anything.
 *
 * ## Why the message is prefilled from the day, and only prefilled
 *
 * The photograph is chosen and the people are a list of checkboxes; the words
 * are the only real work, and starting from a blank box at the moment somebody
 * wanted this to be easy is how a feature goes unused. So it opens with the
 * day's own beginning, fetched from `/{user}/day/<slug>.md` — the markdown twin
 * that already exists and needs no new endpoint — trimmed to what fits on a
 * card.
 *
 * It is a **prefill and not a default**: the text is editable, and what gets
 * printed is whatever is in the box when the button is pressed. A journal entry
 * is written for everybody who reads the site; a postcard is read by one person
 * who knows you, and those are not the same words. The trim is a starting
 * point to correct, not a suggestion to accept.
 */

/** The API's own cap, repeated so the box can say so before the server does. */
const MAX_MESSAGE = 600;

type Candidate = { contactId: string; name: string; city: string; country: string | null };

export default function PostcardSheet({
  username,
  trip,
  tile,
  from,
  onClose,
}: {
  username: string;
  /** The trip id — the API takes the id, not the qualified ref. */
  trip: string;
  tile: MediaTile;
  /** The signature on the card. The journal's own name for its author, read
   * from `config.json` on the server — not a field here, because it is the
   * same string every time and one more box between somebody and the thing
   * they wanted to do. Correcting it is the preview page's job, or an
   * agent's. */
  from: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [creditsEach, setCreditsEach] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/${username}/postcards/recipients`);
      if (!res.ok || !live) return;
      const body = (await res.json()) as { recipients: Candidate[]; creditsEach: number };
      if (!live) return;
      setCandidates(body.recipients);
      setCreditsEach(body.creditsEach);
    })().catch(() => {
      if (live) setCandidates([]);
    });
    return () => {
      live = false;
    };
  }, [username]);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch(`/${username}/day/${tile.slug}.md`);
      if (!res.ok || !live) return;
      const text = await res.text();
      if (live) setMessage(openingOf(text));
    })().catch(() => {
      // No twin, or offline. An empty box is a fine place to start and a
      // failure to prefill is not a failure to compose.
    });
    return () => {
      live = false;
    };
  }, [username, tile.slug]);

  const total = creditsEach * chosen.length;
  const ready = chosen.length > 0 && message.trim().length > 0 && !busy;

  async function create() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/${username}/postcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip,
          day: tile.slug,
          photo: photoPathOf(tile.src, username, trip),
          message: message.trim(),
          from,
          recipients: chosen,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { url: string };
      // Leaves this page entirely. The next thing the owner sees is the
      // preview, with the button on it — which is the handover this whole
      // component exists to perform.
      window.location.assign(body.url);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-900/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("postcard.title")}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-navy-900">
            {t("postcard.title")}
          </h2>
          <button
            aria-label={t("postcard.cancel")}
            onClick={onClose}
            className="rounded-full p-1.5 text-navy-500 hover:bg-navy-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mt-4 block text-sm font-semibold text-navy-700">
          {t("postcard.messageLabel")}
          <textarea
            value={message}
            maxLength={MAX_MESSAGE}
            rows={5}
            placeholder={t("postcard.messagePlaceholder")}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-1 w-full rounded-lg border border-navy-200 p-2.5 text-sm font-normal text-navy-900"
          />
        </label>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-navy-700">
            {t("postcard.recipientsLabel")}
          </legend>
          {candidates !== null && candidates.length === 0 ? (
            <p className="mt-1 text-sm text-navy-600">{t("postcard.noRecipients")}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {(candidates ?? []).map((c) => (
                <li key={c.contactId}>
                  <label className="flex items-center gap-2 text-sm text-navy-800">
                    <input
                      type="checkbox"
                      checked={chosen.includes(c.contactId)}
                      onChange={(e) =>
                        setChosen((was) =>
                          e.target.checked
                            ? [...was, c.contactId]
                            : was.filter((id) => id !== c.contactId),
                        )
                      }
                    />
                    {/* A town, never a street. The full address is behind a
                        disclosure on the preview page, which is where somebody
                        is actually checking an envelope. */}
                    {c.name} — {c.city}
                    {c.country ? `, ${c.country}` : ""}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {failed && <p className="mt-3 text-sm text-navy-800">{t("postcard.failed")}</p>}

        <p className="mt-4 text-sm font-semibold text-navy-900">
          {t("postcard.cost", { credits: String(total) })}
        </p>
        <p className="mt-1 text-xs text-navy-600">{t("postcard.nextStep")}</p>

        <button
          onClick={create}
          disabled={!ready}
          className="mt-3 min-h-11 w-full rounded-full bg-navy-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-700 disabled:opacity-40"
        >
          {busy ? t("postcard.creating") : t("postcard.create")}
        </button>
      </div>
    </div>
  );
}

/**
 * The day's opening, short enough for a card.
 *
 * The twin is the file on disk: frontmatter, then prose. Drop the frontmatter,
 * drop headings and image lines, and take whole sentences until there is no
 * room for another — cutting mid-word would look like a bug in the box the
 * owner is about to edit.
 */
export function openingOf(markdown: string, limit = 320): string {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const prose = body
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#") && !line.trim().startsWith("!["))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (prose.length <= limit) return prose;
  const cut = prose.slice(0, limit);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 0 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" "));
}

/**
 * The tile's `src` back to a path inside the trip's media directory.
 *
 * `mediaUrl` builds `/{user}/media/{tripId}/{path}`; the order API wants the
 * `{path}`. Written as a prefix strip rather than "take everything after the
 * third slash", so a URL that is not the shape we expect returns something the
 * server will reject by name instead of a plausible-looking wrong file.
 */
export function photoPathOf(src: string, username: string, trip: string): string {
  const prefix = `/${username}/media/${trip}/`;
  return src.startsWith(prefix) ? src.slice(prefix.length) : src;
}
