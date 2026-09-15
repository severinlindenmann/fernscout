"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

export type NonPhotoKind = "location" | "contacts" | "costs";

type InboxItem = { id: string; filename: string };
type InboxUploadResponse = { ok?: true; items?: InboxItem[]; error?: string; message?: string };
type GpsImportResponse = {
  ok?: true;
  read?: number;
  from?: string;
  to?: string;
  held?: number;
  error?: string;
  message?: string;
};
type StatementResponse = {
  ok?: true;
  format?: string;
  label?: string;
  sample?: unknown[];
  problems?: unknown[];
  error?: string;
};

/** A route error code mapped to what to say about it — the ones a person
 *  uploading one file is actually likely to meet. Everything else falls back
 *  to a generic "couldn't read this file" rather than a raw error code. */
const ERROR_KEYS: Record<string, TranslationKey> = {
  consent_required: "extract.nonPhoto.error.consentRequired",
  no_credits: "extract.nonPhoto.error.noCredits",
  not_a_table: "extract.nonPhoto.error.notATable",
  model_failed: "extract.nonPhoto.error.modelFailed",
  storage_full: "extract.nonPhoto.error.storageFull",
  too_many_requests: "extract.nonPhoto.error.tooManyRequests",
  unknown_inbox_file: "extract.nonPhoto.error.generic",
};

/**
 * A plain file upload for the three importers B1797 gives a door to without
 * building a guided flow for them — location history, contacts, bank
 * statements.
 *
 * **All three stage through the same door**: `POST /api/helper/<user>/inbox`,
 * the cookie-only multipart upload the room's files pane already uses
 * (`lib/inboxUpload.ts`). What happens next differs by kind:
 *
 * - **`location`** — `POST /api/helper/<user>/import` reads the staged file
 *   and writes straight into the GPS store; there is no second "apply" call.
 *   A full round trip in the browser.
 * - **`costs`** — `POST /api/helper/<user>/statement` reads the file and
 *   reports what it found: a recognised bank's own parser needs no model at
 *   all, an unrecognised one asks a model to map its columns (behind its own
 *   `statement` consent scope and a credit) and hands back a preview.
 *   Nothing is written — `./statement/apply` writes, and it needs a trip and
 *   a category on every row, which is real editorial work this ticket does
 *   not ask this screen to do. So this kind ends at "here is what we read",
 *   same as the ticket's own words for it.
 * - **`contacts`** — **does not fit.** `POST /api/helper/<user>/contacts/import`
 *   takes already-agreed `{name, email, tel}` rows, not a file; the only
 *   thing that turns a raw vCard into rows to agree on is
 *   `readContactsFile` (`lib/contacts/readImport.ts`), reached today only
 *   through `POST /api/v2/<user>/import` — a bearer-token door, not a
 *   cookie one, and out of reach from an owner's browser session. So this
 *   kind stops at "staged" and points at `/agent`, where the existing
 *   `import_contacts` card flow already reads an inbox vCard and asks which
 *   rows to file. Flagged in the B1797 report rather than worked around.
 */
