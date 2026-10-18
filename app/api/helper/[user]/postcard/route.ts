import { withV2Log } from "@/lib/api/v2/route";
import { POST as POST_ } from "@paid/postcard/routes/api/helper/[user]/postcard/route";
export const POST = withV2Log(POST_, { route: "/api/helper/[user]/postcard" });
export const dynamic = "force-dynamic";
