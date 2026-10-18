import { withV2Log } from "@/lib/api/v2/route";
import { GET as paidGET } from "@paid/postcard/routes/api/web/[user]/postcards/photos/route";
export const GET = withV2Log(paidGET, { route: "/api/web/[user]/postcards/photos" });
export const dynamic = "force-dynamic";
