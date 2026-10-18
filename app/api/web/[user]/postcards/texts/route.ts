import { withV2Log } from "@/lib/api/v2/route";
import { GET as paidGET } from "@paid/postcard/routes/api/web/[user]/postcards/texts/route";
export const GET = withV2Log(paidGET, { route: "/api/web/[user]/postcards/texts" });
export const dynamic = "force-dynamic";
