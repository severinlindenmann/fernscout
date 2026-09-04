import { authenticate, errorResponse, ownsUser } from "@/lib/api/auth";
import { SESSION_SCOPE } from "@/lib/auth";
import { DELETION_TTL_MINUTES, humanBytes, requestDeletion } from "@/lib/deletions";
import { journalTombstone } from "@/lib/tombstones";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Delete a journal — or rather, ask to.
 *
 * `POST /api/v1/journals` makes one in a minute and, until this, nothing could
 * remove it: the way back was a shell on the server, and with
 * `MAX_JOURNALS_PER_EMAIL` at three, three abandoned experiments were a
 * permanent ceiling on somebody who could not delete any of them.
 *
 * **This deletes nothing.** It answers `202`, and mails the address in the
 * journal's own `config.json` a link to a page with a button on it. The
 * confirmation deliberately does not use `lib/agentConfirm.ts`: that code is
 * not single-use and it goes to the *agent*, so an agent could complete both
 * halves on its own. Here the second half happens in a mailbox, which is a
 * place no agent holding this token can reach.
 *
 * An agent reading a `202` here has not deleted anything, and must not say it
 * has. The body says so in as many words.
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/v1/[user]">) {
  const { user } = await params;

  // Answered before the token is looked at, and deliberately so: deleting a
  // journal revokes every session it had, so an agent retrying its own call
  // would otherwise read "invalid token" — true, and useless — rather than
  // "this is gone". Nothing is disclosed that the journal's own URL does not
  // already say with a 410.
  const stone = journalTombstone(user);
  if (stone && !getUser(user)) {
    return Response.json(
      {
        error: "gone",
        message: `"${user}" was deleted on ${stone.deletedAt.slice(0, 10)}. There is nothing left to delete.`,
      },
      { status: 410 },
    );
  }

  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  // The owner, and nobody else. Somebody listed in a trip's `people:` holds a
  // `write:trip:<id>` scope — they may write days into that trip, which is not
  // the same authority as removing the journal it sits in.
  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip. Writing to a trip and deleting the journal " +
          "around it are different authorities — only the journal's owner can do this.",
      },
      { status: 403 },
    );
  }

  const asked = await requestDeletion({ kind: "journal", username: user }, { sessionId: auth.session.id });
  if (!asked.ok) {
    return Response.json({ error: asked.error, message: asked.message }, { status: asked.status });
  }

  const { summary } = asked;
  return Response.json(
    {
      ok: true,
      deleted: false,
      status: "confirmation_sent",
      mailedTo: asked.email,
      expires: asked.expiresAt,
      willDelete: {
        journal: summary.title,
        trips: summary.trips,
        days: summary.days,
        files: summary.files,
        size: humanBytes(summary.bytes),
      },
      note:
        "NOTHING HAS BEEN DELETED. A mail has gone to the address that owns this journal " +
        `(${asked.email}) with a link to a page that asks once more and has a button on it. ` +
        `The link works for ${DELETION_TTL_MINUTES} minutes and once only. You cannot follow ` +
        "it yourself and you should not try — this step exists so that a person, not an " +
        "agent, ends a journal.",
      next:
        `Tell the person you were talking to that a mail is waiting at ${asked.email}, and ` +
        "that the journal is still there until they open it and press the button. Do not " +
        "report this as deleted.",
    },
    { status: 202 },
  );
}

/**
 * A wrong verb, answered in words — B293. See the twin on the trip route.
 *
 * `PATCH /api/v1/<user>` is the natural guess for "change something about this
 * journal", and the real door is one segment further on. A bare `405` told
 * nobody that.
 */
export async function PATCH(_request: Request, { params }: RouteContext<"/api/v1/[user]">) {
  const { user } = await params;
  return Response.json(
    {
      error: "method_not_allowed",
      message:
        `This route takes DELETE and nothing else. To change a journal's title, tagline, ` +
        `visibility, languages or currencies, use PATCH /api/v1/${user}/config. A journal's ` +
        `features are not writable through any door — see /agent.md.`,
    },
    { status: 405, headers: { Allow: "DELETE" } },
  );
}
