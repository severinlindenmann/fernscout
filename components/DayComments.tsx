"use client";

import { useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { CommentsError, useComments } from "./CommentsProvider";
import { useI18n } from "./LocaleProvider";

/** Latest comments shown before "Show all". Matches the server's default page. */
const SHOWN = 3;

const FIELD =
  "w-full rounded-xl border border-line-strong bg-surface-raised p-3 text-base text-ink-body focus-visible:outline-2 focus-visible:outline-offset-2";
const PRIMARY =
  "min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 hover:bg-yellow-300 disabled:opacity-50";
const SECONDARY =
  "min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle disabled:opacity-50";
const LINK = "min-h-11 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Comments under a day, written by the journal's invited guests and its owner.
 * Sits under `DayReactions`. Renders nothing at all unless the server gave this
 * viewer comments: flag off, not invited, or an identity-only cookie all leave
 * the day `hidden`, with no count and no text.
 */
export default function DayComments({ daySlug }: { daySlug: string }) {
  const { t, tn } = useI18n();
  const comments = useComments();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = comments?.load;
  useEffect(() => {
    void load?.(daySlug);
  }, [load, daySlug]);

  if (!comments) return null;
  const state = comments.stateFor(daySlug);
  if (state.status === "hidden") return null;

  const shownCount = expanded ? state.comments.length : Math.min(SHOWN, state.comments.length);
  const visible = state.comments.slice(state.comments.length - shownCount);
  const canExpand = !expanded && state.total > SHOWN;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      const code = err instanceof CommentsError ? err.code : "failed";
      if (code === "rate_limited") {
        const minutes = Math.max(1, Math.ceil(((err as CommentsError).retryAfter ?? 60) / 60));
        setError(t("comments.rateLimited", { minutes: String(minutes) }));
      } else if (code === "too_long") setError(t("comments.tooLong", { max: String(state.maxLength) }));
      else if (code === "offline") setError(t("comments.offline"));
      else setError(t("comments.error"));
    } finally {
      setBusy(false);
    }
  }

  function showAll() {
    setExpanded(true);
    if (state.comments.length < state.total) void comments?.load(daySlug, true);
  }

  return (
    <section aria-label={t("comments.title")} className="mt-4">
      <h3 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-muted">
        {state.status === "loading" ? t("comments.title") : tn("comments.count", state.total, { count: String(state.total) })}
      </h3>

      {state.status === "loading" && <p className="mt-2 text-sm text-ink-secondary">{t("comments.loading")}</p>}
      {state.status === "offline" && (
        <p role="status" className="mt-2 text-sm text-ink-secondary">
          {t("comments.offline")}
        </p>
      )}
      {state.status === "ready" && state.total === 0 && (
        <p className="mt-2 text-sm text-ink-secondary">{t("comments.empty")}</p>
      )}

      {canExpand && (
        <button type="button" onClick={showAll} className={`mt-1 text-sm font-semibold text-ink-body ${LINK}`}>
          {t("comments.showAll", { count: String(state.total) })}
        </button>
      )}
      {expanded && state.total > SHOWN && (
        <button type="button" onClick={() => setExpanded(false)} className={`mt-1 text-sm font-semibold text-ink-body ${LINK}`}>
          {t("comments.showFewer")}
        </button>
      )}

      <ul className="mt-2 space-y-4">
        {visible.map((c) => (
          <li key={c.id} className="flex gap-3">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle font-display text-sm font-semibold text-ink-strong"
            >
              {c.author.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm text-ink-secondary">
                <span className="font-display font-semibold text-ink-strong">{c.author}</span>
                {" · "}
                <time dateTime={c.at}>{new Date(c.at).toLocaleDateString()}</time>
                {c.edited && <span> · {t("comments.edited")}</span>}
              </p>

              {editing === c.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await comments.edit(daySlug, c.id, editDraft);
                      setEditing(null);
                    });
                  }}
                  className="mt-1"
                >
                  <label htmlFor={`comment-edit-${c.id}`} className="sr-only">
                    {t("comments.edit")}
                  </label>
                  <textarea
                    id={`comment-edit-${c.id}`}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={3}
                    className={FIELD}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <BusyButton busy={busy} disabled={!editDraft.trim()} type="submit" className={PRIMARY}>
                      {t("comments.save")}
                    </BusyButton>
                    <button type="button" onClick={() => setEditing(null)} className={SECONDARY}>
                      {t("me.cancel")}
                    </button>
                  </div>
                  {error && (
                    <p role="alert" className="mt-2 text-sm text-coral-600">
                      {error}
                    </p>
                  )}
                </form>
              ) : (
                <p className="mt-0.5 whitespace-pre-line break-words text-base leading-6 text-ink-body">{c.body}</p>
              )}

              {editing !== c.id && (c.mine || state.isOwner) && (
                <p className="mt-1 flex gap-4 text-sm text-ink-secondary">
                  {c.mine && (
                    <button
                      type="button"
                      className={LINK}
                      onClick={() => {
                        setEditDraft(c.body);
                        setError("");
                        setEditing(c.id);
                      }}
                    >
                      {t("comments.edit")}
                    </button>
                  )}
                  <button
                    type="button"
                    className={LINK}
                    onClick={() => {
                      setError("");
                      setDeleting(c.id);
                    }}
                  >
                    {t("comments.delete")}
                  </button>
                </p>
              )}

              {deleting === c.id && (
                <ConfirmPanel
                  label={t("comments.delete")}
                  question={t("comments.deleteQuestion", { name: c.author })}
                  confirmLabel={t("comments.deleteConfirm")}
                  busyLabel={t("comments.deleting")}
                  tone="destructive"
                  busy={busy}
                  error={error}
                  onConfirm={() =>
                    void run(async () => {
                      await comments.remove(daySlug, c.id);
                      setDeleting(null);
                    })
                  }
                  onCancel={() => setDeleting(null)}
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      {state.status !== "loading" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await comments.post(daySlug, draft);
              setDraft("");
            });
          }}
          className="mt-4"
        >
          <label htmlFor={`day-comment-${daySlug}`} className="sr-only">
            {t("comments.write")}
          </label>
          <textarea
            id={`day-comment-${daySlug}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={t("comments.write")}
            className={FIELD}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className={`text-xs tabular-nums ${draft.length > state.maxLength ? "text-coral-600" : "text-ink-secondary"}`}>
              {draft.length} / {state.maxLength}
            </span>
            <BusyButton busy={busy} disabled={!draft.trim()} type="submit" busyLabel={t("comments.posting")} className={PRIMARY}>
              {t("comments.post")}
            </BusyButton>
          </div>
          {error && !deleting && editing === null && (
            <p role="alert" className="mt-2 text-sm text-coral-600">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
