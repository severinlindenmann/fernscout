"use client";

import { useEffect, useState } from "react";
import type { TemplateId } from "@/lib/messages/registry";
import type { TemplatePreview } from "@/lib/messages/fixtures";
import ChannelChip from "./ChannelIcon";

const LOCALES: { id: "en" | "de" | "hu"; label: string }[] = [
  { id: "en", label: "English" },
  { id: "de", label: "German" },
  { id: "hu", label: "Hungarian" },
];

/**
 * One template, rendered — B2441. Mail goes into a sandboxed
 * `<iframe srcdoc>` (the real HTML `renderMail` produced, never trusted
 * inline into this page's own DOM); SMS/WhatsApp/push show as text bubbles.
 * "Send a test to me" only appears for mail — see the API route's own note.
 */
export default function Preview({ template }: { template: TemplateId }) {
  const [locale, setLocale] = useState<"en" | "de" | "hu">("en");
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/admin/messages/preview?template=${encodeURIComponent(template)}&locale=${locale}`)
      .then((r) => r.json())
      .then((json: { preview?: TemplatePreview }) => {
        if (!cancelled) setPreview(json.preview ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [template, locale]);

  async function sendTest() {
    setSending(true);
    setSendNote(null);
    try {
      const response = await fetch("/api/admin/messages/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template, locale }),
      });
      const json = (await response.json().catch(() => ({}))) as { transport?: string; message?: string };
      setSendNote(
        response.ok
          ? json.transport === "file"
            ? "Written to disk by the file transport — nothing left this machine."
            : "Sent to your admin address."
          : (json.message ?? "Could not send it."),
      );
    } catch {
      setSendNote("The request did not reach the server.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Preview language">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLocale(l.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                locale === l.id ? "bg-action-strong text-on-action" : "border border-line-quiet text-ink-body"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        {preview?.channel === "mail" && !("freeform" in preview) ? (
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={sending}
            className="ml-auto min-h-9 rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-strong disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send a test to me"}
          </button>
        ) : null}
      </div>

      {loading || !preview ? (
        <p className="text-sm text-ink-secondary">Rendering…</p>
      ) : "freeform" in preview && preview.channel === "mail" ? (
        <p className="rounded-2xl border border-line-quiet bg-surface-subtle p-4 text-sm italic text-ink-secondary">{preview.text}</p>
      ) : preview.channel === "mail" ? (
        <div className="rounded-2xl border border-line-quiet bg-surface-subtle p-3">
          <p className="mb-2 text-xs text-ink-secondary">
            Subject: <b className="text-ink-strong">{preview.subject}</b>
          </p>
          <iframe
            title="Mail preview"
            sandbox=""
            srcDoc={preview.html}
            className="h-[420px] w-full rounded-xl border border-line-quiet bg-white"
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-line-quiet bg-surface-subtle p-4">
          <div className="mb-2 text-xs text-ink-secondary">
            <ChannelChip channel={preview.channel} />
          </div>
          <div
            className={
              // A phone's own bubble, not this page's surface: fixed colours
              // in both themes, or dark mode's light ink lands on white (B2492).
              preview.channel === "wa"
                ? "max-w-sm rounded-xl bg-[#d9fdd3] p-3 text-[#111b21] shadow-sm"
                : preview.channel === "push"
                  ? "max-w-sm rounded-2xl bg-white p-3 text-[#111b21] shadow-md"
                  : "max-w-sm rounded-2xl bg-[#e9e9eb] p-3 text-[#111b21]"
            }
          >
            {preview.channel === "push" && "title" in preview && preview.title ? <p className="font-semibold">{preview.title}</p> : null}
            {"freeform" in preview ? (
              <p className="text-sm italic">{preview.text}</p>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{preview.text}</p>
            )}
          </div>
        </div>
      )}
      {sendNote ? <p className="text-sm text-ink-body">{sendNote}</p> : null}
    </div>
  );
}
