import type { Metadata } from "next";
import { openApiDocument } from "@/lib/api/openapi";
import EntryContent from "@/components/EntryContent";

export const metadata: Metadata = { title: "API" };

/** Badge classes per verb — all pairs already used elsewhere in the codebase, so none of them are a new contrast bet. */
const METHOD_STYLE: Record<string, string> = {
  get: "bg-navy-900 text-white",
  post: "bg-yellow-400 text-yellow-950",
  patch: "border border-navy-700 text-navy-900",
  delete: "bg-coral-600 text-white",
};

type Operation = {
  summary?: string;
  description?: string;
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean; schema?: { type?: string } }[];
  requestBody?: { required?: boolean; content: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description?: string }>;
};

const METHOD_ORDER = ["get", "post", "patch", "delete", "put"];

/**
 * `/api/docs` renders the same document `/openapi.json` serves — see
 * `openApiDocument` for why they share one source. A person reading the API
 * gets a page instead of a JSON blob; an agent still wants the raw file.
 *
 * No client JS: `<details>` does the collapsing, and this is a reading
 * surface rather than a request sender (see B299) — nothing here needs a
 * request to run.
 */
export default function ApiDocsPage() {
  const doc = openApiDocument();
  const paths = Object.entries(doc.paths) as [string, Record<string, Operation>][];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <p className="text-sm font-semibold text-navy-500">
        <a href="/agent.md" className="underline decoration-navy-200 hover:decoration-navy-500">
          /agent.md
        </a>{" "}
        · <a href="/openapi.json" className="underline decoration-navy-200 hover:decoration-navy-500">
          /openapi.json
        </a>
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-navy-900">{doc.info.title}</h1>
      <div className="mt-3">
        <EntryContent markdown={doc.info.description} />
      </div>

      <nav className="mt-8 rounded-2xl border border-navy-200 bg-white p-4" aria-label="Endpoints">
        <ul className="grid gap-1 font-mono text-sm text-navy-700 sm:grid-cols-2">
          {paths.map(([path]) => (
            <li key={path}>
              <a href={`#${anchorFor(path)}`} className="hover:text-navy-900 hover:underline">
                {path}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-10 space-y-8">
        {paths.map(([path, methods]) => (
          <section key={path} id={anchorFor(path)} className="scroll-mt-6">
            <h2 className="break-all font-mono text-lg font-semibold text-navy-900">{path}</h2>
            <div className="mt-2 space-y-3">
              {METHOD_ORDER.filter((m) => methods[m]).map((method) => (
                <Endpoint key={method} method={method} op={methods[method]} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function Endpoint({ method, op }: { method: string; op: Operation }) {
  const responses = Object.entries(op.responses ?? {});
  const bodyContent = op.requestBody ? Object.entries(op.requestBody.content) : [];

  return (
    <details className="group rounded-2xl border border-navy-200 bg-white open:pb-4">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase ${METHOD_STYLE[method] ?? "bg-navy-200 text-navy-900"}`}
        >
          {method}
        </span>
        <span className="text-sm font-semibold text-navy-900">{op.summary}</span>
        {op.security?.length === 0 && (
          <span className="ml-auto shrink-0 text-xs font-semibold text-navy-500">no token</span>
        )}
      </summary>

      <div className="space-y-4 px-4 text-sm">
        {op.description && <EntryContent markdown={op.description} />}

        {op.parameters && op.parameters.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase text-navy-500">Parameters</h3>
            <ul className="mt-1 space-y-0.5 font-mono text-navy-700">
              {op.parameters.map((p) => (
                <li key={p.name}>
                  {p.name} <span className="text-navy-500">({p.in}{p.required ? ", required" : ""})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {bodyContent.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase text-navy-500">
              Request body{op.requestBody?.required ? "" : " (optional)"}
            </h3>
            {bodyContent.map(([contentType, { schema }]) => (
              <div key={contentType} className="mt-1">
                <p className="font-mono text-xs text-navy-500">{contentType}</p>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-cream-100 p-3 text-xs text-navy-700">
                  {JSON.stringify(schema, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}

        {responses.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase text-navy-500">Responses</h3>
            <dl className="mt-1 space-y-2">
              {responses.map(([status, r]) => (
                <div key={status} className="flex gap-3">
                  <dt className="shrink-0 font-mono font-semibold text-navy-900">{status}</dt>
                  <dd className="text-navy-700">
                    {r.description && <EntryContent markdown={r.description} />}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </details>
  );
}

function anchorFor(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
