import { authenticate, errorResponse, outOfScope, ownsUser } from "@/lib/api/auth";
import { SESSION_SCOPE } from "@/lib/auth";
import { findInboxFile } from "@/lib/inbox";
import {
  IMPORT_KINDS,
  importFormats,
  importGps,
  isRefusal,
  type ImportKind,
} from "@/lib/gps/api";
import { readStatement } from "@/lib/statements/read";
import { storageRefusal } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";
import { REQUEST_MAX_BYTES } from "@/lib/validate/media";
import fs from "node:fs";

export const dynamic = "force-dynamic";

/**
 * Importing somebody's own data — B671.
 *
 * One door, keyed by **kind** and **format**. `kind` is what the data *is* —
 * `gps` for a location history, `costs` for a bank statement — and `format` is
 * who wrote it (`google-timeline`, `gpx`, `revolut`, …). The second kind
 * arrived in B677 and needed no second route, which is what the shape was for.
 *
 * **The two kinds end differently, and that is deliberate.** Positions are
 * written into the journal's store as they are read: a coordinate is a
 * measurement, and there is nothing about it to decide. A statement is read
 * and *reported* — it covers the trip and the fortnight either side of it, and
 * what each line was for is an editorial decision. Nothing reaches a trip
 * until a person sends rows back to `POST …/trips/<trip>/costs/import`.
 *
 * There was a CLI for this and it is gone. The owner of a hosted journal has
 * no shell on the machine, and an agent never has one, so a capability whose
 * only door was `npm run` was a capability those two people did not have. Two
 * doors would have been worse than either: the unexercised one is the one that
 * rots.
 *
 * **What comes back is never a position.** This route writes; nothing here or
 * anywhere else hands a fix back over HTTP. The store is a person's whole life
 * of movement, and what the site draws is the *derived* line for one trip —
 * see `lib/gps/store.ts` for the full shape and `POST …/trips/<trip>/track`
 * for the other half of this loop.
 *
 * **Owner only.** The store belongs to the journal rather than to a trip, so a
 * trip-scoped token is refused: somebody who came on one trip must not be able
 * to write into — or derive from — the owner's whole history.
 */

/** A trip-scoped token, told why not and what it may do instead. */
function needsJournalScope(user: string): Response {
  return Response.json(
    {
      error: "out_of_scope",
      message:
        "This token is scoped to one trip. A location history belongs to the whole journal " +
        "and covers every day of somebody's life, not only the days you were there, so it " +
        `is the owner's to import. Ask them to run this call, or to send you ` +
        `\`POST /api/v1/${user}/trips/<trip>/track\` output once they have.`,
    },
    { status: 403 },
  );
}

export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/import">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);
  if (auth.session.scope !== SESSION_SCOPE.agent) return needsJournalScope(user);

  // Formats, never data. This is the one `GET` in the whole feature and it
  // describes the door rather than what is behind it.
  return Response.json({
    user,
    kinds: importFormats(),
    maxBytes: REQUEST_MAX_BYTES,
    next:
      `Put the export in the inbox (\`POST /api/v1/${user}/inbox\`, kind \`files\`), then ` +
      `\`POST /api/v1/${user}/import\` with \`{"kind": "…", "inbox": "<id>"}\`. Say the kind; ` +
      "leave `format` out and the file is recognised from its own contents. " +
      `A \`gps\` import is stored as it is read, and \`POST /api/v1/${user}/trips/<trip>/track\` ` +
      "then draws one trip's line from it. A `costs` import writes nothing at all: it " +
      "reports the payments, you agree the categories with the person, and " +
      `\`POST /api/v1/${user}/trips/<trip>/costs/import\` puts the agreed rows on the days.`,
  });
}

type Body = {
  from?: unknown;
  to?: unknown;
  kind?: unknown;
  format?: unknown;
  inbox?: unknown;
  dryRun?: unknown;
  text?: unknown;
};

/** The bytes, from whichever of the three doors was used. */
async function bytesFrom(
  request: Request,
  user: string,
): Promise<
  | { text: string; filename: string; body: Body }
  | { error: Response }