export default function NonPhotoImport({ username, kind }: { username: string; kind: NonPhotoKind }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [gps, setGps] = useState<GpsImportResponse | null>(null);
  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [staged, setStaged] = useState<InboxItem | null>(null);

  const titleKey: TranslationKey =
    kind === "location"
      ? "extract.hub.location"
      : kind === "contacts"
        ? "extract.hub.contacts"
        : "extract.hub.costs";
  const wantsKey: TranslationKey =
    kind === "location"
      ? "extract.nonPhoto.wants.location"
      : kind === "contacts"
        ? "extract.nonPhoto.wants.contacts"
        : "extract.nonPhoto.wants.costs";

  async function run() {
    if (!file) return;
    setBusy(true);
    setErrorKey(null);
    setGps(null);
    setStatement(null);
    setStaged(null);
    try {
      const body = new FormData();
      body.append("files", file, file.name);
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, {
        method: "POST",
        body,
      });
      const json = (await res.json().catch(() => null)) as InboxUploadResponse | null;
      if (!res.ok || !json?.items?.length) {
        setErrorKey(mapError(json?.error));
        return;
      }
      const item = json.items[0];
      setStaged(item);

      if (kind === "contacts") return; // Staged; see the doc comment above.

      if (kind === "location") {
        const imported = await fetch(`/api/helper/${encodeURIComponent(username)}/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inbox: item.id }),
        });
        const importedJson = (await imported.json().catch(() => null)) as GpsImportResponse | null;
        if (!imported.ok || !importedJson?.ok) {
          setErrorKey(mapError(importedJson?.error));
          return;
        }
        setGps(importedJson);
        return;
      }

      // costs
      const read = await fetch(`/api/helper/${encodeURIComponent(username)}/statement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inbox: item.id }),
      });
      const readJson = (await read.json().catch(() => null)) as StatementResponse | null;
      if (!read.ok || !readJson?.ok) {
        setErrorKey(mapError(readJson?.error));
        return;
      }
      setStatement(readJson);
    } catch {
      setErrorKey("extract.nonPhoto.error.generic");
    } finally {
      setBusy(false);
    }
  }

  const done = staged && (kind === "contacts" || gps || statement);

  return (
    // `w-full` — B1799, same fix as `ExtractFlow`'s identical root div: a
    // flex-column `<body>` child needs its own definite width or a long
    // unbreakable string anywhere below it can push this box past the
    // viewport before any nested `min-w-0 truncate` gets a chance to work.
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="font-display text-2xl font-semibold text-ink-strong">{t(titleKey)}</h1>
      <p className="mt-1 text-sm text-ink-secondary">{t(wantsKey)}</p>
      <p className="mt-1 text-xs text-ink-secondary">
        {t("extract.hub.guideHint")}{" "}
        <Link href="/docs/extract" className="font-semibold underline">
          {t("extract.hub.guideLink")}
        </Link>
      </p>

      {!done && (
        <div className="mt-5 flex flex-col gap-3">
          <input
            ref={inputRef}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-ink-body"
          />
          <BusyButton
            busy={busy}
            type="button"
            disabled={!file}
            onClick={() => void run()}
            className="min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
          >
            {t("extract.nonPhoto.upload")}
          </BusyButton>
        </div>
      )}

      {errorKey && <p className="mt-4 text-sm text-red-700">{t(errorKey)}</p>}

      {kind === "contacts" && staged && (
        <div className="mt-4 rounded-xl bg-surface-subtle p-4">
          <p className="text-sm text-ink-body">{t("extract.nonPhoto.contactsStaged")}</p>
          <Link href="/agent" className="mt-2 inline-block text-sm font-semibold underline">
            {t("extract.preview.openAgent")}
          </Link>
        </div>
      )}

      {kind === "location" && gps && (
        <div className="mt-4 rounded-xl bg-surface-subtle p-4">
          <p className="text-sm text-ink-body">
            {t("extract.nonPhoto.gpsRead", {
              count: String(gps.read ?? 0),
              from: gps.from ?? "",
              to: gps.to ?? "",
            })}
          </p>
        </div>
      )}

      {kind === "costs" && statement && (
        <div className="mt-4 rounded-xl bg-surface-subtle p-4">
          {statement.label ? (
            <p className="text-sm text-ink-body">{t("extract.nonPhoto.costsKnown", { format: statement.label })}</p>
          ) : (
            <p className="text-sm text-ink-body">
              {t("extract.nonPhoto.costsRead", { count: String(statement.sample?.length ?? 0) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function mapError(code: string | undefined): TranslationKey {
  if (code && code in ERROR_KEYS) return ERROR_KEYS[code];
  return "extract.nonPhoto.error.generic";
}
