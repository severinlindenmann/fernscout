import { withV2Log } from "@/lib/api/v2/route";
import { GET as GET_ } from "@paid/postcard/routes/api/web/[user]/postcards/photos/route";
export const GET = withV2Log(GET_, { route: "/api/web/[user]/postcards/photos" });
export const dynamic = "force-dynamic";
