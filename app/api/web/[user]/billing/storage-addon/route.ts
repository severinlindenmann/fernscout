import { withV2Log } from "@/lib/api/v2/route";
import { POST as POST_ } from "@paid/billing/routes/api/web/[user]/billing/storage-addon/route";
export const POST = withV2Log(POST_, { route: "/api/web/[user]/billing/storage-addon" });
export const dynamic = "force-dynamic";
