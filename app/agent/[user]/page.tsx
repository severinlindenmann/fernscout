import { redirect } from "next/navigation";

/**
 * The step-wizard retired — B1220 (D52). The room at `/agent` does
 * everything this page did (uploads through the pane since B1171, days
 * through the conversation), so the address that used to hold it sends
 * people home rather than serving a second, older way of doing the same
 * things. The inbox page beneath this path stays: nothing in the room
 * replaces its full listing yet. Deleting the wizard's code is the
 * follow-up chore once nothing references it.
 */
export default function RetiredWizardPage() {
  redirect("/agent");
}
