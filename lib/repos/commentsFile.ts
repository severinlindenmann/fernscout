import { readStore, updateStore } from "../store";
import { newId, nowIso } from "../db/owner";
import type { CommentRepo, StoredComment } from "./types";

const FILE = "comments";
const EMPTY: StoredComment[] = [];

const sameDay = (c: StoredComment, tripId: string, daySlug: string) =>
  c.tripId === tripId && c.daySlug === daySlug;

/** Comments on the JSON file store (the no-database deployment). */
export function fileCommentRepo(): CommentRepo {
  return {
    async list(tripId, daySlug, limit) {
      const all = (await readStore<StoredComment[]>(FILE, EMPTY))
        .filter((c) => sameDay(c, tripId, daySlug))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { comments: limit === undefined ? all : all.slice(-limit), total: all.length };
    },

    async get(tripId, daySlug, id) {
      const all = await readStore<StoredComment[]>(FILE, EMPTY);
      return all.find((c) => c.id === id && sameDay(c, tripId, daySlug)) ?? null;
    },

    async add(comment) {
      const stored: StoredComment = { ...comment, id: newId(), editedAt: null };
      await updateStore<StoredComment[]>(FILE, EMPTY, (all) => [...all, stored]);
      return stored;
    },

    async update(tripId, daySlug, id, body) {
      let out: StoredComment | null = null;
      await updateStore<StoredComment[]>(FILE, EMPTY, (all) =>
        all.map((c) => {
          if (c.id !== id || !sameDay(c, tripId, daySlug)) return c;
          out = { ...c, body, editedAt: nowIso() };
          return out;
        }),
      );
      return out;
    },

    async remove(tripId, daySlug, id) {
      let removed = false;
      await updateStore<StoredComment[]>(FILE, EMPTY, (all) =>
        all.filter((c) => {
          const hit = c.id === id && sameDay(c, tripId, daySlug);
          if (hit) removed = true;
          return !hit;
        }),
      );
      return removed;
    },

    async countByAuthorSince(tripId, authorEmail, sinceIso) {
      const all = await readStore<StoredComment[]>(FILE, EMPTY);
      return all.filter((c) => c.tripId === tripId && c.authorEmail === authorEmail && c.createdAt >= sinceIso).length;
    },
  };
}
