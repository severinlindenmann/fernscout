import { redirect } from "next/navigation";

/** The landing page moved to the root. Anything that linked here still works. */
export default function Welcome() {
  redirect("/");
}
