import { redirect } from "next/navigation";

/** Moved under /docs, beside the rest of the guide (B305). Anything that
 * linked here still works. */
export default function ApiDocsRedirect() {
  redirect("/docs/api");
}
