"use client";

import { useState } from "react";
import { CATEGORY_STYLE } from "@/lib/costFormat";
import type { AdminContact, AdminGroup, Translate } from "./shared";

/**
 * Reader groups on Studio › Readers — TIX-6. The owner's own labels for who
 * reads along, one per person, so a day can be told to some of them.
 *
 * Every write goes through `/api/web/<user>/groups*` or `…/readers/group`,
 * which check the owner again; the page is re-read afterwards (`refresh`), so
 * the browser never keeps a second copy that can drift from what is stored.
 */

/** The validated categorical palette (`lib/costFormat`), in its checked
 * order — a group's `color` is an index into it, never a raw colour. */
const PALETTE = Object.values(CATEGORY_STYLE).map((style) => style.color);

function groupColor(color: number): string {
  return PALETTE[color % PALETTE.length];
}

/** "All", a group's id, or "none" — which people the page is showing. */
export type GroupFilter = "all" | "none" | string;

export function matchesFilter(contact: AdminContact, filter: GroupFilter, groups: AdminGroup[]): boolean {
  if (filter === "all") return true;
  const known = contact.groupId && groups.some((group) => group.id === contact.groupId) ? contact.groupId : null;
  return filter === "none" ? known === null : known === filter;
}

export function GroupDot({ group, size = 10 }: { group: AdminGroup | null; size?: number }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${group ? "" : "border-[1.5px] border-line-strong"}`}
      style={{ width: size, height: size, ...(group ? { backgroundColor: groupColor(group.color) } : {}) }}
    />
  );
}

const CHIP = "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-sm font-semibold";
const CHIP_ON = `${CHIP} border-line-ink bg-action-strong text-on-action`;
const CHIP_OFF = `${CHIP} border-line-strong bg-surface-raised text-ink-strong hover:bg-surface-subtle`;

/**
 * One group, or none, as a row of radio chips — Add a person, Create a link,
 * and a card's own "Move to a group". Says nothing at all while the owner has
 * no groups: the strip above the lists is where the first one is made.
 */
export function GroupPicker({
  groups,
  value,
  onChange,
  legend,
  hint,
  noneLabel,
  name,
}: {
  groups: AdminGroup[];
  value: string | null;
  onChange: (value: string | null) => void;
  legend: string;
  hint?: string;
  /** The "No group" chip. */
  noneLabel: string;
  /** The radio group's name, unique on the page. */
  name: string;
}) {
  if (groups.length === 0) return null;
  const choices: (AdminGroup | null)[] = [...groups, null];
  return (
    <fieldset>
      <legend className="block text-sm font-semibold text-ink-strong">
        {legend}
        {hint && <span className="font-normal text-ink-secondary"> · {hint}</span>}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {choices.map((group) => {
          const id = group?.id ?? null;
          const on = value === id;
          return (
            <label key={id ?? "none"} className={on ? CHIP_ON : CHIP_OFF}>
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={on}
                onChange={() => onChange(id)}
              />
              <GroupDot group={group} />
              {group ? group.name : noneLabel}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The strip above the lists: a first-time suggestion, the filter chips, and
 * the panel that renames, recolours, adds and deletes — with Undo on delete,
 * because deleting a group lets go of everybody in it at once.
 */
export function GroupsBar({
  username,
  groups,
  contacts,
  filter,
  onFilter,
  t,
  refresh,
}: {
  username: string;
  groups: AdminGroup[];
  contacts: AdminContact[];
  filter: GroupFilter;
  onFilter: (filter: GroupFilter) => void;
  t: Translate;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ group: AdminGroup; members: unknown } | null>(null);
  const base = `/api/web/${encodeURIComponent(username)}/groups`;

  async function send(url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const code = typeof json.error === "string" ? json.error : "";
        setError(
          code === "duplicate_name" || code === "invalid_name" || code === "too_many"
            ? t(`readers.groups.error.${code}`)
            : t("contact.ownerActionFailed"),
        );
        return null;
      }
      return json;
    } catch {
      setError(t("contact.ownerActionFailed"));
      return null;
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function add(name: string) {
    if (!name.trim()) return;
    if (await send(base, "POST", { name })) setDraft("");
  }

  async function remove(group: AdminGroup) {
    const answer = await send(`${base}/${encodeURIComponent(group.id)}`, "DELETE");
    if (answer) {
      setDeleted({ group, members: answer.members });
      if (filter === group.id) onFilter("all");
    }
  }

  async function undo() {
    if (!deleted) return;
    const { group, members } = deleted;
    setDeleted(null);
    await send(base, "POST", { name: group.name, color: group.color, members });
  }

  const live = contacts.filter((contact) => contact.status !== "blocked");
  const count = (id: string | null) =>
    live.filter((contact) => (contact.groupId && groups.some((g) => g.id === contact.groupId) ? contact.groupId : null) === id).length;
  const suggestions = [t("readers.groups.suggest.family"), t("readers.groups.suggest.friends"), t("readers.groups.suggest.work")].filter(
    (name) => !groups.some((group) => group.name.toLowerCase() === name.toLowerCase()),
  );

  return (
    <section className="mt-10" aria-labelledby="reader-groups-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="reader-groups-title" className="font-display text-lg font-semibold text-ink-strong">
          {t("readers.groups.title")}
        </h2>
        {groups.length > 0 && (
          <button
            type="button"
            aria-expanded={editing}
            onClick={() => {
              setEditing(!editing);
              setDeleted(null);
              setError(null);
            }}
            className="min-h-11 text-sm font-semibold text-ink-body underline underline-offset-2"
          >
            {editing ? t("readers.groups.done") : t("readers.groups.edit")}
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <>
          <p className="mt-2 text-sm text-ink-secondary">{t("readers.groups.intro")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                disabled={busy}
                onClick={() => void add(name)}
                className="min-h-11 rounded-full border border-dashed border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50"
              >
                + {name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div role="radiogroup" aria-label={t("readers.groups.filterLabel")} className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {(["all", ...groups.map((group) => group.id), "none"] as GroupFilter[]).map((id) => {
            const group = groups.find((g) => g.id === id) ?? null;
            const label =
              id === "all" ? t("readers.groups.all") : id === "none" ? t("readers.groups.none") : (group?.name ?? "");
            const n = id === "all" ? live.length : count(id === "none" ? null : id);
            const on = filter === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={on} onClick={() => onFilter(id)} className={on ? CHIP_ON : CHIP_OFF}>
                {id !== "all" && <GroupDot group={group} size={8} />}
                {label}
                <span className={on ? "opacity-80" : "text-ink-secondary"}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {editing && groups.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-line-strong bg-surface-raised">
          <ul>
            {groups.map((group) => (
              <GroupRow key={group.id} group={group} people={count(group.id)} base={base} t={t} busy={busy} send={send} onDelete={remove} />
            ))}
          </ul>
          <form
            className="flex gap-2 border-t border-line-quiet bg-surface-base p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void add(draft);
            }}
          >
            <label className="sr-only" htmlFor="new-reader-group">
              {t("readers.groups.newLabel")}
            </label>
            <input
              id="new-reader-group"
              value={draft}
              maxLength={30}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("readers.groups.newPlaceholder")}
              className="min-h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-surface-raised px-4 text-base text-ink-body"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="min-h-11 rounded-full bg-action-strong px-4 text-sm font-semibold text-on-action disabled:opacity-50"
            >
              {t("readers.groups.addButton")}
            </button>
          </form>
        </div>
      )}
      {editing && <p className="mt-2 text-xs text-ink-secondary">{t("readers.groups.deleteNote")}</p>}
      {deleted && (
        <p role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-subtle px-4 py-2 text-sm text-ink-body">
          {t("readers.groups.deleted", { name: deleted.group.name })}
          <button type="button" onClick={() => void undo()} className="min-h-11 font-semibold text-ink-strong underline underline-offset-2">
            {t("readers.groups.undo")}
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-coral-600">
          {error}
        </p>
      )}
    </section>
  );
}

function GroupRow({
  group,
  people,
  base,
  t,
  busy,
  send,
  onDelete,
}: {
  group: AdminGroup;
  people: number;
  base: string;
  t: Translate;
  busy: boolean;
  send: (url: string, method: string, body?: unknown) => Promise<Record<string, unknown> | null>;
  onDelete: (group: AdminGroup) => void;
}) {
  const [name, setName] = useState(group.name);
  const url = `${base}/${encodeURIComponent(group.id)}`;
  const inputId = `group-name-${group.id}`;
  function rename() {
    if (name.trim() && name.trim() !== group.name) void send(url, "PATCH", { name });
    else setName(group.name);
  }
  return (
    <li className="flex min-h-14 items-center gap-2 border-b border-line-quiet px-3 py-1 last:border-b-0">
      <button
        type="button"
        disabled={busy}
        aria-label={t("readers.groups.colorLabel", { name: group.name })}
        onClick={() => void send(url, "PATCH", { color: (group.color + 1) % PALETTE.length })}
        className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-surface-subtle"
      >
        <GroupDot group={group} size={16} />
      </button>
      <label className="sr-only" htmlFor={inputId}>
        {t("readers.groups.nameLabel", { name: group.name })}
      </label>
      <input
        id={inputId}
        value={name}
        maxLength={30}
        onChange={(event) => setName(event.target.value)}
        onBlur={rename}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            rename();
          }
        }}
        className="min-h-11 min-w-0 flex-1 bg-transparent text-base font-semibold text-ink-strong"
      />
      <span className="whitespace-nowrap text-xs text-ink-secondary">{people}</span>
      <button
        type="button"
        disabled={busy}
        aria-label={t("readers.groups.delete", { name: group.name })}
        onClick={() => onDelete(group)}
        className="grid size-11 shrink-0 place-items-center rounded-full text-lg text-coral-600 hover:bg-surface-subtle"
      >
        ×
      </button>
    </li>
  );
}