> {
  const type = request.headers.get("content-type") ?? "";

  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File))
      return {
        error: Response.json(
          {
            error: "expected_file",
            hint:
              "multipart/form-data with the export under `file`, plus `kind` and optionally " +
              "`format`. Or send JSON naming a file already in the inbox.",
          },
          { status: 400 },
        ),
      };
    return {
      text: await file.text(),
      filename: file.name || "upload",
      body: {
        kind: form.get("kind") ?? undefined,
        format: form.get("format") ?? undefined,
        dryRun: form.get("dryRun") === "true",
      },
    };
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object")
    return {
      error: Response.json(
        {
          error: "invalid_body",
          hint:
            '{"kind": "gps", "inbox": "<id from POST /inbox>"} — or multipart/form-data with ' +
            "the file under `file`.",
        },
        { status: 400 },
      ),
    };

  if (typeof body.inbox === "string") {
    const found = findInboxFile(user, body.inbox);
    if (!found)
      return {
        error: Response.json(
          {
            error: "unknown_inbox_file",
            message:
              `Nothing in the inbox with id ${JSON.stringify(body.inbox)}. ` +
              `\`GET /api/v1/${user}/inbox\` lists what is there.`,
          },
          { status: 404 },
        ),
      };
    return {
      text: fs.readFileSync(found.file, "utf8"),
      filename: found.entry.filename,
      body,
    };
  }

  // A small export pasted straight in. Handy for a handful of fixes; the
  // inbox is the path for a real one.
  //
  // The name it is given carries no extension **on purpose**. Called
  // "inline.jsonl" it was recognised as the `fixes` format by its name alone,
  // whatever was actually in it — so a pasted CSV came back complaining that
  // JSON Lines contained no positions rather than that nothing recognised it.
  // With no extension, detection has to read the contents, which is the only
  // honest thing to go on here.
  if (typeof body.text === "string")
    return { text: body.text, filename: "inline", body };

  return {
    error: Response.json(
      {
        error: "no_file",
        message:
          "Name a file with `inbox`, send one as multipart `file`, or put a few lines in " +
          "`text`. The inbox is the normal path: upload once, import once, and the file " +
          "stays there for you to delete when you are done with it.",
      },
      { status: 400 },
    ),
  };
}

export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/import">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);
  if (auth.session.scope !== SESSION_SCOPE.agent) return needsJournalScope(user);
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });

  // Before the body is touched, like the media and inbox routes.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REQUEST_MAX_BYTES) {
    return Response.json(
      {
        error: "body_too_large",
        message:
          `The whole request may be ${(REQUEST_MAX_BYTES / 1024 / 1024).toFixed(0)} MB. ` +
          "A years-long export is bigger than that — put it in the inbox in pieces, or " +
          "split it by month and import each one; the store merges and thins across calls.",
      },
      { status: 413 },
    );
  }

  const source = await bytesFrom(request, user);
  if ("error" in source) return source.error;
  const { text, filename, body } = source;

  const kind = typeof body.kind === "string" ? body.kind : undefined;
  if (kind === undefined || !(IMPORT_KINDS as readonly string[]).includes(kind)) {
    // **Absent is refused, not guessed.** While there was one kind this
    // defaulted to it, which was fine and stopped being fine the moment a
    // second arrived (B677): reading somebody's bank statement as positions,
    // or their location history as money, is not a mistake to make quietly.
    return Response.json(
      {
        error: "unknown_kind",
        message:
          (kind === undefined
            ? "Say what kind of data this is. "
            : `No such kind ${JSON.stringify(kind)}. `) +
          `Known kinds: ${IMPORT_KINDS.join(", ")}. A kind is what the data *is*; the ` +
          `format is who wrote it. GET /api/v1/${user}/import lists both.`,
      },
      { status: 400 },
    );
  }
  const chosenKind = kind as ImportKind;

  const dryRun = body.dryRun === true;
  if (!dryRun) {
    // B661's ceiling, before anything is written — the store is inside it.
    // Measured against the file, which overstates it: thinning usually keeps
    // well under half. Overstating is the right way round for a check made
    // before the work.
    const refusal = await storageRefusal(user, Buffer.byteLength(text));
    if (refusal) {
      return Response.json({ error: "storage_full", message: refusal }, { status: 400 });
    }
  }

  const format = typeof body.format === "string" ? body.format : undefined;

  if (chosenKind === "costs") {
    // A statement is read and reported, never written into a trip by itself —
    // it covers the trip and the fortnight either side of it, and the category
    // on each line is a person's decision. `dryRun` therefore changes nothing
    // here, and saying so is more honest than accepting it silently.
    const statement = readStatement(text, filename, {
      format,
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
    });
    if ("refusal" in statement) {
      return Response.json(
        { error: statement.refusal, message: statement.message, problems: statement.problems },
        { status: 400 },
      );
    }
    return Response.json({
      ...statement,
      next:
        `Nothing has been written. Agree the categories — one decision per merchant covers ` +
        `every payment to it, and the list is sorted biggest first — then send the rows to ` +
        `POST /api/v1/${user}/trips/<trip>/costs/import. Never choose a category yourself: ` +
        "a statement says what was paid, never what it was for." +
        (Object.keys(statement.rates).length > 0
          ? ` The rates above are what the money actually cost; PUT them to ` +
            `/api/v1/${user}/trips/<trip>/rates if the trip has none.`
          : ""),
    });
  }

  const result = importGps(user, text, filename, { format, dryRun });

  if (isRefusal(result)) {
    return Response.json(
      { error: result.refusal, message: result.message, problems: result.problems },
      { status: 400 },
    );
  }

  return Response.json({
    ...result,
    kind: chosenKind,
    dryRun,
    next: dryRun
      ? "Nothing was written. Send the same call without `dryRun` to keep it."
      : `Now \`POST /api/v1/${user}/trips/<trip>/track\` for each trip whose map should show ` +
        "where you actually went. Nothing is drawn until you do — and the export is still " +
        `in the inbox: \`DELETE /api/v1/${user}/inbox/<id>\` when you are done with it, ` +
        "because it is the unthinned original of your whole location history.",
  });
}
